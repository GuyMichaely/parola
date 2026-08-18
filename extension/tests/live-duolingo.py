import base64
import gzip
import json
import os
import re
import socket
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import nodriver as uc

EXTENSION_ROOT = Path.cwd().resolve()
OUTPUT_DIR = Path(os.environ.get("DUOLINGO_CAPTURE_DIR", "live-capture")).resolve()
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
CHROME_PATH = os.environ.get("CHROME_PATH", "/usr/bin/google-chrome")
SESSION_PATH = Path(
    os.environ.get(
        "DUOLINGO_SESSION_STATE_FILE",
        "tests/fixtures/duolingo-session-state.b64",
    )
)
ORIGIN = "https://www.duolingo.com"
SMOKE_WORD = "parolatest"


def target_json(target):
    try:
        return target.target.to_json()
    except Exception:
        return {"repr": repr(target)}


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
            raise RuntimeError(
                f"Chrome exited before its CDP endpoint became available (exit {process.returncode})"
            )
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                return json.loads(response.read())
        except Exception as error:
            last_error = error
            time.sleep(0.25)
    raise RuntimeError(f"Chrome CDP endpoint did not become available: {last_error}")


def launch_chrome():
    port = free_port()
    profile_dir = Path(tempfile.mkdtemp(prefix="parola-live-profile-"))
    stdout_path = OUTPUT_DIR / "chrome-stdout.log"
    stderr_path = OUTPUT_DIR / "chrome-stderr.log"
    stdout_file = stdout_path.open("wb")
    stderr_file = stderr_path.open("wb")

    args = [
        CHROME_PATH,
        f"--user-data-dir={profile_dir}",
        f"--remote-debugging-port={port}",
        "--remote-debugging-address=127.0.0.1",
        "--remote-allow-origins=*",
        "--no-first-run",
        "--no-default-browser-check",
        "--password-store=basic",
        "--disable-infobars",
        "--disable-breakpad",
        "--disable-dev-shm-usage",
        "--disable-session-crashed-bubble",
        "--disable-search-engine-choice-screen",
        "--no-sandbox",
        "--disable-features=IsolateOrigins,site-per-process,DisableLoadExtensionCommandLineSwitch",
        "--enable-unsafe-extension-debugging",
        f"--disable-extensions-except={EXTENSION_ROOT}",
        f"--load-extension={EXTENSION_ROOT}",
        "about:blank",
    ]

    process = subprocess.Popen(args, stdout=stdout_file, stderr=stderr_file)
    try:
        version = wait_for_debug_endpoint(port, process)
    except Exception:
        stdout_file.close()
        stderr_file.close()
        raise

    return process, stdout_file, stderr_file, profile_dir, port, version


def decode_session():
    if not SESSION_PATH.exists():
        raise RuntimeError(f"Missing committed Duolingo session state: {SESSION_PATH}")
    encoded = SESSION_PATH.read_text(encoding="ascii").strip()
    payload = json.loads(gzip.decompress(base64.b64decode(encoded)))
    if payload.get("version") != 1 or payload.get("origin") != ORIGIN:
        raise RuntimeError("Unsupported Duolingo session-state payload")
    return payload


async def evaluate_json(tab, expression):
    encoded = await tab.evaluate(f"JSON.stringify(({expression}))", return_by_value=True)
    if not isinstance(encoded, str):
        encoded = getattr(encoded, "value", encoded)
    return json.loads(encoded) if encoded is not None else None


