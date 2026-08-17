import json
import os
import re
import socket
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import nodriver as uc

EMAIL = os.environ.get("DUOLINGO_TEST_EMAIL")
PASSWORD = os.environ.get("DUOLINGO_TEST_PASSWORD")
if not EMAIL or not PASSWORD:
    raise RuntimeError("DUOLINGO_TEST_EMAIL and DUOLINGO_TEST_PASSWORD are required")

EXTENSION_ROOT = Path.cwd().resolve()
OUTPUT_DIR = Path(os.environ.get("DUOLINGO_CAPTURE_DIR", "live-capture")).resolve()
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
CHROME_PATH = os.environ.get("CHROME_PATH", "/usr/bin/google-chrome")


def target_json(target):
    try:
        return target.target.to_json()
    except Exception:
        return {"repr": repr(target)}


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_for_debug_endpoint(port, process, timeout_seconds=30):
    deadline = time.monotonic() + timeout_seconds
    url = f"http://127.0.0.1:{port}/json/version"
    last_error = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(
                f"Chrome exited before its CDP endpoint became available (exit {process.returncode})"
            )
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                return json.loads(response.read())
        except Exception as error:
            last_error = error
            time.sleep(0.25)
    raise RuntimeError(f"Chrome CDP endpoint did not become available: {last_error}")


def launch_chrome():
    port = free_port()
    profile_dir = Path(tempfile.mkdtemp(prefix="parola-nodriver-profile-"))
    stdout_path = OUTPUT_DIR / "chrome-stdout.log"
    stderr_path = OUTPUT_DIR / "chrome-stderr.log"
    stdout_file = stdout_path.open("wb")
    stderr_file = stderr_path.open("wb")

    args = [
        CHROME_PATH,
        f"--user-data-dir={profile_dir}",
        f"--remote-debugging-port={port}",
        "--remote-debugging-address=127.0.0.1",
        "--remote-allow-origins=*",
        "--no-first-run",
        "--no-default-browser-check",
        "--password-store=basic",
        "--disable-infobars",
        "--disable-breakpad",
        "--disable-dev-shm-usage",
        "--disable-session-crashed-bubble",
        "--disable-search-engine-choice-screen",
        "--no-sandbox",
        "--disable-features=IsolateOrigins,site-per-process,DisableLoadExtensionCommandLineSwitch",
        "--enable-unsafe-extension-debugging",
        f"--disable-extensions-except={EXTENSION_ROOT}",
        f"--load-extension={EXTENSION_ROOT}",
        "about:blank",
    ]

    (OUTPUT_DIR / "chrome-command.json").write_text(
        json.dumps({"args": args, "port": port, "profileDir": str(profile_dir)}, indent=2),
        encoding="utf-8",
    )

    process = subprocess.Popen(args, stdout=stdout_file, stderr=stderr_file)
    try:
        version = wait_for_debug_endpoint(port, process)
    except Exception:
        stdout_file.close()
        stderr_file.close()
        raise

    return process, stdout_file, stderr_file, profile_dir, port, version


async def find_extension_id(browser, timeout_seconds=15):
    for _ in range(timeout_seconds * 2):
        await browser.update_targets()
        serialized = json.dumps([target_json(target) for target in browser.targets])
        match = re.search(r"chrome-extension://([a-p]{32})", serialized)
        if match:
            return match.group(1)
        await browser.sleep(0.5)
    return None


async def wait_for_selector(tab, selector, attempts=4):
    for _ in range(attempts):
        element = await tab.select(selector)
        if element:
            return element
        await tab.sleep(1)
    return None


async def capture(tab, name):
    html = await tab.get_content()
    title_match = re.search(r"<title[^>]*>(.*?)</title>", html, flags=re.I | re.S)
    title = re.sub(r"\s+", " ", title_match.group(1)).strip() if title_match else ""
    url = str(getattr(tab.target, "url", ""))

    await tab.save_screenshot(filename=str(OUTPUT_DIR / f"{name}.png"))
    (OUTPUT_DIR / f"{name}.html").write_text(html, encoding="utf-8")
    (OUTPUT_DIR / f"{name}.json").write_text(
        json.dumps({"url": url, "title": title}, indent=2), encoding="utf-8"
    )
    return html, url, title


