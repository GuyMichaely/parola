import asyncio
import json
import os
import time

import nodriver as uc

CDP_HOST = os.environ.get("DUOLINGO_CDP_HOST", "127.0.0.1")
CDP_PORT = int(os.environ.get("DUOLINGO_CDP_PORT", "9222"))
TIMEOUT_SECONDS = int(os.environ.get("DUOLINGO_AUTH_WAIT_SECONDS", "600"))


async def evaluate_json(tab, expression):
    encoded = await tab.evaluate(f"JSON.stringify(({expression}))", return_by_value=True)
    if not isinstance(encoded, str):
        encoded = getattr(encoded, "value", encoded)
    return json.loads(encoded) if encoded is not None else None


async def authenticated(tab):
    state = await evaluate_json(
        tab,
        """(() => ({
          href: location.href,
          hasPassword: Boolean(document.querySelector('input[data-test="password-input"]'))
        }))()""",
    )
    return (
        not state["hasPassword"]
        and "/log-in" not in state["href"]
        and "/login" not in state["href"]
    ), state


async def main():
    browser = None
    try:
        browser = await uc.start(config=uc.Config(host=CDP_HOST, port=CDP_PORT))

        probe = await browser.get("https://www.duolingo.com/learn", new_tab=True)
        await probe.sleep(2)
        ok, state = await authenticated(probe)
        if ok:
            print("Duolingo session is already authenticated:", state["href"])
            return

        tab = await browser.get("https://www.duolingo.com/log-in", new_tab=True)
        await tab.sleep(2)
        print(
            "Automatic login was not authenticated. Complete the login manually in the "
            f"residential Chrome window within {TIMEOUT_SECONDS} seconds; the workflow will continue automatically."
        )

        deadline = time.monotonic() + TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            try:
                ok, state = await authenticated(tab)
                if ok:
                    print("Manual Duolingo authentication detected:", state["href"])
                    return
            except Exception:
                # Navigation can temporarily destroy the old execution context.
                pass
            await asyncio.sleep(0.5)

        raise RuntimeError("Timed out waiting for an authenticated Duolingo session")
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
