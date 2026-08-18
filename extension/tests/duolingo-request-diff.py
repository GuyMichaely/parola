import asyncio
import hashlib
import json
import os
import time
from pathlib import Path

import nodriver as uc

ACCOUNT = json.loads(Path(__file__).with_name("duolingo-test-account.json").read_text(encoding="utf-8"))
EMAIL = ACCOUNT["email"]
PASSWORD = ACCOUNT["password"]
OUTPUT_DIR = Path(os.environ.get("DUOLINGO_CAPTURE_DIR", "request-diff-capture")).resolve()
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
CDP_HOST = os.environ.get("DUOLINGO_CDP_HOST", "127.0.0.1")
CDP_PORT = int(os.environ.get("DUOLINGO_CDP_PORT", "9222"))
CTRL = 2

SENSITIVE_HEADER_NAMES = {"authorization", "cookie", "set-cookie", "x-csrf-token", "x-csrftoken"}


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def redact_value(value):
    if value == EMAIL:
        return {"kind": "email", "length": len(value), "sha256_16": digest(value)}
    if value == PASSWORD:
        return {"kind": "password", "length": len(value), "sha256_16": digest(value)}
    if isinstance(value, dict):
        return {str(k): redact_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [redact_value(v) for v in value]
    if isinstance(value, str):
        return {"kind": "string", "length": len(value), "sha256_16": digest(value)}
    return value


def sanitize_post_data(text):
    if not text:
        return None
    try:
        return {"encoding": "json", "value": redact_value(json.loads(text))}
    except Exception:
        return {"encoding": "opaque", "length": len(text), "sha256_16": digest(text)}


def sanitize_headers(headers):
    result = {}
    for key, value in dict(headers or {}).items():
        lower = str(key).lower()
        if lower in SENSITIVE_HEADER_NAMES:
            result[str(key)] = "<redacted>"
        elif lower in {"content-type", "origin", "referer", "user-agent", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"}:
            result[str(key)] = str(value)
        else:
            result[str(key)] = {"length": len(str(value)), "sha256_16": digest(str(value))}
    return result


async def evaluate_json(tab, expression):
    encoded = await tab.evaluate(f"JSON.stringify(({expression}))", return_by_value=True)
    if not isinstance(encoded, str):
        encoded = getattr(encoded, "value", encoded)
    return json.loads(encoded) if encoded is not None else None


async def wait_for(tab, selector, attempts=24):
    for _ in range(attempts):
        element = await tab.select(selector)
        if element:
            return element
        await asyncio.sleep(0.25)
    raise RuntimeError(f"Missing element: {selector}")


async def press_ctrl_v(tab):
    await tab.send(uc.cdp.input_.dispatch_key_event("rawKeyDown", modifiers=CTRL, key="Control", code="ControlLeft", windows_virtual_key_code=17))
    await tab.send(uc.cdp.input_.dispatch_key_event("rawKeyDown", modifiers=CTRL, key="v", code="KeyV", windows_virtual_key_code=86))
    await tab.send(uc.cdp.input_.dispatch_key_event("keyUp", modifiers=CTRL, key="v", code="KeyV", windows_virtual_key_code=86))
    await tab.send(uc.cdp.input_.dispatch_key_event("keyUp", key="Control", code="ControlLeft", windows_virtual_key_code=17))


async def clear_auth(tab):
    await tab.send(uc.cdp.network.clear_browser_cookies())
    await tab.send(uc.cdp.storage.clear_data_for_origin("https://www.duolingo.com", "all"))


async def attempt(browser, method):
    bootstrap = await browser.get("https://www.duolingo.com/", new_tab=True)
    await bootstrap.sleep(1)
    await clear_auth(bootstrap)
    try:
        await bootstrap.close()
    except Exception:
        pass

    tab = await browser.get("https://www.duolingo.com/log-in", new_tab=True)
    await tab.sleep(2)
    await tab.send(uc.cdp.network.enable())
    await tab.send(uc.cdp.autofill.enable())
    requests = []
    responses = []

    def on_request(event):
        request = event.request
        url = str(request.url)
        if "/2023-05-23/login" not in url:
            return
        requests.append({
            "method": str(request.method),
            "url": url.split("?", 1)[0],
            "hasPostData": bool(getattr(request, "has_post_data", False)),
            "postData": sanitize_post_data(getattr(request, "post_data", None)),
            "headers": sanitize_headers(getattr(request, "headers", {})),
            "initiator": str(getattr(getattr(event, "initiator", None), "type_", "")),
            "resourceType": str(getattr(event, "type_", "")),
        })

    def on_response(event):
        url = str(event.response.url)
        if "/2023-05-23/login" in url:
            responses.append({"status": int(event.response.status), "url": url.split("?", 1)[0]})

    tab.add_handler(uc.cdp.network.RequestWillBeSent, on_request)
    tab.add_handler(uc.cdp.network.ResponseReceived, on_response)

    email = await wait_for(tab, 'input[data-test="email-input"]')
    password = await wait_for(tab, 'input[data-test="password-input"]')
    await email.mouse_click()
    if method == "insertText":
        await tab.send(uc.cdp.input_.insert_text(EMAIL))
    else:
        address = uc.cdp.autofill.Address(fields=[uc.cdp.autofill.AddressField(name="EMAIL_ADDRESS", value=EMAIL)])
        await tab.send(uc.cdp.autofill.trigger(email.backend_node_id, address=address))
    await asyncio.sleep(0.3)

    await password.mouse_click()
    copied = await tab.evaluate(
        "navigator.clipboard.writeText(" + json.dumps(PASSWORD) + ").then(() => true).catch(() => false)",
        await_promise=True,
        return_by_value=True,
    )
    if not isinstance(copied, bool):
        copied = bool(getattr(copied, "value", False))
    if not copied:
        raise RuntimeError("clipboard write failed")
    await press_ctrl_v(tab)
    await asyncio.sleep(0.3)

    before = await evaluate_json(tab, """(() => {
      const e=document.querySelector('input[data-test="email-input"]');
      const p=document.querySelector('input[data-test="password-input"]');
      return {emailLength:e?e.value.length:null,passwordLength:p?p.value.length:null};
    })()""")
    submit = await wait_for(tab, 'button[data-test="register-button"]')
    await submit.mouse_click()

    deadline = time.monotonic() + 10
    final_url = ""
    wrong = False
    while time.monotonic() < deadline:
        try:
            s = await evaluate_json(tab, """(() => ({href:location.href, body:document.body?document.body.innerText.toLowerCase():'', hasPassword:Boolean(document.querySelector('input[data-test="password-input"]'))}))()""")
            final_url = s["href"]
            wrong = "wrong username or password" in s["body"]
            if wrong or (not s["hasPassword"] and "/log-in" not in final_url):
                break
        except Exception:
            pass
        await asyncio.sleep(0.2)

    result = {
        "method": method,
        "beforeSubmit": before,
        "requests": requests,
        "responses": responses,
        "finalUrl": final_url,
        "wrongCredentials": wrong,
    }
    try:
        await tab.close()
    except Exception:
        pass
    return result


async def main():
    browser = None
    result = {}
    try:
        browser = await uc.start(config=uc.Config(host=CDP_HOST, port=CDP_PORT))
        await browser.send(uc.cdp.browser.grant_permissions([
            uc.cdp.browser.PermissionType.CLIPBOARD_READ_WRITE,
            uc.cdp.browser.PermissionType.CLIPBOARD_SANITIZED_WRITE,
        ], origin="https://www.duolingo.com"))
        result["rejectedInsertText"] = await attempt(browser, "insertText")
        result["acceptedAutofill"] = await attempt(browser, "autofill")
    finally:
        (OUTPUT_DIR / "request-diff.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
        if browser is not None:
            try:
                for target in list(browser.targets):
                    try: target.connection.close()
                    except Exception: pass
            except Exception: pass


if __name__ == "__main__":
    asyncio.run(main())
