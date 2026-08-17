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


async def find_parola_extension(browser, timeout_seconds=15):
    candidate_ids = []
    for _ in range(timeout_seconds * 2):
        await browser.update_targets()
        candidate_ids = []
        for target in browser.targets:
            data = target_json(target)
            url = str(data.get("url", ""))
            match = re.fullmatch(r"chrome-extension://([a-p]{32})/background\.js", url)
            if match and match.group(1) not in candidate_ids:
                candidate_ids.append(match.group(1))
        if candidate_ids:
            break
        await browser.sleep(0.5)

    for extension_id in candidate_ids:
        review = await browser.get(
            f"chrome-extension://{extension_id}/review.html", new_tab=True
        )
        await review.sleep(0.5)
        html = await review.get_content()
        if "Parola for Duolingo" in html and "Review staged words" in html:
            return extension_id, review
        try:
            await review.close()
        except Exception:
            pass

    return None, None


async def wait_for_selector(tab, selector, attempts=4):
    for _ in range(attempts):
        element = await tab.select(selector)
        if element:
            return element
        await tab.sleep(1)
    return None


async def field_matches(tab, selector, expected):
    expression = (
        "(() => { const el = document.querySelector("
        + json.dumps(selector)
        + "); return !!el && el.value === "
        + json.dumps(expected)
        + "; })()"
    )
    return bool(await tab.evaluate(expression, return_by_value=True))


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


async def capture_extension_review(review, name):
    await review.sleep(0.75)
    await capture(review, name)


async def login_attempt(browser, identity_value, capture_name):
    tab = await browser.get("https://www.duolingo.com/log-in", new_tab=True)
    await tab.sleep(2)

    identity_selector = 'input[data-test="email-input"]'
    password_selector = 'input[data-test="password-input"]'
    identity = await wait_for_selector(tab, identity_selector)
    password = await wait_for_selector(tab, password_selector)
    if not identity or not password:
        raise RuntimeError("Could not find Duolingo login inputs")

    await identity.mouse_click()
    await identity.send_keys(identity_value)
    await tab.sleep(0.35)
    await password.mouse_click()
    await password.send_keys(PASSWORD)
    await tab.sleep(0.45)

    identity_exact = await field_matches(tab, identity_selector, identity_value)
    password_exact = await field_matches(tab, password_selector, PASSWORD)
    if not identity_exact or not password_exact:
        raise RuntimeError(
            f"Login field mismatch after typing (identity={identity_exact}, password={password_exact})"
        )

    submit = await wait_for_selector(tab, 'button[data-test="register-button"]')
    if not submit:
        submit = await tab.find("LOG IN", best_match=True)
    if not submit:
        raise RuntimeError("Could not find Duolingo login button")

    await submit.mouse_click()
    await tab.sleep(10)
    html, final_url, title = await capture(tab, capture_name)

    lower = html.lower()
    challenge_markers = [
        "verify you are human",
        "unusual traffic",
        "security check",
        "cf-chl-",
        "challenges.cloudflare.com",
    ]
    result = {
        "identityKind": "email" if "@" in identity_value else "username",
        "identityFieldExact": identity_exact,
        "passwordFieldExact": password_exact,
        "finalUrl": final_url,
        "title": title,
        "wrongCredentialsMessage": "wrong username or password" in lower,
        "antiBotChallengeMarkers": [
            marker for marker in challenge_markers if marker in lower
        ],
        "loginFormStillPresent": 'data-test="password-input"' in lower,
    }
    result["loggedIn"] = (
        not result["wrongCredentialsMessage"]
        and not result["antiBotChallengeMarkers"]
        and not result["loginFormStillPresent"]
        and "/log-in" not in final_url
    )
    return tab, result


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
        "passwordSecretHasOuterWhitespace": PASSWORD != PASSWORD.strip(),
        "emailSecretHasOuterWhitespace": EMAIL != EMAIL.strip(),
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

        (OUTPUT_DIR / "targets.json").write_text(
            json.dumps([target_json(target) for target in browser.targets], indent=2),
            encoding="utf-8",
        )

        extension_id, review = await find_parola_extension(browser)
        summary["extensionId"] = extension_id
        if not extension_id or review is None:
            raise RuntimeError("Parola extension did not load in Chrome")
        await capture_extension_review(review, "00-extension-review")

        login_page = await browser.get("https://www.duolingo.com/log-in", new_tab=True)
        await login_page.sleep(2)
        await capture(login_page, "01-login-page")
        try:
            await login_page.close()
        except Exception:
            pass

        tab, result = await login_attempt(browser, EMAIL, "02-after-email-login")
        summary["loginAttempts"] = [result]

        if result["wrongCredentialsMessage"]:
            username_guess = EMAIL.split("@", 1)[0]
            try:
                await tab.close()
            except Exception:
                pass
            tab, result = await login_attempt(
                browser, username_guess, "03-after-username-login"
            )
            summary["loginAttempts"].append(result)

        summary.update(result)

        if result["loggedIn"]:
            await capture_extension_review(review, "04-extension-after-login")
            print(f"nodriver logged into Duolingo successfully at {result['finalUrl']}")
        elif result["antiBotChallengeMarkers"]:
            print(f"Duolingo challenge markers: {result['antiBotChallengeMarkers']}")
            raise RuntimeError("Duolingo presented an anti-bot/security challenge")
        elif result["wrongCredentialsMessage"]:
            print("Duolingo rejected both configured email and inferred username credentials.")
            raise RuntimeError("Duolingo rejected the configured test credentials")
        else:
            print(f"Duolingo login did not complete; final URL: {result['finalUrl']}")
            raise RuntimeError("Duolingo login did not reach an authenticated state")
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