async def capture_extension_review(browser, extension_id, name):
    review = await browser.get(
        f"chrome-extension://{extension_id}/review.html", new_tab=True
    )
    await review.sleep(1)
    await capture(review, name)
    return review


async def main():
    chrome_process = None
    stdout_file = None
    stderr_file = None
    browser = None

    summary = {
        "automation": "nodriver",
        "nodriverVersion": uc.__version__,
        "chromePath": CHROME_PATH,
        "chromeLaunchMode": "external-cdp",
    }

    try:
        (
            chrome_process,
            stdout_file,
            stderr_file,
            profile_dir,
            port,
            chrome_version,
        ) = launch_chrome()

        summary.update(
            {
                "chromeDebugPort": port,
                "chromeProfileDir": str(profile_dir),
                "chromeVersion": chrome_version,
            }
        )

        config = uc.Config(host="127.0.0.1", port=port)
        browser = await uc.start(config=config)

        extension_id = await find_extension_id(browser)
        summary["extensionId"] = extension_id
        if not extension_id:
            raise RuntimeError("Parola extension did not load in Chrome")

        (OUTPUT_DIR / "targets.json").write_text(
            json.dumps([target_json(target) for target in browser.targets], indent=2),
            encoding="utf-8",
        )
        await capture_extension_review(browser, extension_id, "00-extension-review")

        tab = await browser.get("https://www.duolingo.com/log-in", new_tab=True)
        await tab.sleep(2)
        await capture(tab, "01-login-page")

        identity = await wait_for_selector(tab, 'input[data-test="email-input"]')
        password = await wait_for_selector(tab, 'input[data-test="password-input"]')
        if not identity or not password:
            raise RuntimeError("Could not find Duolingo login inputs")

        await identity.mouse_click()
        await identity.send_keys(EMAIL)
        await tab.sleep(0.35)
        await password.mouse_click()
        await password.send_keys(PASSWORD)
        await tab.sleep(0.45)

        submit = await wait_for_selector(tab, 'button[data-test="register-button"]')
        if not submit:
            submit = await tab.find("LOG IN", best_match=True)
        if not submit:
            raise RuntimeError("Could not find Duolingo login button")

        await submit.mouse_click()
        await tab.sleep(10)
        html, final_url, title = await capture(tab, "02-after-login")

        lower = html.lower()
        wrong_credentials = "wrong username or password" in lower
        challenge_markers = [
            "verify you are human",
            "unusual traffic",
            "security check",
            "cf-chl-",
            "challenges.cloudflare.com",
        ]
        challenge_hits = [marker for marker in challenge_markers if marker in lower]
        login_form_present = 'data-test="password-input"' in lower
        logged_in = (
            not wrong_credentials
            and not challenge_hits
            and not login_form_present
            and "/log-in" not in final_url
        )

        summary.update(
            {
                "finalUrl": final_url,
                "title": title,
                "loggedIn": logged_in,
                "loginFormStillPresent": login_form_present,
                "wrongCredentialsMessage": wrong_credentials,
                "antiBotChallengeMarkers": challenge_hits,
            }
        )

        if logged_in:
            await capture_extension_review(browser, extension_id, "03-extension-after-login")
            print(f"nodriver logged into Duolingo successfully at {final_url}")
        elif wrong_credentials:
            print("Duolingo returned 'Wrong username or password'.")
        elif challenge_hits:
            print(f"Duolingo challenge markers: {challenge_hits}")
        else:
            print(f"Duolingo login did not complete; final URL: {final_url}")

        if challenge_hits:
            raise RuntimeError("Duolingo presented an anti-bot/security challenge")
    except Exception as error:
        summary["error"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        (OUTPUT_DIR / "summary.json").write_text(
            json.dumps(summary, indent=2), encoding="utf-8"
        )

        if browser is not None:
            try:
                for target in list(browser.targets):
                    try:
                        target.connection.close()
                    except Exception:
                        pass
            except Exception:
                pass

        if chrome_process is not None and chrome_process.poll() is None:
            chrome_process.terminate()
            try:
                chrome_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                chrome_process.kill()
                chrome_process.wait(timeout=5)

        if stdout_file is not None:
            stdout_file.close()
        if stderr_file is not None:
            stderr_file.close()


if __name__ == "__main__":
    uc.loop().run_until_complete(main())
