import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import puppeteer from "puppeteer";

const extensionRoot = path.resolve(process.cwd());
const outputDir = path.resolve(process.env.DUOLINGO_CAPTURE_DIR || "organic-duolingo-capture");
const sessionPath = path.resolve(process.env.DUOLINGO_SESSION_STATE_FILE || "tests/fixtures/duolingo-session-state.b64");
const origin = "https://www.duolingo.com";

await mkdir(outputDir, { recursive: true });

function decodeSession(encoded) {
  const payload = JSON.parse(gunzipSync(Buffer.from(encoded.trim(), "base64")).toString("utf8"));
  if (![1, 2].includes(payload?.version) || payload?.origin !== origin) throw new Error("Unsupported Duolingo session-state payload");
  return payload;
}

function cookieParam(cookie) {
  const allowed = [
    "name", "value", "url", "domain", "path", "secure", "httpOnly", "sameSite",
    "expires", "priority", "sameParty", "sourceScheme", "sourcePort", "partitionKey",
  ];
  const result = {};
  for (const key of allowed) if (cookie[key] !== undefined && cookie[key] !== null) result[key] = cookie[key];
  if (cookie.session || !Number.isFinite(cookie.expires) || cookie.expires < 0) delete result.expires;
  return result;
}

async function restoreSession(page, payload) {
  const client = await page.createCDPSession();
  await client.send("Network.enable");
  await page.goto(`${origin}/robots.txt`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await client.send("Network.clearBrowserCookies");
  await client.send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
  await client.send("Network.setCookies", { cookies: (payload.cookies || []).map(cookieParam) });
  await page.evaluate(({ localStorageValues, sessionStorageValues }) => {
    localStorage.clear();
    sessionStorage.clear();
    for (const [key, value] of Object.entries(localStorageValues || {})) localStorage.setItem(key, String(value));
    for (const [key, value] of Object.entries(sessionStorageValues || {})) sessionStorage.setItem(key, String(value));
  }, { localStorageValues: payload.localStorage || {}, sessionStorageValues: payload.sessionStorage || {} });
  await page.goto(`${origin}/learn`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await new Promise((resolve) => setTimeout(resolve, 5000));
  assert.ok(new URL(page.url()).pathname.startsWith("/learn"), `Expected authenticated /learn, got ${page.url()}`);
}

function visible(element) {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0 && rect.width > 0 && rect.height > 0;
}

async function snapshot(page) {
  return page.evaluate(() => {
    function isVisible(element) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0 && rect.width > 0 && rect.height > 0;
    }
    return {
      href: location.href,
      title: document.title,
      bodyText: (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n").slice(0, 30000),
      newWordMarkers: [...document.querySelectorAll("body *")]
        .filter((element) => isVisible(element) && (element.textContent || "").trim() === "NEW WORD")
        .map((element) => ({
          tag: element.tagName,
          className: typeof element.className === "string" ? element.className : "",
          parentText: (element.parentElement?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 600),
        })),
      interactives: [...document.querySelectorAll("button,a,[role='button'],input,textarea")]
        .filter(isVisible)
        .slice(0, 250)
        .map((element) => ({
          tag: element.tagName,
          text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 400),
          ariaLabel: element.getAttribute("aria-label"),
          dataTest: element.getAttribute("data-test"),
          role: element.getAttribute("role"),
          type: element.getAttribute("type"),
          disabled: element.matches(":disabled") || element.getAttribute("aria-disabled") === "true",
        })),
    };
  });
}

async function clickTextPrefix(page, prefix) {
  const clicked = await page.evaluate((wanted) => {
    function isVisible(element) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    }
    const candidates = [...document.querySelectorAll("button,[role='button'],a")];
    const element = candidates.find((candidate) => isVisible(candidate) && (candidate.textContent || "").trim().toUpperCase().startsWith(wanted));
    if (!element) return false;
    element.click();
    return true;
  }, prefix.toUpperCase());
  if (!clicked) throw new Error(`Could not find visible control beginning with ${prefix}`);
}

