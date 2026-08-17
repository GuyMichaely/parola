import asyncio
import hashlib
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

ACCOUNT_PATH = Path(__file__).with_name("duolingo-test-account.json")
ACCOUNT = json.loads(ACCOUNT_PATH.read_text(encoding="utf-8"))
EMAIL = ACCOUNT["email"]
PASSWORD = ACCOUNT["password"]

OUTPUT_DIR = Path(os.environ.get("DUOLINGO_CAPTURE_DIR", "login-probe-capture")).resolve()
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
CHROME_PATH = os.environ["CHROME_PATH"]


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
    profile_dir = Path(tempfile.mkdtemp(prefix="duolingo-clean-profile-"))
    stdout_file = (OUTPUT_DIR / "chrome-stdout.log").open("wb")
    stderr_file = (OUTPUT_DIR / "chrome-stderr.log").open("wb")

    # Keep this intentionally minimal. No extension, no feature overrides, no
    # anti-detection flags: just the flags required to run Chrome in CI and
    # attach nodriver over local CDP.
    args = [
        CHROME_PATH,
        f"--user-data-dir={profile_dir}",
        f"--remote-debugging-port={port}",
        "--remote-debugging-address=127.0.0.1",
        "--no-first-run",
        "--no-default-browser-check",
        "--no-sandbox",
        "about:blank",
    ]

    (OUTPUT_DIR / "chrome-command.json").write_text(
        json.dumps({"args": args, "port": port, "profileDir": str(profile_dir)}, indent=2),
        encoding="utf-8",
    )

    process = subprocess.Popen(args, stdout=stdout_file, stderr=stderr_file)
    version = wait_for_debug_endpoint(port, process)
    return process, stdout_file, stderr_file, profile_dir, port, version


async def wait_for_selector(tab, selector, attempts=8):
    for _ in range(attempts):
        element = await tab.select(selector)
        if element:
            return element
        await tab.sleep(1)
    return None


async def field_value(tab, selector):
    expression = (
        "(() => { const el = document.querySelector("
        + json.dumps(selector)
        + "); return el ? el.value : null; })()"
    )
    return await tab.evaluate(expression, return_by_value=True)


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


async def main():
    process = None
    stdout_file = None
    stderr_file = None
    browser = None
    summary = {
        "automation": "nodriver-clean-login-probe",
        "nodriverVersion": uc.__version__,
        "chromePath": CHROME_PATH,
        "email": EMAIL,
        "emailLength": len(EMAIL),
        "passwordLength": len(PASSWORD),
        "passwordSha256": hashlib.sha256(PASSWORD.encode("utf-8")).hexdigest(),
    }

    try:
        process, stdout_file, stderr_file, profile_dir, port, chrome_version = launch_chrome()
        summary.update(
            {
                "chromeProfileDir": str(profile_dir),
                "chromeVersion": chrome_version,
            }
        )

        browser = await uc.start(config=uc.Config(host="127.0.0.1", port=port))
        tab = await browser.get("https://www.duolingo.com/log-in", new_tab=True)
        await tab.sleep(3)
        await capture(tab, "00-login-page")

        identity_selector = 'input[data-test="email-input"]'
        password_selector = 'input[data-test="password-input"]'
        identity = await wait_for_selector(tab, identity_selector)
        password = await wait_for_selector(tab, password_selector)
        if not identity or not password:
            raise RuntimeError("Could not find Duolingo login inputs")

        await identity.mouse_click()
        await identity.send_keys(EMAIL)
        await password.mouse_click()
        await password.send_keys(PASSWORD)
        await tab.sleep(0.5)

        actual_identity = await field_value(tab, identity_selector)
        actual_password = await field_value(tab, password_selector)
        summary.update(
            {
                "identityFieldExact": actual_identity == EMAIL,
                "passwordFieldExact": actual_password == PASSWORD,
                "identityFieldLength": len(actual_identity) if actual_identity is not None else None,
                "passwordFieldLength": len(actual_password) if actual_password is not None else None,
                "identityLeadingOrTrailingWhitespace": (
                    actual_identity != actual_identity.strip()
                    if actual_identity is not None
                    else None
                ),
                "passwordLeadingOrTrailingWhitespace": (
                    actual_password != actual_password.strip()
                    if actual_password is not None
                    else None
                ),
                "passwordFieldSha256": (
                    hashlib.sha256(actual_password.encode("utf-8")).hexdigest()
                    if actual_password is not None
                    else None
                ),
            }
        )

        if actual_identity != EMAIL or actual_password != PASSWORD:
            raise RuntimeError("Login fields do not exactly match configured credentials")

        submit = await wait_for_selector(tab, 'button[data-test="register-button"]')
        if not submit:
            submit = await tab.find("LOG IN", best_match=True)
        if not submit:
            raise RuntimeError("Could not find Duolingo login button")

        await submit.mouse_click()
        await tab.sleep(10)
        html, final_url, title = await capture(tab, "01-after-login")
        lower = html.lower()
        challenge_markers = [
            "verify you are human",
            "unusual traffic",
            "security check",
            "cf-chl-",
            "challenges.cloudflare.com",
        ]
        summary.update(
            {
                "finalUrl": final_url,
                "title": title,
                "wrongCredentialsMessage": "wrong username or password" in lower,
                "antiBotChallengeMarkers": [
                    marker for marker in challenge_markers if marker in lower
                ],
                "loginFormStillPresent": 'data-test="password-input"' in lower,
            }
        )
        summary["loggedIn"] = (
            not summary["wrongCredentialsMessage"]
            and not summary["antiBotChallengeMarkers"]
            and not summary["loginFormStillPresent"]
            and "/log-in" not in final_url
        )

        if summary["loggedIn"]:
            print(f"Clean Chrome login succeeded at {final_url}")
        elif summary["wrongCredentialsMessage"]:
            raise RuntimeError("Duolingo returned its wrong-credentials response")
        elif summary["antiBotChallengeMarkers"]:
            raise RuntimeError("Duolingo presented an anti-bot/security challenge")
        else:
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

        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        if stdout_file is not None:
            stdout_file.close()
        if stderr_file is not None:
            stderr_file.close()


if __name__ == "__main__":
    asyncio.run(main())
