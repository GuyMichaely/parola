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
STATE_FILE = Path(
    os.environ.get(
        "DUOLINGO_SESSION_STATE_FILE",
        "tests/fixtures/duolingo-session-state.b64",
    )
)
OUTPUT_DIR = Path(os.environ.get("DUOLINGO_CAPTURE_DIR", "session-restore-capture")).resolve()
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
ORIGIN = "https://www.duolingo.com"


async def evaluate_json(tab, expression):
    encoded = await tab.evaluate(f"JSON.stringify(({expression}))", return_by_value=True)
    if not isinstance(encoded, str):
        encoded = getattr(encoded, "value", encoded)
    return json.loads(encoded) if encoded is not None else None


def load_state_value():
    if STATE_B64.strip():
        return STATE_B64.strip()
    if STATE_FILE.exists():
        return STATE_FILE.read_text(encoding="ascii").strip()
    raise RuntimeError(
        f"No Duolingo session state supplied; missing {STATE_FILE} and DUOLINGO_SESSION_STATE_B64"
    )


def decode_state(value):
    raw = gzip.decompress(base64.b64decode(value))
    payload = json.loads(raw)
    if payload.get("version") not in (1, 2) or payload.get("origin") != ORIGIN:
        raise RuntimeError("Unsupported Duolingo session-state payload")
    return payload


async def restore_indexeddb(tab, databases):
    if not databases:
        return
    script = f"""
    (async () => {{
      const databases = {json.dumps(databases)};

      function transactionDone(transaction) {{
        return new Promise((resolve, reject) => {{
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
          transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
        }});
      }}

      function deleteDatabase(name) {{
        return new Promise((resolve, reject) => {{
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = resolve;
          request.onerror = () => reject(request.error || new Error(`Could not delete IndexedDB database ${{name}}`));
          request.onblocked = resolve;
        }});
      }}

      function openDatabase(databaseState) {{
        return new Promise((resolve, reject) => {{
          const request = indexedDB.open(databaseState.name, databaseState.version || 1);
          request.onupgradeneeded = () => {{
            const database = request.result;
            for (const storeState of databaseState.stores || []) {{
              if (!storeState.captured || database.objectStoreNames.contains(storeState.name)) continue;
              const options = {{ autoIncrement: Boolean(storeState.autoIncrement) }};
              if (storeState.keyPath !== null && storeState.keyPath !== undefined) options.keyPath = storeState.keyPath;
              const store = database.createObjectStore(storeState.name, options);
              for (const indexState of storeState.indexes || []) {{
                store.createIndex(indexState.name, indexState.keyPath, {{
                  multiEntry: Boolean(indexState.multiEntry),
                  unique: Boolean(indexState.unique),
                }});
              }}
            }}
          }};
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error || new Error(`Could not open IndexedDB database ${{databaseState.name}}`));
        }});
      }}

      for (const databaseState of databases) {{
        const capturedStores = (databaseState.stores || []).filter((store) => store.captured);
        if (!capturedStores.length) continue;
        await deleteDatabase(databaseState.name);
        const database = await openDatabase({{ ...databaseState, stores: capturedStores }});
        try {{
          for (const storeState of capturedStores) {{
            if (!database.objectStoreNames.contains(storeState.name)) continue;
            const transaction = database.transaction(storeState.name, 'readwrite');
            const store = transaction.objectStore(storeState.name);
            const records = storeState.records || [];
            const keys = storeState.keys || [];
            for (let index = 0; index < records.length; index += 1) {{
              if (store.keyPath === null && keys[index] !== undefined) store.put(records[index], keys[index]);
              else store.put(records[index]);
            }}
            await transactionDone(transaction);
          }}
        }} finally {{
          database.close();
        }}
      }}
      return true;
    }})()
    """
    await tab.evaluate(script, return_by_value=True)