async def restore_session(browser, payload):
    seed = await browser.get(f"{ORIGIN}/", new_tab=True)
    await seed.sleep(1)
    await seed.send(uc.cdp.network.clear_browser_cookies())
    await seed.send(uc.cdp.storage.clear_data_for_origin(ORIGIN, "all"))

    params = [uc.cdp.network.CookieParam.from_json(cookie) for cookie in payload.get("cookies") or []]
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
          bodyStart: document.body ? document.body.innerText.toLowerCase().slice(0, 500) : ''
        }))()""",
    )
    authenticated = (
        not state["hasLoginForm"]
        and "/log-in" not in state["href"]
        and "log in" not in state["bodyStart"]
    )
    if not authenticated:
        raise RuntimeError("Committed Duolingo session is no longer authenticated")
    return seed, state


async def find_parola_extension(browser, timeout_seconds=15):
    candidate_ids = []
    for _ in range(timeout_seconds * 2):
        await browser.update_targets()
        candidate_ids = []
        for target in browser.targets:
            data = target_json(target)
            url = str(data.get("url", ""))
            match = re.fullmatch(r"chrome-extension://([a-p]{32})/background\.js", url)
            if match and match.group(1) not in candidate_ids:
                candidate_ids.append(match.group(1))
        if candidate_ids:
            break
        await browser.sleep(0.5)

    for extension_id in candidate_ids:
        review = await browser.get(
            f"chrome-extension://{extension_id}/review.html", new_tab=True
        )
        await review.sleep(0.75)
        html = await review.get_content()
        if "Parola for Duolingo" in html:
            return extension_id, review
        try:
            await review.close()
        except Exception:
            pass

    return None, None


async def capture(tab, name):
    html = await tab.get_content()
    url = str(getattr(tab.target, "url", ""))
    await tab.save_screenshot(filename=str(OUTPUT_DIR / f"{name}.png"))
    (OUTPUT_DIR / f"{name}.html").write_text(html, encoding="utf-8")
    return url


async def inject_smoke_exercise(tab):
    return await tab.evaluate(
        """(() => {
          document.getElementById('parola-live-smoke')?.remove();
          const section = document.createElement('section');
          section.id = 'parola-live-smoke';
          Object.assign(section.style, {
            position: 'fixed', left: '20px', top: '20px', zIndex: '2147483646',
            background: 'white', color: 'rgb(50,50,50)', padding: '24px', width: '420px'
          });
          section.innerHTML = `
            <div style="color:rgb(206,130,255);font-weight:700">NEW WORD</div>
            <h2>Parola live detector smoke exercise</h2>
            <p>Write this in English</p>
            <div>la parola <span style="color:rgb(206,130,255);font-weight:700">parolatest</span></div>`;
          document.body.appendChild(section);
          return true;
        })()""",
        return_by_value=True,
    )


async def wait_for_staged_word(browser, extension_id, timeout_seconds=10):
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        review = await browser.get(
            f"chrome-extension://{extension_id}/review.html", new_tab=True
        )
        await review.sleep(0.5)
        value = await review.evaluate(
            "document.querySelector('input[data-field=\"word\"]')?.value || ''",
            return_by_value=True,
        )
        if value == SMOKE_WORD:
            return review
        try:
            await review.close()
        except Exception:
            pass
        await browser.sleep(0.4)
    raise RuntimeError("Parola content script did not stage the live-origin smoke word")


async def inject_completion(tab):
    await tab.evaluate(
        """(() => {
          const section = document.getElementById('parola-live-smoke');
          if (!section) return false;
          const heading = document.createElement('h2');
          heading.id = 'parola-live-smoke-complete';
          heading.textContent = 'Lesson complete!';
          section.appendChild(heading);
          return true;
        })()""",
        return_by_value=True,
    )


async def wait_for_completion_review(browser, extension_id, timeout_seconds=10):
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        await browser.update_targets()
        for target in browser.targets:
            data = target_json(target)
            url = str(data.get("url", ""))
            if url.startswith(f"chrome-extension://{extension_id}/review.html?lesson="):
                return url
        await browser.sleep(0.4)
    raise RuntimeError("Lesson completion did not open a lesson-scoped Parola review")


async def main():
    chrome_process = None
    stdout_file = None
    stderr_file = None
    browser = None
    summary = {
        "test": "live-duolingo-extension-smoke",
        "automation": "nodriver",
        "nodriverVersion": uc.__version__,
        "chromePath": CHROME_PATH,
        "sessionSource": str(SESSION_PATH),
    }

    try:
        payload = decode_session()
        summary.update({
            "cookieCount": len(payload.get("cookies") or []),
            "localStorageKeyCount": len(payload.get("localStorage") or {}),
            "sessionStorageKeyCount": len(payload.get("sessionStorage") or {}),
        })

        (
            chrome_process,
            stdout_file,
            stderr_file,
            profile_dir,
            port,
            chrome_version,
        ) = launch_chrome()
        summary.update({
            "chromeDebugPort": port,
            "chromeProfileDir": str(profile_dir),
            "chromeVersion": chrome_version,
        })

        browser = await uc.start(config=uc.Config(host="127.0.0.1", port=port))
        extension_id, review = await find_parola_extension(browser)
        if not extension_id or review is None:
            raise RuntimeError("Parola extension did not load in Chrome")
        summary["extensionId"] = extension_id

        learn, auth_state = await restore_session(browser, payload)
        summary["authenticated"] = True
        summary["duolingoUrl"] = auth_state["href"]
        await capture(learn, "00-authenticated-learn")

        await inject_smoke_exercise(learn)
        staged_review = await wait_for_staged_word(browser, extension_id)
        summary["liveOriginDetection"] = True
        await capture(staged_review, "01-staged-live-origin-word")

        await inject_completion(learn)
        completion_review_url = await wait_for_completion_review(browser, extension_id)
        summary["completionReviewOpened"] = True
        summary["completionReviewUrlShape"] = "lesson-scoped" if "?lesson=" in completion_review_url else "unscoped"

        print(
            "Authenticated Duolingo session restored; extension staged a synthetic NEW WORD "
            "inside the live Duolingo origin and opened lesson-scoped review on completion."
        )
    except Exception as error:
        summary["error"] = f"{type(error).__name__}: {error}"
        raise
    finally:
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

        if chrome_process is not None and chrome_process.poll() is None:
            chrome_process.terminate()
            try:
                chrome_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                chrome_process.kill()
                chrome_process.wait(timeout=5)

        if stdout_file is not None:
            stdout_file.close()
        if stderr_file is not None:
            stderr_file.close()


if __name__ == "__main__":
    uc.loop().run_until_complete(main())
