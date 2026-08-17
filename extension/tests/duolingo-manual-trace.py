import asyncio
import json
import os
import re
import time
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import nodriver as uc

OUTPUT_DIR = Path(os.environ.get("DUOLINGO_CAPTURE_DIR", "manual-login-trace")).resolve()
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
CDP_HOST = os.environ.get("DUOLINGO_CDP_HOST", "127.0.0.1")
CDP_PORT = int(os.environ.get("DUOLINGO_CDP_PORT", "9222"))
TIMEOUT_SECONDS = int(os.environ.get("DUOLINGO_MANUAL_TRACE_TIMEOUT_SECONDS", "600"))


def sanitize_url(value):
    if not value:
        return ""
    try:
        parts = urlsplit(str(value))
    except Exception:
        return ""
    if parts.scheme not in {"http", "https"}:
        return f"{parts.scheme}:" if parts.scheme else ""
    # Deliberately discard query strings and fragments so tokens or identifiers
    # cannot leak into the trace.
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def stringify(value):
    if value is None:
        return None
    try:
        return value.value
    except Exception:
        return str(value)


def attr(obj, name, default=None):
    try:
        return getattr(obj, name)
    except Exception:
        return default


async def page_state(tab):
    return await tab.evaluate(
        """
        (() => {
          const identity = document.querySelector('input[data-test="email-input"]');
          const password = document.querySelector('input[data-test="password-input"]');
          const bodyText = document.body ? document.body.innerText.toLowerCase() : '';
          return {
            href: location.href,
            loginFormPresent: Boolean(password),
            wrongCredentials: bodyText.includes('wrong username or password'),
            identityLength: identity ? identity.value.length : null,
            passwordLength: password ? password.value.length : null,
            activeDataTest: document.activeElement && document.activeElement.getAttribute
              ? document.activeElement.getAttribute('data-test')
              : null
          };
        })()
        """,
        return_by_value=True,
    )


async def install_input_trace(tab):
    await tab.evaluate(
        """
        (() => {
          window.__parolaManualLoginEvents = [];
          const started = performance.now();
          const push = (event, extra = {}) => {
            const target = event.target;
            const field = target && target.getAttribute ? target.getAttribute('data-test') : null;
            window.__parolaManualLoginEvents.push({
              tMs: Math.round((performance.now() - started) * 10) / 10,
              type: event.type,
              trusted: event.isTrusted,
              field,
              inputType: event.inputType || null,
              valueLength: target && typeof target.value === 'string' ? target.value.length : null,
              selectionStart: target && typeof target.selectionStart === 'number' ? target.selectionStart : null,
              selectionEnd: target && typeof target.selectionEnd === 'number' ? target.selectionEnd : null,
              ...extra
            });
          };

          const fieldEvents = [
            'focus', 'blur', 'click', 'keydown', 'keypress', 'keyup',
            'paste', 'beforeinput', 'input', 'change'
          ];
          for (const type of fieldEvents) {
            document.addEventListener(type, event => {
              const field = event.target && event.target.getAttribute
                ? event.target.getAttribute('data-test')
                : null;
              if (field !== 'email-input' && field !== 'password-input') return;
              push(event, {
                clipboardTypes: event.clipboardData ? Array.from(event.clipboardData.types || []) : []
              });
            }, true);
          }

          for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
            document.addEventListener(type, event => {
              const test = event.target && event.target.closest
                ? event.target.closest('[data-test]')
                : null;
              const dataTest = test && test.getAttribute ? test.getAttribute('data-test') : null;
              if (dataTest !== 'register-button') return;
              push(event, { control: 'login-button' });
            }, true);
          }

          document.addEventListener('submit', event => {
            push(event, { control: 'form-submit' });
          }, true);
        })()
        """
    )


async def read_input_trace(tab):
    return await tab.evaluate(
        "window.__parolaManualLoginEvents || []", return_by_value=True
    )


