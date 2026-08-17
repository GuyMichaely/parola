import asyncio
import hashlib
import json
import os
import re
from pathlib import Path

import nodriver as uc

ACCOUNT_PATH = Path(__file__).with_name("duolingo-test-account.json")
ACCOUNT = json.loads(ACCOUNT_PATH.read_text(encoding="utf-8"))
EMAIL = ACCOUNT["email"]
PASSWORD = ACCOUNT["password"]

OUTPUT_DIR = Path(os.environ.get("DUOLINGO_CAPTURE_DIR", "remote-browser-capture")).resolve()
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
CDP_HOST = os.environ.get("DUOLINGO_CDP_HOST", "127.0.0.1")
CDP_PORT = int(os.environ.get("DUOLINGO_CDP_PORT", "9222"))


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
    browser = None
    summary = {
        "automation": "nodriver-remote-browser-probe",
        "nodriverVersion": uc.__version__,
        "cdpHost": CDP_HOST,
        "cdpPort": CDP_PORT,
        "email": EMAIL,
        "emailLength": len(EMAIL),
        "passwordLength": len(PASSWORD),
        "passwordSha256": hashlib.sha256(PASSWORD.encode("utf-8")).hexdigest(),
    }

    try:
        browser = await uc.start(config=uc.Config(host=CDP_HOST, port=CDP_PORT))
        summary["chromeVersion"] = dict(browser.info) if browser.info else None

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
            print(f"Remote Chrome login succeeded at {final_url}")
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


if __name__ == "__main__":
    asyncio.run(main())
