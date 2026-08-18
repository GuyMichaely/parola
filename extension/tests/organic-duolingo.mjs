import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import puppeteer from "puppeteer";

const extensionRoot = path.resolve(process.cwd());
const outputDir = path.resolve(process.env.DUOLINGO_CAPTURE_DIR || "organic-duolingo-capture");
const sessionPath = path.resolve(process.env.DUOLINGO_SESSION_STATE_FILE || "tests/fixtures/duolingo-session-state.b64");
const origin = "https://www.duolingo.com";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await mkdir(outputDir, { recursive: true });

function decodeSession(encoded) {
  const payload = JSON.parse(gunzipSync(Buffer.from(encoded.trim(), "base64")).toString("utf8"));
  if (![1, 2].includes(payload?.version) || payload?.origin !== origin) throw new Error("Unsupported Duolingo session-state payload");
  return payload;
}

function cookieParam(cookie) {
  const allowed = ["name", "value", "url", "domain", "path", "secure", "httpOnly", "sameSite", "expires", "priority", "sameParty", "sourceScheme", "sourcePort", "partitionKey"];
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
  await sleep(5000);
  assert.ok(new URL(page.url()).pathname.startsWith("/learn"), `Expected authenticated /learn, got ${page.url()}`);
}

async function pageState(page) {
  return page.evaluate(() => {
    function visible(element) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0 && rect.width > 0 && rect.height > 0;
    }
    const bodyText = (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n");
    const newWordTextNodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = String(node.nodeValue || "").replace(/\s+/g, " ").trim();
      if (text.toUpperCase() !== "NEW WORD" || !node.parentElement) continue;
      const ancestors = [];
      let current = node.parentElement;
      for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
        const style = getComputedStyle(current);
        ancestors.push({
          tag: current.tagName,
          className: typeof current.className === "string" ? current.className : "",
          text: (current.innerText || current.textContent || "").replace(/\s+/g, " ").trim().slice(0, 1000),
          color: style.color,
          backgroundColor: style.backgroundColor,
          visible: visible(current),
          html: current.outerHTML.slice(0, 8000),
        });
      }
      newWordTextNodes.push({ text, ancestors });
    }
    return {
      href: location.href,
      bodyText: bodyText.slice(0, 30000),
      newWordTextNodes,
      controls: [...document.querySelectorAll("button,a,[role='button'],input,textarea")]
        .filter(visible)
        .slice(0, 250)
        .map((element) => ({
          text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 400),
          dataTest: element.getAttribute("data-test"),
          disabled: element.matches(":disabled") || element.getAttribute("aria-disabled") === "true",
        })),
    };
  });
}

async function clickText(page, wanted, { prefix = false } = {}) {
  const clicked = await page.evaluate(({ wanted, prefix }) => {
    const norm = (value) => String(value || "").replace(/\s+/g, " ").trim();
    function visible(element) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0 && rect.width > 0 && rect.height > 0;
    }
    const target = norm(wanted).toLocaleLowerCase();
    const matches = [...document.querySelectorAll("body *")].filter((element) => {
      if (!visible(element)) return false;
      const text = norm(element.innerText || element.textContent).toLocaleLowerCase();
      return prefix ? text.startsWith(target) : text === target;
    });
    matches.sort((a, b) => a.children.length - b.children.length);
    const leaf = matches[0];
    if (!leaf) return false;
    let current = leaf;
    for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
      if (current.matches?.("button,a,[role='button'],[tabindex]") || getComputedStyle(current).cursor === "pointer") {
        current.click();
        return true;
      }
    }
    leaf.click();
    return true;
  }, { wanted, prefix });
  if (!clicked) throw new Error(`Could not click visible text ${JSON.stringify(wanted)}`);
}

async function submitAndContinue(page) {
  const nextState = async () => page.evaluate(() => {
    const el = document.querySelector('[data-test="player-next"]');
    return el ? { text: (el.textContent || "").trim().toUpperCase(), disabled: el.matches(":disabled") || el.getAttribute("aria-disabled") === "true" } : null;
  });
  let state = await nextState();
  if (state && !state.disabled && state.text.startsWith("CHECK")) {
    await page.click('[data-test="player-next"]');
    await sleep(650);
  }
  state = await nextState();
  if (state && !state.disabled && (state.text.startsWith("CONTINUE") || state.text.startsWith("GOT IT"))) {
    await page.click('[data-test="player-next"]');
    await sleep(800);
  }
}