async def main():
    browser = None
    network_events = []
    input_events = []
    seen_input_events = 0
    summary = {
        "automation": "manual-residential-chrome-gold-trace",
        "cdpHost": CDP_HOST,
        "cdpPort": CDP_PORT,
        "timeoutSeconds": TIMEOUT_SECONDS,
        "automationFilledFields": False,
        "automationSubmitted": False,
        "privacy": {
            "requestBodiesRecorded": False,
            "responseBodiesRecorded": False,
            "requestHeadersRecorded": False,
            "responseHeadersRecorded": False,
            "cookiesRecorded": False,
            "clipboardContentsRecorded": False,
            "queryStringsRecorded": False,
        },
    }

    def on_request(event):
        request = event.request
        network_events.append(
            {
                "kind": "request",
                "requestId": str(event.request_id),
                "method": str(request.method),
                "url": sanitize_url(request.url),
                "documentUrl": sanitize_url(attr(event, "document_url", "")),
                "resourceType": stringify(attr(event, "type_")),
                "initiatorType": stringify(attr(attr(event, "initiator"), "type_")),
                "hasPostData": bool(attr(request, "has_post_data", False)),
            }
        )

    def on_response(event):
        response = event.response
        network_events.append(
            {
                "kind": "response",
                "requestId": str(event.request_id),
                "url": sanitize_url(response.url),
                "status": int(response.status),
                "statusText": str(response.status_text or ""),
                "mimeType": str(response.mime_type or ""),
                "protocol": str(response.protocol or ""),
                "resourceType": stringify(attr(event, "type_")),
                "fromDiskCache": bool(attr(response, "from_disk_cache", False)),
                "fromServiceWorker": bool(attr(response, "from_service_worker", False)),
            }
        )

    def on_failed(event):
        network_events.append(
            {
                "kind": "failed",
                "requestId": str(event.request_id),
                "resourceType": stringify(attr(event, "type_")),
                "errorText": str(attr(event, "error_text", "")),
                "canceled": bool(attr(event, "canceled", False)),
                "blockedReason": stringify(attr(event, "blocked_reason")),
            }
        )

    try:
        browser = await uc.start(config=uc.Config(host=CDP_HOST, port=CDP_PORT))
        summary["chromeVersion"] = dict(browser.info) if browser.info else None

        # This browser profile is dedicated to the test account. Clear Duolingo
        # authentication state so the user can produce a clean manual login trace.
        tab = await browser.get("https://www.duolingo.com/", new_tab=True)
        await tab.sleep(2)
        await tab.send(uc.cdp.network.clear_browser_cookies())
        await tab.send(uc.cdp.storage.clear_data_for_origin("https://www.duolingo.com", "all"))

        tab = await browser.get("https://www.duolingo.com/log-in", new_tab=True)
        await tab.sleep(3)

        tab.add_handler(uc.cdp.network.RequestWillBeSent, on_request)
        tab.add_handler(uc.cdp.network.ResponseReceived, on_response)
        tab.add_handler(uc.cdp.network.LoadingFailed, on_failed)
        await install_input_trace(tab)

        await tab.save_screenshot(filename=str(OUTPUT_DIR / "00-ready-for-manual-login.png"))
        print(
            "Manual gold trace ready. Automation will not type or submit. "
            f"Complete the login manually within {TIMEOUT_SECONDS} seconds."
        )

        start = time.monotonic()
        final_state = None
        while time.monotonic() - start < TIMEOUT_SECONDS:
            try:
                events = await read_input_trace(tab)
                if len(events) > seen_input_events:
                    input_events.extend(events[seen_input_events:])
                    seen_input_events = len(events)
            except Exception:
                # Navigation can briefly destroy the old page context.
                pass

            try:
                state = await page_state(tab)
                final_state = state
                href = state.get("href") or ""
                logged_in = not state.get("loginFormPresent") and "/log-in" not in href
                if logged_in:
                    summary["manualLoginSucceeded"] = True
                    summary["finalUrl"] = sanitize_url(href)
                    summary["finalState"] = state
                    print(f"Manual login succeeded at {sanitize_url(href)}")
                    break
            except Exception:
                pass

            await asyncio.sleep(0.1)
        else:
            summary["manualLoginSucceeded"] = False
            summary["finalState"] = final_state
            raise RuntimeError("Manual login trace timed out before an authenticated state")

        await asyncio.sleep(2)
        try:
            await tab.save_screenshot(filename=str(OUTPUT_DIR / "01-after-manual-login.png"))
        except Exception:
            pass

    except Exception as error:
        summary["error"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        # Network metadata only: no bodies, headers, cookies, or query strings.
        (OUTPUT_DIR / "network-trace.json").write_text(
            json.dumps(network_events, indent=2), encoding="utf-8"
        )
        (OUTPUT_DIR / "input-trace.json").write_text(
            json.dumps(input_events, indent=2), encoding="utf-8"
        )
        summary["networkEventCount"] = len(network_events)
        summary["inputEventCount"] = len(input_events)
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
