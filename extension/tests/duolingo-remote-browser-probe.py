import asyncio
import hashlib
import json
import os
import re
import time
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
INTERACTIVE_TIMEOUT_SECONDS = int(os.environ.get("DUOLINGO_INTERACTIVE_TIMEOUT_SECONDS", "300"))


def sha256_text(value):
    if value is None:
        return None
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


async def wait_for_selector(tab, selector, attempts=8):
    for _ in range(attempts):
        element = await tab.select(selector)
        if element:
            return element
        await tab.sleep(1)
    return None


async def page_state(tab):
    expression = """
    (() => {
      const identity = document.querySelector('input[data-test="email-input"]');
      const password = document.querySelector('input[data-test="password-input"]');
      const active = document.activeElement;
      return {
        identity: identity ? identity.value : null,
        password: password ? password.value : null,
        activeTag: active ? active.tagName : null,
        activeType: active && active.getAttribute ? active.getAttribute('type') : null,
        activeDataTest: active && active.getAttribute ? active.getAttribute('data-test') : null,
        bodyText: document.body ? document.body.innerText : '',
        href: location.href
      };
    })()
    """
    return await tab.evaluate(expression, return_by_value=True)


def summarize_state(raw, elapsed_seconds):
    identity = raw.get("identity")
    password = raw.get("password")
    body_text = (raw.get("bodyText") or "").lower()
    href = raw.get("href") or ""
    login_form_present = password is not None
    wrong_credentials = "wrong username or password" in body_text
    logged_in = not login_form_present and "/log-in" not in href

    return {
        "elapsedSeconds": round(elapsed_seconds, 2),
        "url": href,
        "identityFieldPresent": identity is not None,
        "passwordFieldPresent": password is not None,
        "identityFieldExact": identity == EMAIL if identity is not None else None,
        "passwordFieldExact": password == PASSWORD if password is not None else None,
        "identityFieldLength": len(identity) if identity is not None else None,
        "passwordFieldLength": len(password) if password is not None else None,
        "identityLeadingOrTrailingWhitespace": (
            identity != identity.strip() if identity is not None else None
        ),
        "passwordLeadingOrTrailingWhitespace": (
            password != password.strip() if password is not None else None
        ),
        "passwordFieldSha256": sha256_text(password),
        "activeTag": raw.get("activeTag"),
        "activeType": raw.get("activeType"),
        "activeDataTest": raw.get("activeDataTest"),
        "wrongCredentialsMessage": wrong_credentials,
        "loginFormStillPresent": login_form_present,
        "loggedIn": logged_in,
    }


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
    interaction_log = []
    summary = {
        "automation": "nodriver-remote-browser-interactive-probe",
        "nodriverVersion": uc.__version__,
        "cdpHost": CDP_HOST,
        "cdpPort": CDP_PORT,
        "email": EMAIL,
        "emailLength": len(EMAIL),
        "passwordLength": len(PASSWORD),
        "passwordSha256": sha256_text(PASSWORD),
        "interactiveTimeoutSeconds": INTERACTIVE_TIMEOUT_SECONDS,
        "submittedByAutomation": False,
    }

    try:
        browser = await uc.start(config=uc.Config(host=CDP_HOST, port=CDP_PORT))
        summary["chromeVersion"] = dict(browser.info) if browser.info else None

        # This is a dedicated test-browser profile. Clear its authentication state so
        # this run starts from a reproducible logged-out Duolingo session.
        tab = await browser.get("https://www.duolingo.com/", new_tab=True)
        await tab.sleep(2)
        await tab.send(uc.cdp.network.clear_browser_cookies())
        try:
            await tab.evaluate("localStorage.clear(); sessionStorage.clear();")
        except Exception:
            pass

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

        initial_raw = await page_state(tab)
        initial_state = summarize_state(initial_raw, 0)
        summary["initialFilledState"] = initial_state
        if not initial_state["identityFieldExact"] or not initial_state["passwordFieldExact"]:
            raise RuntimeError("Login fields do not exactly match configured credentials")

        await capture(tab, "01-filled-before-manual-interaction")

        print(
            "Credentials are filled exactly. Automation will NOT submit the form. "
            f"You have {INTERACTIVE_TIMEOUT_SECONDS} seconds to inspect, edit, and submit manually."
        )

        start = time.monotonic()
        previous_comparable = None
        final_state = initial_state

        while time.monotonic() - start < INTERACTIVE_TIMEOUT_SECONDS:
            elapsed = time.monotonic() - start
            raw = await page_state(tab)
            state = summarize_state(raw, elapsed)
            final_state = state

            comparable = {
                key: value
                for key, value in state.items()
                if key != "elapsedSeconds"
            }
            if comparable != previous_comparable:
                interaction_log.append(state)
                previous_comparable = comparable
                print(
                    "Interaction state changed:",
                    json.dumps(
                        {
                            "elapsedSeconds": state["elapsedSeconds"],
                            "url": state["url"],
                            "identityExact": state["identityFieldExact"],
                            "passwordExact": state["passwordFieldExact"],
                            "identityLength": state["identityFieldLength"],
                            "passwordLength": state["passwordFieldLength"],
                            "wrongCredentials": state["wrongCredentialsMessage"],
                            "loggedIn": state["loggedIn"],
                            "activeDataTest": state["activeDataTest"],
                        },
                        sort_keys=True,
                    ),
                )

            if state["loggedIn"]:
                summary["manualLoginSucceeded"] = True
                summary["finalState"] = state
                await capture(tab, "02-after-manual-login")
                print("Manual login succeeded; interaction trace captured.")
                break

            await asyncio.sleep(0.75)
        else:
            summary["manualLoginSucceeded"] = False
            summary["finalState"] = final_state
            await capture(tab, "02-interactive-timeout")
            raise RuntimeError("Interactive login window expired before an authenticated state")

    except Exception as error:
        summary["error"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        (OUTPUT_DIR / "interaction-log.json").write_text(
            json.dumps(interaction_log, indent=2), encoding="utf-8"
        )
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
