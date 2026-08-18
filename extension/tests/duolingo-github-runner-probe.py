import asyncio
import json
import os
import socket
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import nodriver as uc

ACCOUNT = json.loads(Path(__file__).with_name("duolingo-test-account.json").read_text(encoding="utf-8"))
EMAIL = ACCOUNT["email"]
PASSWORD = ACCOUNT["password"]
OUTPUT_DIR = Path(os.environ.get("DUOLINGO_CAPTURE_DIR", "github-runner-capture")).resolve()
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
CHROME_PATH = os.environ.get("CHROME_PATH", "/usr/bin/google-chrome")
CTRL = 2


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_cdp(port, process):
    url = f"http://127.0.0.1:{port}/json/version"
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Chrome exited with {process.returncode}")
        try:
            with urllib.request.urlopen(url, timeout=1) as r:
                return json.loads(r.read())
        except Exception:
            time.sleep(0.25)
    raise RuntimeError("Chrome CDP endpoint timeout")


def launch_chrome():
    port = free_port()
    profile = Path(tempfile.mkdtemp(prefix="parola-gh-runner-"))
    args = [
        CHROME_PATH,
        f"--user-data-dir={profile}",
        f"--remote-debugging-port={port}",
        "--remote-debugging-address=127.0.0.1",
        "--no-first-run",
        "--no-default-browser-check",
        "--password-store=basic",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--headless=new",
        "about:blank",
    ]
    out = (OUTPUT_DIR / "chrome-stdout.log").open("wb")
    err = (OUTPUT_DIR / "chrome-stderr.log").open("wb")
    process = subprocess.Popen(args, stdout=out, stderr=err)
    version = wait_cdp(port, process)
    return process, out, err, port, version, args


async def evaluate_json(tab, expression):
    encoded = await tab.evaluate(f"JSON.stringify(({expression}))", return_by_value=True)
    if not isinstance(encoded, str):
        encoded = getattr(encoded, "value", encoded)
    return json.loads(encoded) if encoded is not None else None


async def wait_for(tab, selector, attempts=30):
    for _ in range(attempts):
        el = await tab.select(selector)
        if el:
            return el
        await asyncio.sleep(0.25)
    raise RuntimeError(f"Missing {selector}")


async def press_ctrl_v(tab):
    await tab.send(uc.cdp.input_.dispatch_key_event("rawKeyDown", modifiers=CTRL, key="Control", code="ControlLeft", windows_virtual_key_code=17))
    await tab.send(uc.cdp.input_.dispatch_key_event("rawKeyDown", modifiers=CTRL, key="v", code="KeyV", windows_virtual_key_code=86))
    await tab.send(uc.cdp.input_.dispatch_key_event("keyUp", modifiers=CTRL, key="v", code="KeyV", windows_virtual_key_code=86))
    await tab.send(uc.cdp.input_.dispatch_key_event("keyUp", key="Control", code="ControlLeft", windows_virtual_key_code=17))


