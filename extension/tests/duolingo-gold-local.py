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
OUTPUT_DIR = Path(os.environ.get("DUOLINGO_CAPTURE_DIR", "gold-local-capture")).resolve()
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
CHROME_PATH = os.environ.get("CHROME_PATH", "/usr/bin/google-chrome")
CTRL = 2


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
            raise RuntimeError(f"Chrome exited early with code {process.returncode}")
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                return json.loads(response.read())
        except Exception as error:
            last_error = error
            time.sleep(0.25)
    raise RuntimeError(f"Chrome CDP endpoint unavailable: {last_error}")


def launch_chrome():
    port = free_port()
    profile_dir = Path(tempfile.mkdtemp(prefix="parola-gold-local-"))
    stdout_file = (OUTPUT_DIR / "chrome-stdout.log").open("wb")
    stderr_file = (OUTPUT_DIR / "chrome-stderr.log").open("wb")
    args = [
        CHROME_PATH,
        f"--user-data-dir={profile_dir}",
        f"--remote-debugging-port={port}",
        "--remote-debugging-address=127.0.0.1",
        "--no-first-run",
        "--no-default-browser-check",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "about:blank",
    ]
    process = subprocess.Popen(args, stdout=stdout_file, stderr=stderr_file)
    version = wait_for_debug_endpoint(port, process)
    return process, stdout_file, stderr_file, port, version


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


async def wait_for(tab, selector, attempts=30):
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


async def press_ctrl_v(tab):
    await tab.send(uc.cdp.input_.dispatch_key_event("rawKeyDown", modifiers=CTRL, key="Control", code="ControlLeft", windows_virtual_key_code=17))
    await tab.send(uc.cdp.input_.dispatch_key_event("rawKeyDown", modifiers=CTRL, key="v", code="KeyV", windows_virtual_key_code=86))
    await tab.send(uc.cdp.input_.dispatch_key_event("keyUp", modifiers=CTRL, key="v", code="KeyV", windows_virtual_key_code=86))
    await tab.send(uc.cdp.input_.dispatch_key_event("keyUp", key="Control", code="ControlLeft", windows_virtual_key_code=17))


async def main():
    process = stdout_file = stderr_file = browser = None
    network = []
    summary = {
        "automation": "github-runner-gold-pattern",
        "emailMethod": "CDP Autofill.trigger",
        "passwordMethod": "navigator.clipboard+Ctrl-V",
        "submitMethod": "mouse_click",
    }

    def on_response(event):
        url = str(event.response.url)
        if "/login" in url:
            network.append({
                "url": url.split("?", 1)[0],
                "status": int(event.response.status),
                "mimeType": str(event.response.mime_type or ""),
            })

    try:
        process, stdout_file, stderr_file, port, version = launch_chrome()
        summary["chromeVersion"] = version
        browser = await uc.start(config=uc.Config(host="127.0.0.1", port=port))
        await browser.send(uc.cdp.browser.grant_permissions([
            uc.cdp.browser.PermissionType.CLIPBOARD_READ_WRITE,
            uc.cdp.browser.PermissionType.CLIPBOARD_SANITIZED_WRITE,
        ], origin="https://www.duolingo.com"))

        tab = await browser.get("https://www.duolingo.com/log-in", new_tab=True)
        await tab.sleep(3)
        tab.add_handler(uc.cdp.network.ResponseReceived, on_response)
        await tab.send(uc.cdp.network.enable())
        await tab.send(uc.cdp.autofill.enable())

        email = await wait_for(tab, 'input[data-test="email-input"]')
        password = await wait_for(tab, 'input[data-test="password-input"]')
        await email.mouse_click()
        address = uc.cdp.autofill.Address(fields=[
            uc.cdp.autofill.AddressField(name="EMAIL_ADDRESS", value=EMAIL)
        ])
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
        summary["clipboardWriteSucceeded"] = copied
        if not copied:
            raise RuntimeError("Could not seed browser clipboard")
        await press_ctrl_v(tab)
        await asyncio.sleep(0.3)

        before = await state(tab)
        summary["beforeSubmit"] = {k: v for k, v in before.items() if k != "body"}
        if before["emailLength"] != len(EMAIL) or before["passwordLength"] != len(PASSWORD):
            raise RuntimeError("Gold input pattern did not produce expected credential lengths")

        submit = await wait_for(tab, 'button[data-test="register-button"]')
        await submit.mouse_click()
        deadline = time.monotonic() + 15
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

        summary["final"] = {k: v for k, v in final.items() if k != "body"}
        summary["wrongCredentials"] = "wrong username or password" in final.get("body", "")
        summary["loggedIn"] = not final["loginFormPresent"] and "/log-in" not in final["href"]
        summary["network"] = network
        try:
            await tab.save_screenshot(filename=str(OUTPUT_DIR / "after-login.png"))
        except Exception:
            pass
        if not summary["loggedIn"]:
            raise RuntimeError("GitHub-runner gold-pattern login did not log in")
    except Exception as error:
        summary["error"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        summary["network"] = network
        (OUTPUT_DIR / "summary.json").write_text(json.dumps(safe(summary), indent=2), encoding="utf-8")
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
