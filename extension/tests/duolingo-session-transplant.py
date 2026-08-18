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
OUTPUT_DIR = Path(os.environ.get("DUOLINGO_CAPTURE_DIR", "session-transplant-capture")).resolve()
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
REMOTE_HOST = os.environ.get("DUOLINGO_CDP_HOST", "127.0.0.1")
REMOTE_PORT = int(os.environ.get("DUOLINGO_CDP_PORT", "9222"))
CHROME_PATH = os.environ.get("CHROME_PATH", "/usr/bin/google-chrome")
CTRL = 2


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0)); return s.getsockname()[1]


def launch_local_chrome():
    port = free_port()
    profile = Path(tempfile.mkdtemp(prefix="parola-session-transplant-"))
    out = (OUTPUT_DIR / "local-chrome-stdout.log").open("wb")
    err = (OUTPUT_DIR / "local-chrome-stderr.log").open("wb")
    args = [CHROME_PATH, f"--user-data-dir={profile}", f"--remote-debugging-port={port}",
            "--remote-debugging-address=127.0.0.1", "--no-first-run", "--no-default-browser-check",
            "--password-store=basic", "--no-sandbox", "--disable-dev-shm-usage", "--headless=new", "about:blank"]
    proc = subprocess.Popen(args, stdout=out, stderr=err)
    deadline = time.monotonic()+30
    while time.monotonic()<deadline:
        if proc.poll() is not None: raise RuntimeError(f"local Chrome exited {proc.returncode}")
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1) as r:
                json.loads(r.read()); return proc,out,err,port
        except Exception: time.sleep(0.25)
    raise RuntimeError("local Chrome CDP timeout")


async def evaluate_json(tab, expression):
    encoded = await tab.evaluate(f"JSON.stringify(({expression}))", return_by_value=True)
    if not isinstance(encoded, str): encoded = getattr(encoded, "value", encoded)
    return json.loads(encoded) if encoded is not None else None


async def wait_for(tab, selector, attempts=28):
    for _ in range(attempts):
        el = await tab.select(selector)
        if el: return el
        await asyncio.sleep(0.25)
    raise RuntimeError(f"missing {selector}")


async def press_ctrl_v(tab):
    await tab.send(uc.cdp.input_.dispatch_key_event("rawKeyDown", modifiers=CTRL, key="Control", code="ControlLeft", windows_virtual_key_code=17))
    await tab.send(uc.cdp.input_.dispatch_key_event("rawKeyDown", modifiers=CTRL, key="v", code="KeyV", windows_virtual_key_code=86))
    await tab.send(uc.cdp.input_.dispatch_key_event("keyUp", modifiers=CTRL, key="v", code="KeyV", windows_virtual_key_code=86))
    await tab.send(uc.cdp.input_.dispatch_key_event("keyUp", key="Control", code="ControlLeft", windows_virtual_key_code=17))


async def login_remote(browser):
    await browser.send(uc.cdp.browser.grant_permissions([
        uc.cdp.browser.PermissionType.CLIPBOARD_READ_WRITE,
        uc.cdp.browser.PermissionType.CLIPBOARD_SANITIZED_WRITE,
    ], origin="https://www.duolingo.com"))
    for attempt in range(1, 4):
        bootstrap = await browser.get("https://www.duolingo.com/", new_tab=True)
        await bootstrap.sleep(1)
        await tab_clear(bootstrap)
        try: await bootstrap.close()
        except Exception: pass
        tab = await browser.get("https://www.duolingo.com/log-in", new_tab=True)
        await tab.sleep(2)
        await tab.send(uc.cdp.autofill.enable())
        email = await wait_for(tab, 'input[data-test="email-input"]')
        password = await wait_for(tab, 'input[data-test="password-input"]')
        await email.mouse_click()
        address = uc.cdp.autofill.Address(fields=[uc.cdp.autofill.AddressField(name="EMAIL_ADDRESS", value=EMAIL)])
        await tab.send(uc.cdp.autofill.trigger(email.backend_node_id, address=address))
        await asyncio.sleep(0.3)
        await password.mouse_click()
        copied = await tab.evaluate("navigator.clipboard.writeText("+json.dumps(PASSWORD)+").then(()=>true).catch(()=>false)", await_promise=True, return_by_value=True)
        if not isinstance(copied, bool): copied = bool(getattr(copied, "value", False))
        if not copied: raise RuntimeError("remote clipboard write failed")
        await press_ctrl_v(tab); await asyncio.sleep(0.3)
        submit = await wait_for(tab, 'button[data-test="register-button"]')
        await submit.mouse_click()
        deadline=time.monotonic()+12
        final=None
        while time.monotonic()<deadline:
            try:
                final=await evaluate_json(tab, """(() => ({href:location.href,body:document.body?document.body.innerText.toLowerCase():'',hasPassword:Boolean(document.querySelector('input[data-test="password-input"]'))}))()""")
                if not final['hasPassword'] and '/log-in' not in final['href']: return tab, attempt
                if 'wrong username or password' in final['body']: break
            except Exception: pass
            await asyncio.sleep(0.25)
        try: await tab.close()
        except Exception: pass
        await asyncio.sleep(attempt)
    raise RuntimeError("residential login did not succeed in three attempts")