async def main():
    process = out = err = browser = None
    summary = {"environment": "github-hosted-runner", "emailMethod": "CDP Autofill.trigger", "passwordMethod": "clipboard+Ctrl-V"}
    request_meta = []
    responses = []
    try:
        process, out, err, port, version, args = launch_chrome()
        summary["chromeVersion"] = version.get("Browser")
        summary["chromeArgs"] = [a for a in args if not a.startswith("--user-data-dir=")]
        browser = await uc.start(config=uc.Config(host="127.0.0.1", port=port))
        await browser.send(uc.cdp.browser.grant_permissions([
            uc.cdp.browser.PermissionType.CLIPBOARD_READ_WRITE,
            uc.cdp.browser.PermissionType.CLIPBOARD_SANITIZED_WRITE,
        ], origin="https://www.duolingo.com"))
        tab = await browser.get("https://www.duolingo.com/log-in", new_tab=True)
        await tab.sleep(3)
        await tab.send(uc.cdp.network.enable())
        await tab.send(uc.cdp.autofill.enable())

        def on_request(event):
            req = event.request
            if "/2023-05-23/login" not in str(req.url):
                return
            post = getattr(req, "post_data", "") or ""
            try:
                body = json.loads(post)
                signal = body.get("signal") or {}
                request_meta.append({
                    "keys": sorted(body.keys()),
                    "identifierMatches": body.get("identifier") == EMAIL,
                    "passwordMatches": body.get("password") == PASSWORD,
                    "distinctIdLength": len(str(body.get("distinctId") or "")),
                    "signalVendor": signal.get("vendor"),
                    "signalTokenLength": len(str(signal.get("token") or "")),
                    "signalSiteKeyLength": len(str(signal.get("siteKey") or "")),
                })
            except Exception:
                request_meta.append({"postDataLength": len(post)})

        def on_response(event):
            if "/2023-05-23/login" in str(event.response.url):
                responses.append(int(event.response.status))

        tab.add_handler(uc.cdp.network.RequestWillBeSent, on_request)
        tab.add_handler(uc.cdp.network.ResponseReceived, on_response)

        email = await wait_for(tab, 'input[data-test="email-input"]')
        password = await wait_for(tab, 'input[data-test="password-input"]')
        await email.mouse_click()
        address = uc.cdp.autofill.Address(fields=[uc.cdp.autofill.AddressField(name="EMAIL_ADDRESS", value=EMAIL)])
        await tab.send(uc.cdp.autofill.trigger(email.backend_node_id, address=address))
        await asyncio.sleep(0.3)
        await password.mouse_click()
        copied = await tab.evaluate("navigator.clipboard.writeText(" + json.dumps(PASSWORD) + ").then(() => true).catch(() => false)", await_promise=True, return_by_value=True)
        if not isinstance(copied, bool):
            copied = bool(getattr(copied, "value", False))
        summary["clipboardWriteSucceeded"] = copied
        if not copied:
            raise RuntimeError("clipboard write failed")
        await press_ctrl_v(tab)
        await asyncio.sleep(0.3)

        before = await evaluate_json(tab, """(() => { const e=document.querySelector('input[data-test="email-input"]'); const p=document.querySelector('input[data-test="password-input"]'); return {emailLength:e?e.value.length:null,passwordLength:p?p.value.length:null}; })()""")
        summary["beforeSubmit"] = before
        submit = await wait_for(tab, 'button[data-test="register-button"]')
        await submit.mouse_click()

        deadline = time.monotonic() + 15
        final = None
        while time.monotonic() < deadline:
            try:
                final = await evaluate_json(tab, """(() => ({href:location.href,body:document.body?document.body.innerText.toLowerCase():'',hasPassword:Boolean(document.querySelector('input[data-test="password-input"]'))}))()""")
                if "wrong username or password" in final["body"] or (not final["hasPassword"] and "/log-in" not in final["href"]):
                    break
            except Exception:
                pass
            await asyncio.sleep(0.25)

        summary["finalUrl"] = final["href"] if final else None
        summary["wrongCredentials"] = bool(final and "wrong username or password" in final["body"])
        summary["loggedIn"] = bool(final and not final["hasPassword"] and "/log-in" not in final["href"])
        summary["loginRequest"] = request_meta
        summary["loginResponses"] = responses
        try:
            await tab.save_screenshot(filename=str(OUTPUT_DIR / "after-login.png"))
        except Exception:
            pass
    except Exception as exc:
        summary["error"] = f"{type(exc).__name__}: {exc}"
        raise
    finally:
        (OUTPUT_DIR / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
        if browser is not None:
            try:
                for target in list(browser.targets):
                    try: target.connection.close()
                    except Exception: pass
            except Exception: pass
        if process is not None and process.poll() is None:
            process.terminate()
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait(timeout=5)
        if out: out.close()
        if err: err.close()


if __name__ == "__main__":
    asyncio.run(main())