function choiceText(choice) {
  if (typeof choice === "string") return choice;
  return choice?.text ?? choice?.phrase ?? null;
}

async function solveChallenge(page, challenge, solverState) {
  const clickIndices = async (indices) => {
    for (const index of indices) {
      const value = choiceText(challenge.choices?.[index]);
      if (!value) throw new Error(`Missing choice ${index} for ${challenge.type}`);
      await clickText(page, value);
      await sleep(120);
    }
  };

  switch (challenge.type) {
    case "select":
    case "assist":
    case "dialogue":
    case "patternTapComplete":
      await clickIndices([challenge.correctIndex]);
      await submitAndContinue(page);
      return;
    case "translate":
    case "tapComplete":
    case "listenTap":
    case "listenSpeak":
      await clickIndices(challenge.correctIndices || []);
      await submitAndContinue(page);
      return;
    case "match":
    case "listenMatch":
      for (const pair of challenge.pairs || []) {
        const learning = pair.learningToken ?? pair.learningWord ?? pair.learningPhrase;
        const from = pair.fromToken ?? pair.fromWord ?? pair.fromPhrase;
        if (!learning || !from) continue;
        await clickText(page, learning);
        await sleep(90);
        await clickText(page, from);
        await sleep(180);
      }
      await submitAndContinue(page);
      return;
    case "speak": {
      if (solverState.speakingDisabled) return;
      const state = await pageState(page);
      const disable = state.controls.find((item) => item.text.toUpperCase().includes("CAN'T SPEAK"));
      if (disable) {
        await clickText(page, disable.text);
        await sleep(450);
        const confirm = (await pageState(page)).controls.find((item) => /TURN OFF|DISABLE|SKIP/.test(item.text.toUpperCase()));
        if (confirm) await clickText(page, confirm.text);
        solverState.speakingDisabled = true;
        await sleep(900);
        return;
      }
      const skip = state.controls.find((item) => item.text.toUpperCase() === "SKIP");
      if (!skip) throw new Error("Speaking challenge had no disable/skip control");
      await clickText(page, "SKIP");
      await submitAndContinue(page);
      return;
    }
    default: {
      const state = await pageState(page);
      const skip = state.controls.find((item) => item.text.toUpperCase() === "SKIP");
      if (!skip) throw new Error(`Unsupported challenge type ${challenge.type}`);
      await clickText(page, "SKIP");
      await submitAndContinue(page);
    }
  }
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

function scoreSession(session, bodyText) {
  const challenge = session?.challenges?.[0];
  if (!challenge) return -1;
  const body = bodyText.toLocaleLowerCase();
  let score = 0;
  if (challenge.prompt && body.includes(String(challenge.prompt).toLocaleLowerCase())) score += 8;
  for (const word of challenge.newWords || []) if (body.includes(String(word).toLocaleLowerCase())) score += 5;
  for (const choice of challenge.choices || []) {
    const text = choiceText(choice);
    if (text && body.includes(String(text).toLocaleLowerCase())) score += 2;
  }
  return score;
}

async function main() {
  const summary = { test: "organic-duolingo-end-to-end", authenticated: false, lessonEntered: false, lessonCompleted: false, completionReviewOpened: false, challengeLog: [], newWordObservations: [] };
  const sessionCandidates = [];
  let browser;
  try {
    const payload = decodeSession(await readFile(sessionPath, "ascii"));
    summary.payloadVersion = payload.version;
    summary.cookieNames = (payload.cookies || []).map((cookie) => cookie.name).sort();

    browser = await puppeteer.launch({ headless: false, pipe: true, ignoreDefaultArgs: ["--disable-extensions"], args: ["--no-sandbox", "--disable-dev-shm-usage", `--disable-extensions-except=${extensionRoot}`, `--load-extension=${extensionRoot}`] });
    const extensionTarget = await browser.waitForTarget((target) => target.type() === "service_worker" && target.url().startsWith("chrome-extension://"), { timeout: 10000 });
    const extensionId = new URL(extensionTarget.url()).host;
    summary.extensionId = extensionId;

    const page = await browser.newPage();
    page.on("response", async (response) => {
      if (!response.url().endsWith("/2023-05-23/sessions") || response.status() !== 200) return;
      try {
        const data = await response.json();
        if (Array.isArray(data?.challenges) && data.challenges.length) sessionCandidates.push(data);
      } catch {
        // Ignore unreadable prefetch responses.
      }
    });

    await restoreSession(page, payload);
    summary.authenticated = true;
    await page.waitForSelector('button[aria-label^="Lesson "]', { timeout: 10000 });
    summary.lessonControl = await page.$eval('button[aria-label^="Lesson "]', (button) => button.getAttribute("aria-label"));
    await page.click('button[aria-label^="Lesson "]');
    await sleep(800);
    await clickText(page, "START", { prefix: true });
    await page.waitForFunction(() => location.pathname === "/lesson", { timeout: 20000 });
    await sleep(2500);
    summary.lessonEntered = true;

    const first = await pageState(page);
    await page.screenshot({ path: path.join(outputDir, "00-first-challenge.png"), fullPage: false });
    await writeFile(path.join(outputDir, "00-first-challenge.json"), JSON.stringify(first, null, 2));
    await sleep(1000);
    const ranked = sessionCandidates.map((session) => ({ session, score: scoreSession(session, first.bodyText) })).sort((a, b) => b.score - a.score);
    summary.sessionCandidateScores = ranked.map(({ session, score }) => ({ id: session.id, score, firstType: session.challenges?.[0]?.type, firstPrompt: session.challenges?.[0]?.prompt ?? null }));
    const session = ranked[0]?.session;
    if (!session || ranked[0].score <= 0) throw new Error("Could not identify the active prefetched lesson session");
    await writeFile(path.join(outputDir, "active-session.json"), JSON.stringify(session, null, 2));
    summary.sessionId = session.id;
    summary.challengeCount = session.challenges.length;
    summary.challengeTypes = session.challenges.map((challenge) => challenge.type);

    const solverState = { speakingDisabled: false };
    let captureNumber = 1;
    for (let index = 0; index < session.challenges.length; index += 1) {
      const challenge = session.challenges[index];
      if (challenge.type === "speak" && solverState.speakingDisabled) {
        summary.challengeLog.push({ index, type: challenge.type, skippedBecauseSpeakingDisabled: true });
        continue;
      }
      await sleep(350);
      const before = await pageState(page);
      const newWords = challenge.newWords || [];
      summary.challengeLog.push({ index, id: challenge.id, type: challenge.type, prompt: challenge.prompt ?? null, newWords, beforeText: before.bodyText.slice(0, 2500), newWordTextNodeCount: before.newWordTextNodes.length });
      if (newWords.length) {
        const stem = `${String(captureNumber).padStart(2, "0")}-new-word-${index}`;
        await page.screenshot({ path: path.join(outputDir, `${stem}-before.png`), fullPage: false });
        await writeFile(path.join(outputDir, `${stem}-before.json`), JSON.stringify(before, null, 2));
        captureNumber += 1;
      }

      await solveChallenge(page, challenge, solverState);
      await sleep(500);
      if (newWords.length) {
        const ext = await extensionState(browser, extensionId);
        const stagedWords = (ext.staged || []).map((item) => item.word);
        summary.newWordObservations.push({ index, expectedNewWords: newWords, markerTextNodeCount: before.newWordTextNodes.length, stagedWords, expectedWordStaged: newWords.some((word) => stagedWords.some((staged) => staged.toLocaleLowerCase() === String(word).toLocaleLowerCase())) });
      }
    }

    await sleep(1800);
    const completion = await pageState(page);
    await writeFile(path.join(outputDir, "completion-page.json"), JSON.stringify(completion, null, 2));
    await page.screenshot({ path: path.join(outputDir, "completion-page.png"), fullPage: false });
    summary.completionText = completion.bodyText.slice(0, 5000);
    summary.lessonCompleted = /(?:LESSON|PRACTICE|LEVEL|UNIT)\s+COMPLETE/i.test(completion.bodyText);

    const finalState = await extensionState(browser, extensionId);
    summary.finalStaged = (finalState.staged || []).map((item) => ({ word: item.word, context: item.context, lessonId: item.lessonId, status: item.status, detectionCount: item.detectionCount }));
    const reviewTargets = browser.targets().filter((target) => target.url().startsWith(`chrome-extension://${extensionId}/review.html?lesson=`));
    summary.completionReviewOpened = reviewTargets.length > 0;
    if (reviewTargets.length) summary.completionReviewUrl = reviewTargets.at(-1).url();
    summary.allSessionNewWords = [...new Set(session.challenges.flatMap((challenge) => challenge.newWords || []))];
    summary.stagedExpectedNewWords = summary.allSessionNewWords.filter((word) => summary.finalStaged.some((item) => item.word.toLocaleLowerCase() === String(word).toLocaleLowerCase()));
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
