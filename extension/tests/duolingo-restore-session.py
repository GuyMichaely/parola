import asyncio
import base64
import gzip
import json
import os
from pathlib import Path

import nodriver as uc

CDP_HOST = os.environ.get("DUOLINGO_CDP_HOST", "127.0.0.1")
CDP_PORT = int(os.environ.get("DUOLINGO_CDP_PORT", "9222"))
STATE_B64 = os.environ.get("DUOLINGO_SESSION_STATE_B64", "")
OUTPUT_DIR = Path(os.environ.get("DUOLINGO_CAPTURE_DIR", "session-restore-capture")).resolve()
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
ORIGIN = "https://www.duolingo.com"


async def evaluate_json(tab, expression):
    encoded = await tab.evaluate(f"JSON.stringify(({expression}))", return_by_value=True)
    if not isinstance(encoded, str):
        encoded = getattr(encoded, "value", encoded)
    return json.loads(encoded) if encoded is not None else None


def decode_state(value):
    if not value:
        raise RuntimeError("DUOLINGO_SESSION_STATE_B64 is empty")
    raw = gzip.decompress(base64.b64decode(value))
    payload = json.loads(raw)
    if payload.get("version") != 1 or payload.get("origin") != ORIGIN:
        raise RuntimeError("Unsupported Duolingo session-state payload")
    return payload


async def main():
    browser = None
    summary = {"test": "github-hosted-session-restore"}
    try:
        payload = decode_state(STATE_B64)
        summary["cookieCount"] = len(payload.get("cookies") or [])
        summary["localStorageKeyCount"] = len(payload.get("localStorage") or {})
        summary["sessionStorageKeyCount"] = len(payload.get("sessionStorage") or {})

        browser = await uc.start(config=uc.Config(host=CDP_HOST, port=CDP_PORT))
        seed = await browser.get(f"{ORIGIN}/", new_tab=True)
        await seed.sleep(1)
        await seed.send(uc.cdp.network.clear_browser_cookies())
        await seed.send(uc.cdp.storage.clear_data_for_origin(ORIGIN, "all"))

        params = [uc.cdp.network.CookieParam.from_json(c) for c in payload.get("cookies") or []]
        await browser.cookies.set_all(params)

        local_storage = payload.get("localStorage") or {}
        session_storage = payload.get("sessionStorage") or {}
        if local_storage:
            await seed.evaluate("Object.assign(localStorage," + json.dumps(local_storage) + ")")
        if session_storage:
            await seed.evaluate("Object.assign(sessionStorage," + json.dumps(session_storage) + ")")

        await seed.get(f"{ORIGIN}/learn")
        await seed.sleep(5)
        state = await evaluate_json(
            seed,
            """(() => ({
              href: location.href,
              hasLoginForm: Boolean(document.querySelector('input[data-test="password-input"]')),
              body: document.body ? document.body.innerText.toLowerCase() : ''
            }))()""",
        )
        summary["finalUrl"] = state["href"]
        summary["loginFormPresent"] = state["hasLoginForm"]
        summary["authenticated"] = (
            not state["hasLoginForm"]
            and "/log-in" not in state["href"]
            and "log in" not in state["body"][:500]
        )
        try:
            await seed.save_screenshot(filename=str(OUTPUT_DIR / "after-session-restore.png"))
        except Exception:
            pass
        if not summary["authenticated"]:
            raise RuntimeError("Imported Duolingo session is no longer authenticated")
    except Exception as exc:
        summary["error"] = f"{type(exc).__name__}: {exc}"
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