async function extensionState(browser, extensionId) {
  const popup = await browser.newPage();
  try {
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "domcontentloaded" });
    return await popup.evaluate(() => chrome.runtime.sendMessage({ type: "get-state" }));
  } finally {
    await popup.close();
  }
}

async function main() {
  const summary = {
    test: "organic-duolingo-lesson-probe",
    authenticated: false,
    lessonEntered: false,
    organicNewWordVisible: false,
    parolaStagedOrganicWord: false,
  };
  const networkJson = [];
  let browser;
  try {
    const payload = decodeSession(await readFile(sessionPath, "ascii"));
    summary.payloadVersion = payload.version;
    summary.cookieNames = (payload.cookies || []).map((cookie) => cookie.name).sort();

    browser = await puppeteer.launch({
      headless: false,
      pipe: true,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: ["--no-sandbox", "--disable-dev-shm-usage", `--disable-extensions-except=${extensionRoot}`, `--load-extension=${extensionRoot}`],
    });
    const extensionTarget = await browser.waitForTarget(
      (target) => target.type() === "service_worker" && target.url().startsWith("chrome-extension://"),
      { timeout: 10000 },
    );
    const extensionId = new URL(extensionTarget.url()).host;
    summary.extensionId = extensionId;

    const page = await browser.newPage();
    page.on("response", async (response) => {
      try {
        const url = response.url();
        const type = response.headers()["content-type"] || "";
        if (!/json/i.test(type) || !/(session|challenge|lesson|practice)/i.test(url)) return;
        const data = await response.json();
        networkJson.push({ url, status: response.status(), data });
      } catch {
        // Some responses are already consumed or not valid JSON; they are irrelevant to this probe.
      }
    });

    await restoreSession(page, payload);
    summary.authenticated = true;
    await page.screenshot({ path: path.join(outputDir, "00-learn.png"), fullPage: false });

    await page.waitForSelector('button[aria-label^="Lesson "]', { timeout: 10000 });
    summary.lessonControl = await page.$eval('button[aria-label^="Lesson "]', (button) => button.getAttribute("aria-label"));
    await page.click('button[aria-label^="Lesson "]');
    await new Promise((resolve) => setTimeout(resolve, 800));
    await page.screenshot({ path: path.join(outputDir, "01-lesson-popup.png"), fullPage: false });
    await clickTextPrefix(page, "START");

    await page.waitForFunction(() => !location.pathname.startsWith("/learn"), { timeout: 20000 });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    summary.lessonEntered = true;
    summary.lessonUrl = page.url();

    const exercise = await snapshot(page);
    await writeFile(path.join(outputDir, "02-first-exercise.json"), JSON.stringify(exercise, null, 2));
    await page.screenshot({ path: path.join(outputDir, "02-first-exercise.png"), fullPage: false });
    summary.organicNewWordVisible = exercise.newWordMarkers.length > 0;
    summary.newWordMarkers = exercise.newWordMarkers;

    await new Promise((resolve) => setTimeout(resolve, 1500));
    const state = await extensionState(browser, extensionId);
    summary.stagedCount = state.staged?.length || 0;
    summary.staged = (state.staged || []).map((item) => ({
      word: item.word,
      context: item.context,
      lessonId: item.lessonId,
      status: item.status,
      detectionCount: item.detectionCount,
    }));
    summary.parolaStagedOrganicWord = summary.organicNewWordVisible && summary.stagedCount > 0;

    await new Promise((resolve) => setTimeout(resolve, 1500));
    await writeFile(path.join(outputDir, "03-network-json.json"), JSON.stringify(networkJson, null, 2));
    summary.networkJsonCount = networkJson.length;
    summary.networkUrls = [...new Set(networkJson.map((entry) => entry.url))];
    console.log(JSON.stringify(summary));
  } catch (error) {
    summary.error = `${error?.name || "Error"}: ${error?.message || String(error)}`;
    throw error;
  } finally {
    await writeFile(path.join(outputDir, "03-network-json.json"), JSON.stringify(networkJson, null, 2));
    await writeFile(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));
    if (browser) await browser.close();
  }
}

await main();
