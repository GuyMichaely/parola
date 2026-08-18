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
  for (const key of allowed) {
    if (cookie[key] !== undefined && cookie[key] !== null) result[key] = cookie[key];
  }
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
  }, {
    localStorageValues: payload.localStorage || {},
    sessionStorageValues: payload.sessionStorage || {},
  });
  await page.goto(`${origin}/learn`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await new Promise((resolve) => setTimeout(resolve, 5000));
  assert.ok(new URL(page.url()).pathname.startsWith("/learn"), `Expected authenticated /learn, got ${page.url()}`);
}

async function visibleTextSnapshot(page) {
  return page.evaluate(() => ({
    href: location.href,
    title: document.title,
    bodyText: (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n").slice(0, 30000),
    newWordMarkers: [...document.querySelectorAll("body *")]
      .filter((element) => {
        const text = (element.textContent || "").trim();
        if (text !== "NEW WORD") return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      })
      .map((element) => ({
        tag: element.tagName,
        text: (element.textContent || "").trim(),
        className: typeof element.className === "string" ? element.className : "",
        parentText: (element.parentElement?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 500),
      })),
    interactives: [...document.querySelectorAll("button,a,[role='button'],input,textarea")]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      })
      .slice(0, 200)
      .map((element) => ({
        tag: element.tagName,
        text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 300),
        ariaLabel: element.getAttribute("aria-label"),
        dataTest: element.getAttribute("data-test"),
        role: element.getAttribute("role"),
        type: element.getAttribute("type"),
      })),
  }));
}

async function clickVisibleExactText(page, expected) {
  const clicked = await page.evaluate((label) => {
    function visible(element) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    }
    const candidates = [...document.querySelectorAll("button,[role='button'],a,div,span")];
    const element = candidates.find((candidate) => visible(candidate) && (candidate.textContent || "").trim() === label);
    if (!element) return false;
    element.click();
    return true;
  }, expected);
  if (!clicked) throw new Error(`Could not find visible control with exact text ${expected}`);
}

async function extensionState(browser, extensionId) {
  const page = await browser.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "domcontentloaded" });
    return await page.evaluate(() => chrome.runtime.sendMessage({ type: "get-state" }));
  } finally {
    await page.close();
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
  let browser;
  try {
    const payload = decodeSession(await readFile(sessionPath, "ascii"));
    summary.payloadVersion = payload.version;
    summary.cookieNames = (payload.cookies || []).map((cookie) => cookie.name).sort();

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
    await restoreSession(page, payload);
    summary.authenticated = true;
    await page.screenshot({ path: path.join(outputDir, "00-learn.png"), fullPage: false });

    await page.waitForSelector('button[aria-label^="Lesson "]', { timeout: 10000 });
    const lessonLabel = await page.$eval('button[aria-label^="Lesson "]', (button) => button.getAttribute("aria-label"));
    summary.lessonControl = lessonLabel;
    await page.click('button[aria-label^="Lesson "]');
    await new Promise((resolve) => setTimeout(resolve, 800));
    await page.screenshot({ path: path.join(outputDir, "01-lesson-popup.png"), fullPage: false });

    await clickVisibleExactText(page, "START");
    await page.waitForFunction(() => !location.pathname.startsWith("/learn"), { timeout: 20000 });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    summary.lessonEntered = true;
    summary.lessonUrl = page.url();

    const firstExercise = await visibleTextSnapshot(page);
    await writeFile(path.join(outputDir, "02-first-exercise.json"), JSON.stringify(firstExercise, null, 2));
    await page.screenshot({ path: path.join(outputDir, "02-first-exercise.png"), fullPage: false });

    if (!firstExercise.newWordMarkers.length) {
      try {
        await page.waitForFunction(() => [...document.querySelectorAll("body *")].some((element) => {
          const text = (element.textContent || "").trim();
          if (text !== "NEW WORD") return false;
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        }), { timeout: 12000 });
      } catch {
        // The first exercise need not introduce a new word; this probe records that fact rather than failing.
      }
    }

    const afterWait = await visibleTextSnapshot(page);
    summary.organicNewWordVisible = afterWait.newWordMarkers.length > 0;
    summary.newWordMarkers = afterWait.newWordMarkers;
    await writeFile(path.join(outputDir, "03-after-new-word-wait.json"), JSON.stringify(afterWait, null, 2));

    await new Promise((resolve) => setTimeout(resolve, 1200));
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

    console.log(JSON.stringify(summary));
  } catch (error) {
    summary.error = `${error?.name || "Error"}: ${error?.message || String(error)}`;
    throw error;
  } finally {
    await writeFile(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));
    if (browser) await browser.close();
  }
}

await main();
