import asyncio
import json
import os
import time
from pathlib import Path

import nodriver as uc

ACCOUNT = json.loads(Path(__file__).with_name("duolingo-test-account.json").read_text(encoding="utf-8"))
EMAIL = ACCOUNT["email"]
PASSWORD = ACCOUNT["password"]
OUTPUT_DIR = Path(os.environ.get("DUOLINGO_CAPTURE_DIR", "gold-replay-capture")).resolve()
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
CDP_HOST = os.environ.get("DUOLINGO_CDP_HOST", "127.0.0.1")
CDP_PORT = int(os.environ.get("DUOLINGO_CDP_PORT", "9222"))
CTRL = 2


def safe(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(k): safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [safe(v) for v in value]
    try:
        return safe(value.value)
    except Exception:
        return str(value)


async def evaluate_json(tab, expression):
    encoded = await tab.evaluate(f"JSON.stringify(({expression}))", return_by_value=True)
    if not isinstance(encoded, str):
        encoded = getattr(encoded, "value", encoded)
    return json.loads(encoded) if encoded is not None else None


async def wait_for(tab, selector, attempts=20):
    for _ in range(attempts):
        element = await tab.select(selector)
        if element:
            return element
        await asyncio.sleep(0.25)
    raise RuntimeError(f"Missing element: {selector}")


async def state(tab):
    return await evaluate_json(tab, """(() => {
      const e = document.querySelector('input[data-test="email-input"]');
      const p = document.querySelector('input[data-test="password-input"]');
      return {href: location.href, emailLength: e ? e.value.length : null,
        passwordLength: p ? p.value.length : null, loginFormPresent: Boolean(p),
        body: document.body ? document.body.innerText.toLowerCase() : ''};
    })()""")


async def install_trace(tab):
    await tab.evaluate("""(() => {
      window.__parolaReplayEvents = [];
      const started = performance.now();
      for (const type of ['focus','blur','click','keydown','keypress','keyup','paste','beforeinput','input','change','submit']) {
        document.addEventListener(type, event => {
          const target = event.target;
          const field = target && target.getAttribute ? target.getAttribute('data-test') : null;
          if (field !== 'email-input' && field !== 'password-input' && type !== 'submit') return;
          window.__parolaReplayEvents.push({tMs: Math.round((performance.now()-started)*10)/10,
            type, trusted:event.isTrusted, field, inputType:event.inputType||null,
            valueLength:target && typeof target.value === 'string' ? target.value.length : null});
        }, true);
      }
    })()""")


async def press_ctrl_v(tab):
    await tab.send(uc.cdp.input_.dispatch_key_event("rawKeyDown", modifiers=CTRL, key="Control", code="ControlLeft", windows_virtual_key_code=17))
    await tab.send(uc.cdp.input_.dispatch_key_event("rawKeyDown", modifiers=CTRL, key="v", code="KeyV", windows_virtual_key_code=86))
    await tab.send(uc.cdp.input_.dispatch_key_event("keyUp", modifiers=CTRL, key="v", code="KeyV", windows_virtual_key_code=86))
    await tab.send(uc.cdp.input_.dispatch_key_event("keyUp", key="Control", code="ControlLeft", windows_virtual_key_code=17))


async def main():
    browser = None
    network = []
    summary = {"automation":"gold-pattern-replay", "emailMethod":"Input.insertText", "passwordMethod":"navigator.clipboard+Ctrl-V", "submitMethod":"mouse_click"}

    def on_response(event):
        url = str(event.response.url)
        if "/login" in url:
            network.append({"url": url.split("?", 1)[0], "status": int(event.response.status), "mimeType": str(event.response.mime_type or "")})

    try:
        browser = await uc.start(config=uc.Config(host=CDP_HOST, port=CDP_PORT))
        await browser.grant_all_permissions()
        tab = await browser.get("https://www.duolingo.com/", new_tab=True)
        await tab.sleep(1)
        await tab.send(uc.cdp.network.clear_browser_cookies())
        await tab.send(uc.cdp.storage.clear_data_for_origin("https://www.duolingo.com", "all"))
        tab = await browser.get("https://www.duolingo.com/log-in", new_tab=True)
        await tab.sleep(2)
        tab.add_handler(uc.cdp.network.ResponseReceived, on_response)
        await tab.send(uc.cdp.network.enable())
        await install_trace(tab)

        email = await wait_for(tab, 'input[data-test="email-input"]')
        password = await wait_for(tab, 'input[data-test="password-input"]')
        await email.mouse_click()
        await tab.send(uc.cdp.input_.insert_text(EMAIL))
        await password.mouse_click()
        copied = await tab.evaluate("navigator.clipboard.writeText(" + json.dumps(PASSWORD) + ").then(() => true).catch(() => false)", await_promise=True, return_by_value=True)
        if not isinstance(copied, bool):
            copied = bool(getattr(copied, "value", False))
        summary["clipboardWriteSucceeded"] = copied
        if not copied:
            raise RuntimeError("Could not seed browser-host clipboard")
        await press_ctrl_v(tab)
        await asyncio.sleep(0.3)

        before = await state(tab)
        summary["beforeSubmit"] = {k:v for k,v in before.items() if k != "body"}
        if before["emailLength"] != len(EMAIL) or before["passwordLength"] != len(PASSWORD):
            raise RuntimeError("Replay did not produce exact credential lengths")

        submit = await wait_for(tab, 'button[data-test="register-button"]')
        await submit.mouse_click()
        deadline = time.monotonic() + 12
        final = before
        while time.monotonic() < deadline:
            try:
                final = await state(tab)
                if not final["loginFormPresent"] and "/log-in" not in final["href"]:
                    break
                if "wrong username or password" in final["body"]:
                    break
            except Exception:
                pass
            await asyncio.sleep(0.25)

        summary["final"] = {k:v for k,v in final.items() if k != "body"}
        summary["wrongCredentials"] = "wrong username or password" in final.get("body", "")
        summary["loggedIn"] = not final["loginFormPresent"] and "/log-in" not in final["href"]
        summary["loginResponses"] = network
        try:
            summary["inputEvents"] = await evaluate_json(tab, "window.__parolaReplayEvents || []")
        except Exception as error:
            summary["traceReadError"] = f"{type(error).__name__}: {error}"
        await tab.save_screenshot(filename=str(OUTPUT_DIR / "after-replay.png"))
        if not summary["loggedIn"]:
            raise RuntimeError("Gold-pattern automated replay did not log in")
    except Exception as error:
        summary["error"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        summary["network"] = network
        (OUTPUT_DIR / "summary.json").write_text(json.dumps(safe(summary), indent=2), encoding="utf-8")
        if browser is not None:
            try:
                for target in list(browser.targets):
                    try: target.connection.close()
                    except Exception: pass
            except Exception: pass


if __name__ == "__main__":
    asyncio.run(main())
