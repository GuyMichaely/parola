import asyncio
import hashlib
import json
import os
import random
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

SHIFT = 8
CTRL = 2

SYMBOL_KEYS = {
    "@": ("Digit2", "2", True),
    "]": ("BracketRight", "]", False),
    "'": ("Quote", "'", False),
    "*": ("Digit8", "8", True),
    "<": ("Comma", ",", True),
    ".": ("Period", ".", False),
    "-": ("Minus", "-", False),
    "_": ("Minus", "-", True),
}


def sha256_text(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


async def wait_for_selector(tab, selector, attempts=8):
    for _ in range(attempts):
        element = await tab.select(selector)
        if element:
            return element
        await tab.sleep(1)
    return None


def key_spec(char):
    if "a" <= char <= "z":
        return f"Key{char.upper()}", char, False
    if "A" <= char <= "Z":
        return f"Key{char}", char.lower(), True
    if "0" <= char <= "9":
        return f"Digit{char}", char, False
    if char in SYMBOL_KEYS:
        return SYMBOL_KEYS[char]
    raise ValueError(f"Unsupported character for physical-key typing: {char!r}")


async def key_event(tab, type_, *, key, code, modifiers=0, text="", unmodified_text=""):
    await tab.send(
        uc.cdp.input_.dispatch_key_event(
            type_,
            modifiers=modifiers,
            text=text,
            unmodified_text=unmodified_text,
            key=key,
            code=code,
        )
    )


async def press_shift(tab, down):
    await key_event(
        tab,
        "keyDown" if down else "keyUp",
        key="Shift",
        code="ShiftLeft",
        modifiers=SHIFT if down else 0,
    )


async def type_character(tab, char):
    code, unmodified, shifted = key_spec(char)
    modifiers = SHIFT if shifted else 0

    if shifted:
        await press_shift(tab, True)
        await asyncio.sleep(random.uniform(0.025, 0.065))

    await key_event(
        tab,
        "keyDown",
        key=char,
        code=code,
        modifiers=modifiers,
        text=char,
        unmodified_text=unmodified,
    )
    await asyncio.sleep(random.uniform(0.035, 0.095))
    await key_event(
        tab,
        "keyUp",
        key=char,
        code=code,
        modifiers=modifiers,
    )

    if shifted:
        await asyncio.sleep(random.uniform(0.02, 0.055))
        await press_shift(tab, False)

    await asyncio.sleep(random.uniform(0.045, 0.13))


async def clear_focused_input(tab):
    await key_event(tab, "keyDown", key="Control", code="ControlLeft", modifiers=CTRL)
    await key_event(tab, "keyDown", key="a", code="KeyA", modifiers=CTRL)
    await key_event(tab, "keyUp", key="a", code="KeyA", modifiers=CTRL)
    await key_event(tab, "keyUp", key="Control", code="ControlLeft")
    await asyncio.sleep(0.08)
    await key_event(tab, "keyDown", key="Backspace", code="Backspace")
    await key_event(tab, "keyUp", key="Backspace", code="Backspace")
    await asyncio.sleep(0.12)


async def physical_type(tab, element, text):
    await element.mouse_click()
    await asyncio.sleep(0.15)
    await clear_focused_input(tab)
    for char in text:
        await type_character(tab, char)


async def field_value(tab, selector):
    return await tab.evaluate(
        "(() => { const el = document.querySelector(" + json.dumps(selector) + "); return el ? el.value : null; })()",
        return_by_value=True,
    )


async def install_event_trace(tab):
    await tab.evaluate(
        """
        (() => {
          window.__parolaLoginEvents = [];
          const watched = new Set(['keydown', 'keypress', 'beforeinput', 'input', 'keyup', 'change']);
          for (const type of watched) {
            document.addEventListener(type, event => {
              const field = event.target && event.target.getAttribute && event.target.getAttribute('data-test');
              if (field !== 'email-input' && field !== 'password-input') return;
              window.__parolaLoginEvents.push({
                field,
                type,
                trusted: event.isTrusted,
                inputType: event.inputType || null
              });
            }, true);
          }
        })()
        """
    )


async def read_event_trace(tab):
    return await tab.evaluate("window.__parolaLoginEvents || []", return_by_value=True)


async def capture(tab, name):
    html = await tab.get_content()
    title_match = re.search(r"<title[^>]*>(.*?)</title>", html, flags=re.I | re.S)
    title = re.sub(r"\s+", " ", title_match.group(1)).strip() if title_match else ""
    url = str(getattr(tab.target, "url", ""))
    await tab.save_screenshot(filename=str(OUTPUT_DIR / f"{name}.png"))
    (OUTPUT_DIR / f"{name}.html").write_text(html, encoding="utf-8")
    return html, url, title


async def main():
    browser = None
    summary = {
        "automation": "nodriver-remote-browser-full-key-events",
        "nodriverVersion": uc.__version__,
        "cdpHost": CDP_HOST,
        "cdpPort": CDP_PORT,
        "emailLength": len(EMAIL),
        "passwordLength": len(PASSWORD),
        "passwordSha256": sha256_text(PASSWORD),
        "submittedByAutomation": True,
    }

    try:
        browser = await uc.start(config=uc.Config(host=CDP_HOST, port=CDP_PORT))
        summary["chromeVersion"] = dict(browser.info) if browser.info else None

        tab = await browser.get("https://www.duolingo.com/", new_tab=True)
        await tab.sleep(2)
        await tab.send(uc.cdp.network.clear_browser_cookies())
        await tab.send(uc.cdp.storage.clear_data_for_origin("https://www.duolingo.com", "all"))

        tab = await browser.get("https://www.duolingo.com/log-in", new_tab=True)
        await tab.sleep(3)
        await capture(tab, "00-login-page")
        await install_event_trace(tab)

        identity_selector = 'input[data-test="email-input"]'
        password_selector = 'input[data-test="password-input"]'
        identity = await wait_for_selector(tab, identity_selector)
        password = await wait_for_selector(tab, password_selector)
        if not identity or not password:
            raise RuntimeError("Could not find Duolingo login inputs")

        await physical_type(tab, identity, EMAIL)
        await physical_type(tab, password, PASSWORD)
        await tab.sleep(0.5)

        actual_identity = await field_value(tab, identity_selector)
        actual_password = await field_value(tab, password_selector)
        summary.update(
            {
                "identityFieldExact": actual_identity == EMAIL,
                "passwordFieldExact": actual_password == PASSWORD,
                "identityFieldLength": len(actual_identity) if actual_identity is not None else None,
                "passwordFieldLength": len(actual_password) if actual_password is not None else None,
                "passwordFieldSha256": sha256_text(actual_password) if actual_password is not None else None,
            }
        )
        if actual_identity != EMAIL or actual_password != PASSWORD:
            raise RuntimeError("Full-key typing did not produce the exact configured credentials")

        events = await read_event_trace(tab)
        summary["inputEventTrace"] = events
        await capture(tab, "01-filled-with-full-key-events")

        submit = await wait_for_selector(tab, 'button[data-test="register-button"]')
        if not submit:
            submit = await tab.find("LOG IN", best_match=True)
        if not submit:
            raise RuntimeError("Could not find Duolingo login button")

        await submit.mouse_click()
        await tab.sleep(10)
        html, final_url, title = await capture(tab, "02-after-login")
        lower = html.lower()
        summary.update(
            {
                "finalUrl": final_url,
                "title": title,
                "wrongCredentialsMessage": "wrong username or password" in lower,
                "loginFormStillPresent": 'data-test="password-input"' in lower,
            }
        )
        summary["loggedIn"] = (
            not summary["wrongCredentialsMessage"]
            and not summary["loginFormStillPresent"]
            and "/log-in" not in final_url
        )

        if summary["loggedIn"]:
            print(f"Full-key remote Chrome login succeeded at {final_url}")
        elif summary["wrongCredentialsMessage"]:
            raise RuntimeError("Duolingo returned its wrong-credentials response after full-key typing")
        else:
            raise RuntimeError("Duolingo login did not reach an authenticated state")
    except Exception as error:
        summary["error"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        (OUTPUT_DIR / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
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
