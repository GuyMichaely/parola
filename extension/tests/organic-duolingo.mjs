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

function phraseTokens(phrase) {
  return String(phrase || "")
    .replace(/[’]/g, "'")
    .match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) || [];
}

function normalizedPhrase(value) {
  return phraseTokens(value).join(" ").toLocaleLowerCase();
}

function nonEmptyLines(value) {
  return String(value || "")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
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
      for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
        const style = getComputedStyle(current);
        ancestors.push({
          tag: current.tagName,
          className: typeof current.className === "string" ? current.className : "",
          text: (current.innerText || current.textContent || "").replace(/\s+/g, " ").trim().slice(0, 1400),
          color: style.color,
          backgroundColor: style.backgroundColor,
          borderColor: style.borderColor,
          visible: visible(current),
          html: current.outerHTML.slice(0, 14_000),
        });
      }
      newWordTextNodes.push({ text, ancestors });
    }

    const choices = [...document.querySelectorAll('[data-test="challenge-choice"]')]
      .filter(visible)
      .map((element) => {
        const style = getComputedStyle(element);
        return {
          text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 500),
          ariaChecked: element.getAttribute("aria-checked"),
          className: typeof element.className === "string" ? element.className : "",
          color: style.color,
          backgroundColor: style.backgroundColor,
          borderColor: style.borderColor,
          html: element.outerHTML.slice(0, 14_000),
        };
      });

    return {
      href: location.href,
      bodyText: bodyText.slice(0, 40_000),
      newWordTextNodes,
      choices,
      controls: [...document.querySelectorAll("button,a,[role='button'],input,textarea,[data-test*='tap']")]
        .filter(visible)
        .slice(0, 350)
        .map((element) => ({
          text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 600),
          dataTest: element.getAttribute("data-test"),
          role: element.getAttribute("role"),
          ariaChecked: element.getAttribute("aria-checked"),
          disabled: element.matches(":disabled") || element.getAttribute("aria-disabled") === "true",
        })),
    };
  });
}

async function clickText(page, wanted, { prefix = false } = {}) {
  const clicked = await page.evaluate(({ wanted, prefix }) => {
    const norm = (value) => String(value || "").replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
    function visible(element) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0 && rect.width > 0 && rect.height > 0;
    }
    const target = norm(wanted).toLocaleLowerCase();
    const nodes = [...document.querySelectorAll("button,[role='button'],[data-test*='tap'],[data-test='challenge-choice'],[role='radio'],body *")];
    const matches = nodes.filter((element) => {
      if (!visible(element)) return false;
      const text = norm(element.innerText || element.textContent).toLocaleLowerCase();
      return prefix ? text.startsWith(target) : text === target;
    });
    matches.sort((a, b) => {
      const aPreferred = a.matches?.("button,[role='button'],[data-test*='tap'],[data-test='challenge-choice'],[role='radio']") ? 0 : 1;
      const bPreferred = b.matches?.("button,[role='button'],[data-test*='tap'],[data-test='challenge-choice'],[role='radio']") ? 0 : 1;
      return aPreferred - bPreferred || a.children.length - b.children.length;
    });
    const leaf = matches[0];
    if (!leaf) return false;
    let current = leaf;
    for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
      if (current.matches?.("button,a,[role='button'],[role='radio'],[tabindex]") || getComputedStyle(current).cursor === "pointer") {
        current.click();
        return true;
      }
    }
    leaf.click();
    return true;
  }, { wanted, prefix });
  if (!clicked) throw new Error(`Could not click visible text ${JSON.stringify(wanted)}`);
}

async function playerNextState(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-test="player-next"]');
    return el ? {
      text: (el.textContent || "").replace(/\s+/g, " ").trim().toUpperCase(),
      disabled: el.matches(":disabled") || el.getAttribute("aria-disabled") === "true",
    } : null;
  });
}

async function dismissInterstitials(page) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const state = await playerNextState(page);
    if (!state || state.disabled || !(state.text.startsWith("CONTINUE") || state.text.startsWith("GOT IT"))) return;
    await page.click('[data-test="player-next"]');
    await sleep(850);
  }
}

async function submitAnswer(page) {
  const state = await playerNextState(page);
  if (state && !state.disabled && (state.text.startsWith("CONTINUE") || state.text.startsWith("GOT IT"))) {
    return pageState(page);
  }
  if (!state || state.disabled || !state.text.startsWith("CHECK")) {
    throw new Error(`Expected an enabled CHECK button, got ${JSON.stringify(state)}`);
  }
  await page.click('[data-test="player-next"]');
  await sleep(750);
  return pageState(page);
}