async def main():
    browser = None
    summary = {
        "test": "github-hosted-session-restore",
        "stateSource": "file" if not STATE_B64.strip() else "environment",
    }
    try:
        payload = decode_state(load_state_value())
        indexeddb = payload.get("indexedDB") or []
        local_storage = payload.get("localStorage") or {}
        session_storage = payload.get("sessionStorage") or {}
        source_duo_state = local_storage.get("duo.state") or ""
        summary["payloadVersion"] = payload.get("version")
        summary["cookieCount"] = len(payload.get("cookies") or [])
        summary["cookieNames"] = sorted(
            {str(cookie.get("name") or "") for cookie in payload.get("cookies") or []}
        )
        summary["partitionedCookieCount"] = len(
            [cookie for cookie in payload.get("cookies") or [] if cookie.get("partitionKey")]
        )
        summary["localStorageKeyCount"] = len(local_storage)
        summary["sessionStorageKeyCount"] = len(session_storage)
        summary["duoStateSourceLength"] = len(source_duo_state)
        summary["indexedDBDatabaseCount"] = len(indexeddb)
        summary["indexedDBCapturedStoreCount"] = sum(
            1
            for database in indexeddb
            for store in database.get("stores") or []
            if store.get("captured")
        )

        browser = await uc.start(config=uc.Config(host=CDP_HOST, port=CDP_PORT))
        seed = await browser.get(f"{ORIGIN}/robots.txt", new_tab=True)
        await seed.sleep(1)
        await seed.send(uc.cdp.network.clear_browser_cookies())
        await seed.send(uc.cdp.storage.clear_data_for_origin(ORIGIN, "all"))

        params = [uc.cdp.network.CookieParam.from_json(cookie) for cookie in payload.get("cookies") or []]
        await browser.cookies.set_all(params)

        if local_storage:
            await seed.evaluate("Object.assign(localStorage," + json.dumps(local_storage) + ")")
        if session_storage:
            await seed.evaluate("Object.assign(sessionStorage," + json.dumps(session_storage) + ")")
        await restore_indexeddb(seed, indexeddb)

        pre_navigation = await evaluate_json(
            seed,
            """(() => ({
              localStorageKeyCount: localStorage.length,
              sessionStorageKeyCount: sessionStorage.length,
              duoStateLength: (localStorage.getItem('duo.state') || '').length,
              lastLoginPresent: Boolean(localStorage.getItem('duo.lastLogin'))
            }))()""",
        )
        summary["preNavigationLocalStorageKeyCount"] = pre_navigation["localStorageKeyCount"]
        summary["preNavigationSessionStorageKeyCount"] = pre_navigation["sessionStorageKeyCount"]
        summary["preNavigationDuoStateLength"] = pre_navigation["duoStateLength"]
        summary["preNavigationLastLoginPresent"] = pre_navigation["lastLoginPresent"]

        restored_cookies = await browser.cookies.get_all()
        restored_duolingo_cookies = [
            cookie
            for cookie in restored_cookies
            if "duolingo.com" in str(getattr(cookie, "domain", ""))
        ]
        summary["restoredDuolingoCookieCount"] = len(restored_duolingo_cookies)
        summary["restoredDuolingoCookieNames"] = sorted(
            {str(getattr(cookie, "name", "")) for cookie in restored_duolingo_cookies}
        )

        await seed.get(f"{ORIGIN}/learn")
        await seed.sleep(5)
        state = await evaluate_json(
            seed,
            """(() => ({
              href: location.href,
              pathname: location.pathname,
              hasLoginForm: Boolean(document.querySelector('input[data-test="password-input"]')),
              hasGetStarted: [...document.querySelectorAll('a,button')].some((el) =>
                (el.textContent || '').trim().toUpperCase() === 'GET STARTED'
              ),
              localStorageKeyCount: localStorage.length,
              duoStateLength: (localStorage.getItem('duo.state') || '').length,
              lastLoginPresent: Boolean(localStorage.getItem('duo.lastLogin'))
            }))()""",
        )
        summary["finalUrl"] = state["href"]
        summary["loginFormPresent"] = state["hasLoginForm"]
        summary["getStartedPresent"] = state["hasGetStarted"]
        summary["finalLocalStorageKeyCount"] = state["localStorageKeyCount"]
        summary["finalDuoStateLength"] = state["duoStateLength"]
        summary["finalLastLoginPresent"] = state["lastLoginPresent"]
        summary["authenticated"] = (
            not state["hasLoginForm"]
            and not state["hasGetStarted"]
            and state["pathname"].startswith("/learn")
        )
        try:
            await seed.save_screenshot(filename=str(OUTPUT_DIR / "after-session-restore.png"))
        except Exception:
            pass
        if not summary["authenticated"]:
            raise RuntimeError(
                f"Imported Duolingo session is no longer authenticated; landed at {state['href']}"
            )
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
