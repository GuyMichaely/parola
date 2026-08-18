import asyncio
import base64
import gzip
import json
import os
from pathlib import Path

import nodriver as uc

CDP_HOST = os.environ.get("DUOLINGO_CDP_HOST", "127.0.0.1")
CDP_PORT = int(os.environ.get("DUOLINGO_CDP_PORT", "9222"))
OUTPUT = Path(
    os.environ.get(
        "DUOLINGO_SESSION_OUTPUT",
        "tests/fixtures/duolingo-session-state.b64",
    )
).resolve()
ORIGIN = "https://www.duolingo.com"


async def evaluate_json(tab, expression):
    encoded = await tab.evaluate(f"JSON.stringify(({expression}))", return_by_value=True)
    if not isinstance(encoded, str):
        encoded = getattr(encoded, "value", encoded)
    return json.loads(encoded) if encoded is not None else None


async def main():
    browser = None
    try:
        browser = await uc.start(config=uc.Config(host=CDP_HOST, port=CDP_PORT))
        tab = await browser.get(f"{ORIGIN}/learn", new_tab=True)
        await tab.sleep(3)
        state = await evaluate_json(
            tab,
            """(() => ({
              href: location.href,
              hasLoginForm: Boolean(document.querySelector('input[data-test="password-input"]'))
            }))()""",
        )
        if state["hasLoginForm"] or "/log-in" in state["href"]:
            raise RuntimeError("Chrome is not authenticated to Duolingo")

        cookies = await browser.cookies.get_all()
        cookie_json = []
        for cookie in cookies:
            domain = str(getattr(cookie, "domain", ""))
            if "duolingo.com" not in domain:
                continue
            cookie_json.append(cookie.to_json())

        local_storage = await evaluate_json(
            tab, "Object.fromEntries(Object.entries(localStorage))"
        ) or {}
        session_storage = await evaluate_json(
            tab, "Object.fromEntries(Object.entries(sessionStorage))"
        ) or {}

        payload = {
            "version": 1,
            "origin": ORIGIN,
            "cookies": cookie_json,
            "localStorage": local_storage,
            "sessionStorage": session_storage,
        }
        raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        encoded = base64.b64encode(gzip.compress(raw, compresslevel=9)).decode("ascii")
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(encoded + "\n", encoding="ascii")
        print(
            json.dumps(
                {
                    "output": str(OUTPUT),
                    "encodedBytes": len(encoded),
                    "cookieCount": len(cookie_json),
                    "localStorageKeyCount": len(local_storage),
                    "sessionStorageKeyCount": len(session_storage),
                },
                sort_keys=True,
            )
        )
    finally:
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