async def tab_clear(tab):
    await tab.send(uc.cdp.network.clear_browser_cookies())
    await tab.send(uc.cdp.storage.clear_data_for_origin("https://www.duolingo.com", "all"))


async def main():
    remote = local = None
    proc = out = err = None
    summary = {"test":"residential-session-to-github-runner"}
    try:
        remote = await uc.start(config=uc.Config(host=REMOTE_HOST, port=REMOTE_PORT))
        logged_tab, login_attempt = await login_remote(remote)
        summary["residentialLoginSucceeded"] = True
        summary["residentialLoginAttempt"] = login_attempt
        cookies = await remote.cookies.get_all()
        local_storage = await evaluate_json(logged_tab, "Object.fromEntries(Object.entries(localStorage))")
        session_storage = await evaluate_json(logged_tab, "Object.fromEntries(Object.entries(sessionStorage))")
        summary["cookieCount"] = len(cookies)
        summary["httpOnlyCookieCount"] = sum(1 for c in cookies if bool(getattr(c, 'http_only', False)))
        summary["localStorageKeyCount"] = len(local_storage or {})
        summary["sessionStorageKeyCount"] = len(session_storage or {})

        proc,out,err,port = launch_local_chrome()
        local = await uc.start(config=uc.Config(host="127.0.0.1", port=port))
        seed = await local.get("https://www.duolingo.com/", new_tab=True)
        await seed.sleep(1)
        await local.cookies.set_all(cookies)
        if local_storage:
            await seed.evaluate("Object.assign(localStorage," + json.dumps(local_storage) + ")")
        if session_storage:
            await seed.evaluate("Object.assign(sessionStorage," + json.dumps(session_storage) + ")")
        await seed.get("https://www.duolingo.com/learn")
        await seed.sleep(5)
        state = await evaluate_json(seed, """(() => ({href:location.href,hasLoginForm:Boolean(document.querySelector('input[data-test="password-input"]')),body:document.body?document.body.innerText.toLowerCase():''}))()""")
        summary["githubRunnerUrl"] = state["href"]
        summary["githubRunnerLoginFormPresent"] = state["hasLoginForm"]
        summary["githubRunnerLooksAuthenticated"] = (not state["hasLoginForm"] and '/log-in' not in state["href"] and 'log in' not in state["body"][:500])
        try: await seed.save_screenshot(filename=str(OUTPUT_DIR/"github-runner-after-session-import.png"))
        except Exception: pass
    except Exception as exc:
        summary["error"] = f"{type(exc).__name__}: {exc}"
        raise
    finally:
        (OUTPUT_DIR/"summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
        for browser in [local, remote]:
            if browser is not None:
                try:
                    for target in list(browser.targets):
                        try: target.connection.close()
                        except Exception: pass
                except Exception: pass
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try: proc.wait(timeout=5)
            except subprocess.TimeoutExpired: proc.kill(); proc.wait(timeout=5)
        if out: out.close()
        if err: err.close()


if __name__ == "__main__": asyncio.run(main())
