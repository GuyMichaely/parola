import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import puppeteer from "puppeteer";

const extensionRoot = path.resolve(process.cwd());
const outputDir = path.resolve(process.env.DUOLINGO_CAPTURE_DIR || "live-extension-capture");
const sessionPath = path.resolve(process.env.DUOLINGO_SESSION_STATE_FILE || "tests/fixtures/duolingo-session-state.b64");
const origin = "https://www.duolingo.com";
const smokeWord = "parolatest";

await mkdir(outputDir, { recursive: true });

function decodeSession(encoded) {
  const payload = JSON.parse(gunzipSync(Buffer.from(encoded.trim(), "base64")).toString("utf8"));
  if (payload?.version !== 1 || payload?.origin !== origin) throw new Error("Unsupported Duolingo session-state payload");
  return payload;
}

function cookieParam(cookie) {
  const allowed = [
    "name", "value", "url", "domain", "path", "secure", "httpOnly", "sameSite",
    "expires", "priority", "sameParty", "sourceScheme", "sourcePort", "partitionKey",
  ];
  const result = {};
  for (const key of allowed) {
    if (cookie[key] !== undefined && cookie[key] !== null) result[key] = cookie[key];
  }
  if (cookie.session || !Number.isFinite(cookie.expires) || cookie.expires < 0) delete result.expires;
  return result;
}

async function restoreSession(page, payload) {
  const client = await page.createCDPSession();
  await client.send("Network.enable");
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await client.send("Network.clearBrowserCookies");
  await client.send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
  await client.send("Network.setCookies", { cookies: (payload.cookies || []).map(cookieParam) });
  await page.evaluate(({ localStorageValues, sessionStorageValues }) => {
    localStorage.clear();
    sessionStorage.clear();
    for (const [key, value] of Object.entries(localStorageValues || {})) localStorage.setItem(key, String(value));
    for (const [key, value] of Object.entries(sessionStorageValues || {})) sessionStorage.setItem(key, String(value));
  }, {
    localStorageValues: payload.localStorage || {},
    sessionStorageValues: payload.sessionStorage || {},
  });

  await page.goto(`${origin}/learn`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const state = await page.evaluate(() => ({
    href: location.href,
    hasLoginForm: Boolean(document.querySelector('input[data-test="password-input"]')),
    bodyStart: (document.body?.innerText || "").toLocaleLowerCase().slice(0, 500),
  }));
  const authenticated = !state.hasLoginForm && !state.href.includes("/log-in") && !state.bodyStart.includes("log in");
  assert.equal(authenticated, true, "committed Duolingo session should restore an authenticated /learn page");
  return state;
}

async function injectSmokeExercise(page) {
  await page.evaluate((word) => {
    document.getElementById("parola-live-smoke")?.remove();
    const section = document.createElement("section");
    section.id = "parola-live-smoke";
    Object.assign(section.style, {
      position: "fixed",
      left: "20px",
      top: "20px",
      zIndex: "2147483646",
      background: "white",
      color: "rgb(50, 50, 50)",
      padding: "24px",
      width: "420px",
    });
    section.innerHTML = `
      <div style="color:rgb(206,130,255);font-weight:700">NEW WORD</div>
      <h2>Parola live detector smoke exercise</h2>
      <p>Write this in English</p>
      <div>la parola <span id="parola-live-smoke-word" style="color:rgb(206,130,255);font-weight:700"></span></div>`;
    section.querySelector("#parola-live-smoke-word").textContent = word;
    document.body.appendChild(section);
  }, smokeWord);
}

async function injectCompletion(page) {
  await page.evaluate(() => {
    const section = document.getElementById("parola-live-smoke");
    if (!section) throw new Error("Smoke exercise disappeared before completion test");
    const heading = document.createElement("h2");
    heading.textContent = "Lesson complete!";
    section.appendChild(heading);
  });
}

async function main() {
  const summary = {
    test: "live-duolingo-extension-smoke",
    sessionSource: sessionPath,
    liveOriginDetection: false,
    completionReviewOpened: false,
  };
  let browser = null;
  try {
    const payload = decodeSession(await readFile(sessionPath, "ascii"));
    summary.cookieCount = payload.cookies?.length || 0;
    summary.localStorageKeyCount = Object.keys(payload.localStorage || {}).length;
    summary.sessionStorageKeyCount = Object.keys(payload.sessionStorage || {}).length;

    browser = await puppeteer.launch({
      headless: false,
      pipe: true,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        `--disable-extensions-except=${extensionRoot}`,
        `--load-extension=${extensionRoot}`,
      ],
    });

    const extensionTarget = await browser.waitForTarget(
      (target) => target.type() === "service_worker" && target.url().startsWith("chrome-extension://"),
      { timeout: 10000 },
    );
    const extensionId = new URL(extensionTarget.url()).host;
    summary.extensionId = extensionId;

    const page = await browser.newPage();
    const authState = await restoreSession(page, payload);
    summary.authenticated = true;
    summary.duolingoUrl = authState.href;
    await page.screenshot({ path: path.join(outputDir, "00-authenticated-learn.png"), fullPage: false });

    await injectSmokeExercise(page);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const review = await browser.newPage();
    await review.goto(`chrome-extension://${extensionId}/review.html`, { waitUntil: "domcontentloaded" });
    await review.waitForFunction((word) => {
      return [...document.querySelectorAll('input[data-field="word"]')].some((input) => input.value === word);
    }, { timeout: 10000 }, smokeWord);
    summary.liveOriginDetection = true;
    await review.screenshot({ path: path.join(outputDir, "01-staged-live-origin-word.png"), fullPage: true });

    const completionTargetPromise = browser.waitForTarget(
      (target) => target.url().startsWith(`chrome-extension://${extensionId}/review.html?lesson=`),
      { timeout: 10000 },
    );
    await injectCompletion(page);
    const completionTarget = await completionTargetPromise;
    summary.completionReviewOpened = true;
    summary.completionReviewUrlShape = completionTarget.url().includes("?lesson=") ? "lesson-scoped" : "unscoped";

    console.log(`Extension ${extensionId} restored Duolingo auth, staged ${smokeWord} on the live origin, and opened lesson-scoped review at completion.`);
  } catch (error) {
    summary.error = `${error?.name || "Error"}: ${error?.message || String(error)}`;
    throw error;
  } finally {
    await writeFile(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));
    if (browser) await browser.close();
  }
}

await main();