function choiceText(choice) {
  if (typeof choice === "string") return choice;
  return choice?.text ?? choice?.phrase ?? null;
}

function challengeScoreFromVisibleChoices(challenge, body) {
  const normalizedBody = normalizedPhrase(body);
  const texts = [];
  for (const choice of challenge.choices || []) {
    const text = choiceText(choice);
    if (text) texts.push(text);
  }
  for (const pair of challenge.pairs || []) {
    if (pair.learningToken) texts.push(pair.learningToken);
    if (pair.fromToken) texts.push(pair.fromToken);
  }
  return texts.reduce((score, text) => score + (normalizedBody.includes(normalizedPhrase(text)) ? 1 : 0), 0);
}

function findPromptChallenge(challenges, prompt, preferredTypes = []) {
  const target = normalizedPhrase(prompt);
  const matches = challenges.filter((challenge) => challenge.prompt && normalizedPhrase(challenge.prompt) === target);
  matches.sort((a, b) => {
    const ai = preferredTypes.indexOf(a.type);
    const bi = preferredTypes.indexOf(b.type);
    const ar = ai < 0 ? preferredTypes.length : ai;
    const br = bi < 0 ? preferredTypes.length : bi;
    return ar - br;
  });
  return matches[0] || null;
}

function findSolutionChallenge(challenges, translation) {
  const target = normalizedPhrase(translation);
  return challenges.find((challenge) => challenge.solutionTranslation && normalizedPhrase(challenge.solutionTranslation) === target) || null;
}

function findChoiceScoredChallenge(challenges, types, body) {
  const candidates = challenges
    .filter((challenge) => types.includes(challenge.type))
    .map((challenge) => ({ challenge, score: challengeScoreFromVisibleChoices(challenge, body) }))
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.score > 0 ? candidates[0].challenge : null;
}

function planForState(state, challenges) {
  const body = state.bodyText;
  const lines = nonEmptyLines(body);

  if (/^(?:LESSON|PRACTICE|LEVEL|UNIT)\s+COMPLETE!?$/im.test(body)) {
    return { kind: "complete", challenge: null, answer: [] };
  }

  if (body.includes("Speak this sentence")) {
    const headerIndex = lines.findIndex((line) => line === "Speak this sentence");
    const prompt = lines[headerIndex + 1] || "";
    return { kind: "disable-speaking", challenge: findPromptChallenge(challenges, prompt, ["speak"]), answer: [] };
  }

  if (body.includes("Which one of these is")) {
    const header = lines.find((line) => line.includes("Which one of these is")) || "";
    const quoted = header.match(/[“"]([^”"]+)[”"]/u)?.[1] || "";
    const challenge = findPromptChallenge(challenges, quoted, ["select"]);
    if (!challenge) throw new Error(`Could not match select prompt ${JSON.stringify(quoted)}`);
    return { kind: "select", challenge, answer: [choiceText(challenge.choices?.[challenge.correctIndex])] };
  }

  if (body.includes("Write this in English")) {
    const headerIndex = lines.findIndex((line) => line === "Write this in English");
    const prompt = lines[headerIndex + 1] || "";
    const challenge = findPromptChallenge(challenges, prompt, ["translate", "speak"]);
    if (!challenge) throw new Error(`Could not match English-translation prompt ${JSON.stringify(prompt)}`);
    const answer = challenge.type === "translate"
      ? (challenge.correctTokens?.length ? challenge.correctTokens : (challenge.correctIndices || []).map((index) => choiceText(challenge.choices?.[index])).filter(Boolean))
      : phraseTokens(challenge.solutionTranslation);
    return { kind: "word-bank", challenge, answer };
  }

  if (body.includes("Write this in Italian")) {
    const headerIndex = lines.findIndex((line) => line === "Write this in Italian");
    const prompt = lines[headerIndex + 1] || "";
    const challenge = findSolutionChallenge(challenges, prompt);
    if (!challenge?.prompt) throw new Error(`Could not match Italian-translation prompt ${JSON.stringify(prompt)}`);
    return { kind: "word-bank-reverse", challenge, answer: phraseTokens(challenge.prompt) };
  }

  if (body.includes("Tap what you hear")) {
    const challenge = findChoiceScoredChallenge(challenges, ["listenTap", "listenSpeak"], body);
    if (!challenge) throw new Error("Could not match listen-tap challenge");
    const answer = challenge.correctTokens?.length
      ? challenge.correctTokens
      : (challenge.correctIndices || []).map((index) => choiceText(challenge.choices?.[index])).filter(Boolean);
    return { kind: "listen-tap", challenge, answer };
  }

  if (body.includes("Fill in the blank")) {
    const challenge = findChoiceScoredChallenge(challenges, ["tapComplete", "patternTapComplete"], body);
    if (!challenge) throw new Error("Could not match fill-in-the-blank challenge");
    const indices = challenge.correctIndices?.length ? challenge.correctIndices : [challenge.correctIndex].filter(Number.isInteger);
    return { kind: "tap-complete", challenge, answer: indices.map((index) => choiceText(challenge.choices?.[index])).filter(Boolean) };
  }

  if (body.includes("Complete the chat")) {
    const challenge = findChoiceScoredChallenge(challenges, ["dialogue"], body);
    if (!challenge) throw new Error("Could not match dialogue challenge");
    return { kind: "dialogue", challenge, answer: [choiceText(challenge.choices?.[challenge.correctIndex])] };
  }

  if (body.includes("Select the matching pairs")) {
    const challenge = findChoiceScoredChallenge(challenges, ["match", "listenMatch"], body);
    if (!challenge) throw new Error("Could not match matching-pairs challenge");
    return { kind: "match", challenge, answer: challenge.pairs || [] };
  }

  throw new Error(`Unsupported live Duolingo screen: ${body.slice(0, 1200)}`);
}

async function executePlan(page, plan) {
  if (plan.kind === "disable-speaking") {
    const state = await pageState(page);
    const disable = state.controls.find((item) => item.text.toUpperCase().includes("CAN'T SPEAK"));
    if (!disable) throw new Error("Speaking screen had no CAN'T SPEAK control");
    await clickText(page, disable.text);
    await sleep(550);
    const confirm = (await pageState(page)).controls.find((item) => /TURN OFF|DISABLE/.test(item.text.toUpperCase()));
    if (confirm) {
      await clickText(page, confirm.text);
      await sleep(450);
    }
    await dismissInterstitials(page);
    return null;
  }

  if (plan.kind === "match") {
    for (const pair of plan.answer) {
      const learning = pair.learningToken ?? pair.learningWord ?? pair.learningPhrase;
      const from = pair.fromToken ?? pair.fromWord ?? pair.fromPhrase;
      if (!learning || !from) continue;
      await clickText(page, learning);
      await sleep(100);
      await clickText(page, from);
      await sleep(180);
    }
  } else {
    for (const token of plan.answer) {
      if (!token) continue;
      await clickText(page, token);
      await sleep(115);
    }
  }

  return submitAnswer(page);
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
  const body = normalizedPhrase(bodyText);
  let score = 0;
  if (challenge.prompt && body.includes(normalizedPhrase(challenge.prompt))) score += 8;
  for (const word of challenge.newWords || []) if (body.includes(normalizedPhrase(word))) score += 5;
  for (const choice of challenge.choices || []) {
    const text = choiceText(choice);
    if (text && body.includes(normalizedPhrase(text))) score += 2;
  }
  return score;
}

async function main() {
  const summary = {
    test: "organic-duolingo-end-to-end",
    sourceSha: process.env.GITHUB_SHA || null,
    authenticated: false,
    lessonEntered: false,
    lessonCompleted: false,
    completionReviewOpened: false,
    steps: [],
    newWordObservations: [],
  };
  const sessionCandidates = [];
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
    summary.lessonUrl = page.url();

    const first = await pageState(page);
    await page.screenshot({ path: path.join(outputDir, "00-first-challenge.png"), fullPage: false });
    await writeFile(path.join(outputDir, "00-first-challenge.json"), JSON.stringify(first, null, 2));
    await sleep(900);

    const ranked = sessionCandidates
      .map((session) => ({ session, score: scoreSession(session, first.bodyText) }))
      .sort((a, b) => b.score - a.score);
    summary.sessionCandidateScores = ranked.map(({ session, score }) => ({
      id: session.id,
      score,
      firstType: session.challenges?.[0]?.type,
      firstPrompt: session.challenges?.[0]?.prompt ?? null,
    }));
    const session = ranked[0]?.session;
    if (!session || ranked[0].score <= 0) throw new Error("Could not identify the active prefetched lesson session");
    await writeFile(path.join(outputDir, "active-session.json"), JSON.stringify(session, null, 2));
    summary.sessionId = session.id;
    summary.challengeCount = session.challenges.length;
    summary.sessionNewWords = [...new Set(session.challenges.flatMap((challenge) => challenge.newWords || []))];

    let captureNumber = 1;
    for (let step = 0; step < 45; step += 1) {
      await dismissInterstitials(page);
      await sleep(350);
      const before = await pageState(page);
      const plan = planForState(before, session.challenges);
      if (plan.kind === "complete") {
        summary.lessonCompleted = true;
        summary.completionText = before.bodyText.slice(0, 6000);
        await writeFile(path.join(outputDir, "completion-page.json"), JSON.stringify(before, null, 2));
        await page.screenshot({ path: path.join(outputDir, "completion-page.png"), fullPage: false });
        break;
      }

      const newWords = plan.challenge?.newWords || [];
      const markerVisible = before.newWordTextNodes.length > 0;
      const log = {
        step,
        kind: plan.kind,
        challengeId: plan.challenge?.id || null,
        challengeType: plan.challenge?.type || null,
        prompt: plan.challenge?.prompt ?? null,
        newWords,
        markerVisible,
        bodyStart: before.bodyText.slice(0, 2600),
      };
      summary.steps.push(log);

      let stem = null;
      if (markerVisible || newWords.length) {
        stem = `${String(captureNumber).padStart(2, "0")}-new-word-step-${step}`;
        await writeFile(path.join(outputDir, `${stem}-before.json`), JSON.stringify(before, null, 2));
        await page.screenshot({ path: path.join(outputDir, `${stem}-before.png`), fullPage: false });
        captureNumber += 1;
      }

      const feedback = await executePlan(page, plan);
      if (feedback) {
        if (stem) {
          await writeFile(path.join(outputDir, `${stem}-feedback.json`), JSON.stringify(feedback, null, 2));
          await page.screenshot({ path: path.join(outputDir, `${stem}-feedback.png`), fullPage: false });
        }
        await sleep(450);
        const ext = await extensionState(browser, extensionId);
        const stagedWords = (ext.staged || []).map((item) => item.word);
        if (markerVisible || newWords.length) {
          summary.newWordObservations.push({
            step,
            challengeType: plan.challenge?.type || null,
            prompt: plan.challenge?.prompt ?? null,
            expectedNewWords: newWords,
            markerVisible,
            stagedWords,
            expectedWordStaged: newWords.some((word) => stagedWords.some((staged) => staged.toLocaleLowerCase() === String(word).toLocaleLowerCase())),
            feedbackText: feedback.bodyText.slice(0, 2200),
            feedbackChoices: feedback.choices,
          });
        }
        await dismissInterstitials(page);
      }
    }

    if (!summary.lessonCompleted) {
      const finalPage = await pageState(page);
      summary.finalPageText = finalPage.bodyText.slice(0, 6000);
      throw new Error("Organic lesson solver did not reach the completion screen within 45 UI steps");
    }

    await sleep(1200);
    const finalState = await extensionState(browser, extensionId);
    summary.finalStaged = (finalState.staged || []).map((item) => ({
      word: item.word,
      context: item.context,
      lessonId: item.lessonId,
      status: item.status,
      detectionCount: item.detectionCount,
    }));
    summary.stagedExpectedNewWords = summary.sessionNewWords.filter((word) =>
      summary.finalStaged.some((item) => item.word.toLocaleLowerCase() === String(word).toLocaleLowerCase()),
    );

    const reviewTargets = browser.targets().filter((target) => target.url().startsWith(`chrome-extension://${extensionId}/review.html?lesson=`));
    summary.completionReviewOpened = reviewTargets.length > 0;
    if (reviewTargets.length) {
      summary.completionReviewUrl = reviewTargets.at(-1).url();
      const reviewPage = await reviewTargets.at(-1).page();
      if (reviewPage) {
        await reviewPage.waitForSelector("body", { timeout: 5000 });
        summary.reviewText = (await reviewPage.$eval("body", (body) => body.innerText)).slice(0, 6000);
        await reviewPage.screenshot({ path: path.join(outputDir, "review-page.png"), fullPage: true });
      }
    }

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
