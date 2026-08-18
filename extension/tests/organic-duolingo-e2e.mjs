import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer";

const root = path.resolve(process.cwd());
const outputDir = path.resolve(process.env.DUOLINGO_CAPTURE_DIR || "organic-duolingo-capture");
const sessionPath = path.resolve(process.env.DUOLINGO_SESSION_STATE_FILE || "tests/fixtures/duolingo-session-state.b64");
const origin = "https://www.duolingo.com";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const completionPattern = /^(?:LESSON|PRACTICE|LEVEL|UNIT)\s+COMPLETE!?$/im;

await mkdir(outputDir, { recursive: true });

function norm(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/[’]/g, "'")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value) {
  return norm(value).match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) || [];
}

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

async function restore(page, payload) {
  const client = await page.createCDPSession();
  await client.send("Network.enable");
  await page.goto(`${origin}/robots.txt`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await client.send("Network.clearBrowserCookies");
  await client.send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
  await client.send("Network.setCookies", { cookies: (payload.cookies || []).map(cookieParam) });
  await page.evaluate(({ local, session }) => {
    localStorage.clear();
    sessionStorage.clear();
    for (const [key, value] of Object.entries(local || {})) localStorage.setItem(key, String(value));
    for (const [key, value] of Object.entries(session || {})) sessionStorage.setItem(key, String(value));
  }, { local: payload.localStorage || {}, session: payload.sessionStorage || {} });
  await page.goto(`${origin}/learn`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await sleep(5000);
  assert.ok(new URL(page.url()).pathname.startsWith("/learn"), `Expected authenticated /learn, got ${page.url()}`);
}

async function state(page) {
  return page.evaluate(() => {
    function visible(element) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0 && rect.width > 0 && rect.height > 0;
    }
    const text = (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n");
    const controls = [...document.querySelectorAll("button,a,[role='button'],[role='radio'],input,textarea,[data-test]")]
      .filter(visible)
      .slice(0, 500)
      .map((element) => ({
        text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 600),
        dataTest: element.getAttribute("data-test"),
        role: element.getAttribute("role"),
        disabled: element.matches(":disabled") || element.getAttribute("aria-disabled") === "true",
      }));
    const tapTokens = controls.filter((item) => item.dataTest && /(?:^|-)challenge-tap-token$/.test(item.dataTest) && item.text);
    const choices = controls.filter((item) => item.dataTest === "challenge-choice" && item.text);
    let newWord = false;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (String(node.nodeValue || "").replace(/\s+/g, " ").trim().toUpperCase() !== "NEW WORD") continue;
      if (node.parentElement && visible(node.parentElement)) {
        newWord = true;
        break;
      }
    }
    return {
      href: location.href,
      text: text.slice(0, 45_000),
      controls,
      tapTokens,
      choices,
      newWord,
    };
  });
}

async function clickControlText(page, wanted, { prefix = false, selector = null } = {}) {
  const ok = await page.evaluate(({ wanted, prefix, selector }) => {
    const normalize = (value) => String(value || "").replace(/[’]/g, "'").replace(/\s+/g, " ").trim().toLocaleLowerCase();
    function visible(element) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0 && rect.width > 0 && rect.height > 0;
    }
    const target = normalize(wanted);
    const query = selector || "button,a,[role='button'],[role='radio'],[data-test]";
    const candidates = [...document.querySelectorAll(query)].filter((element) => {
      if (!visible(element)) return false;
      const text = normalize(element.innerText || element.textContent);
      return prefix ? text.startsWith(target) : text === target;
    });
    candidates.sort((a, b) => a.children.length - b.children.length);
    const element = candidates[0];
    if (!element) return false;
    element.click();
    return true;
  }, { wanted, prefix, selector });
  if (!ok) throw new Error(`Could not click ${JSON.stringify(wanted)}${selector ? ` via ${selector}` : ""}`);
}

async function nextButton(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-test="player-next"]');
    if (!el) return null;
    return {
      text: (el.textContent || "").replace(/\s+/g, " ").trim().toUpperCase(),
      disabled: el.matches(":disabled") || el.getAttribute("aria-disabled") === "true",
    };
  });
}

async function dismissFeedback(page) {
  for (let i = 0; i < 10; i += 1) {
    const current = await state(page);
    if (completionPattern.test(current.text)) return;
    const next = await nextButton(page);
    if (next && !next.disabled && /^(CONTINUE|GOT IT)/.test(next.text)) {
      await page.click('[data-test="player-next"]');
      await sleep(800);
      continue;
    }
    const fallback = current.controls.find((item) => !item.disabled && /^(CONTINUE|GOT IT)/i.test(item.text));
    if (!fallback) return;
    await clickControlText(page, fallback.text);
    await sleep(800);
  }
}

async function submit(page) {
  const next = await nextButton(page);
  if (next && !next.disabled && /^(CONTINUE|GOT IT)/.test(next.text)) return state(page);
  if (!next || next.disabled || !next.text.startsWith("CHECK")) throw new Error(`Expected enabled CHECK; got ${JSON.stringify(next)}`);
  await page.click('[data-test="player-next"]');
  await sleep(700);
  return state(page);
}

function choiceText(choice) {
  return typeof choice === "string" ? choice : choice?.text ?? choice?.phrase ?? null;
}

function exactPrompt(challenges, prompt, types = []) {
  const target = norm(prompt);
  const matches = challenges.filter((challenge) => challenge.prompt && norm(challenge.prompt) === target);
  matches.sort((a, b) => {
    const ai = types.indexOf(a.type);
    const bi = types.indexOf(b.type);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  return matches[0] || null;
}

function challengeChoiceAnswer(challenge) {
  const indices = challenge.correctIndices?.length ? challenge.correctIndices : [challenge.correctIndex].filter(Number.isInteger);
  return indices.map((index) => choiceText(challenge.choices?.[index])).filter(Boolean);
}

function choiceOverlap(challenge, visibleText) {
  const body = norm(visibleText);
  const values = [];
  for (const choice of challenge.choices || []) {
    const value = choiceText(choice);
    if (value) values.push(value);
  }
  for (const pair of challenge.pairs || []) {
    if (pair.learningToken) values.push(pair.learningToken);
    if (pair.fromToken) values.push(pair.fromToken);
  }
  return values.reduce((score, value) => score + (body.includes(norm(value)) ? 1 : 0), 0);
}

function bestByChoices(challenges, types, visibleText) {
  const ranked = challenges
    .filter((challenge) => types.includes(challenge.type))
    .map((challenge) => ({ challenge, score: choiceOverlap(challenge, visibleText) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score > 0 ? ranked[0].challenge : null;
}

function translationCandidates(challenge) {
  return [
    challenge.solutionTranslation,
    challenge.metadata?.translation,
    challenge.metadata?.best_translation,
    challenge.metadata?.challenge_construction_insights?.best_solution,
  ].filter(Boolean);
}

function exactReverse(challenges, english) {
  const target = norm(english);
  return challenges.find((challenge) => translationCandidates(challenge).some((candidate) => norm(candidate) === target)) || null;
}

function buildLexicon(challenges) {
  const lexicon = new Map();
  for (const challenge of challenges) {
    for (const token of challenge.tokens || []) {
      const italian = norm(token.value);
      if (!italian || !/[\p{L}\p{N}]/u.test(italian)) continue;
      const hints = new Set(lexicon.get(italian) || []);
      for (const row of token.hintTable?.rows || []) {
        for (const cell of row || []) {
          if (cell?.hint) hints.add(String(cell.hint));
        }
      }
      lexicon.set(italian, [...hints]);
    }
  }
  return lexicon;
}

function generatedReverseAnswer(english, tapTokens, lexicon) {
  const prompt = norm(english);
  const candidates = [];
  const seen = new Set();
  for (const item of tapTokens) {
    const italianText = item.text.replace(/^\d+\s+/, "").trim();
    const key = norm(italianText);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    let best = null;
    for (const hint of lexicon.get(key) || []) {
      const normalizedHint = norm(hint);
      if (!normalizedHint) continue;
      const position = ` ${prompt} `.indexOf(` ${normalizedHint} `);
      if (position < 0) continue;
      const score = words(normalizedHint).length * 100 + normalizedHint.length;
      if (!best || score > best.score) best = { position, score, hint: normalizedHint };
    }
    if (best) candidates.push({ text: italianText, ...best });
  }
  candidates.sort((a, b) => a.position - b.position || a.score - b.score);
  if (candidates.length < 2) throw new Error(`Could not derive reverse translation for ${JSON.stringify(english)} from ${JSON.stringify(tapTokens.map((item) => item.text))}`);
  return candidates.map((candidate) => candidate.text);
}

function sessionScore(session, firstScreen) {
  const challenge = session?.challenges?.[0];
  if (!challenge) return -1;
  let score = 0;
  const body = norm(firstScreen.text);
  if (challenge.prompt && body.includes(norm(challenge.prompt))) score += 10;
  for (const word of challenge.newWords || []) if (body.includes(norm(word))) score += 5;
  score += choiceOverlap(challenge, firstScreen.text);
  return score;
}

function screenPlan(screen, challenges, lexicon) {
  const lines = screen.text.split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const body = screen.text;

  if (completionPattern.test(body)) return { kind: "complete", challenge: null, answer: [] };

  if (body.includes("Speak this sentence")) {
    const index = lines.indexOf("Speak this sentence");
    return { kind: "disable-speaking", challenge: exactPrompt(challenges, lines[index + 1], ["speak"]), answer: [] };
  }

  if (body.includes("Which one of these is")) {
    const header = lines.find((line) => line.includes("Which one of these is")) || "";
    const prompt = header.match(/[“"]([^”"]+)[”"]/u)?.[1] || "";
    const challenge = exactPrompt(challenges, prompt, ["select"]);
    if (!challenge) throw new Error(`No select answer key for ${JSON.stringify(prompt)}`);
    return { kind: "choice", challenge, answer: challengeChoiceAnswer(challenge) };
  }

  if (body.includes("Select the correct meaning")) {
    const index = lines.indexOf("Select the correct meaning");
    const prompt = lines[index + 1] || "";
    const challenge = exactPrompt(challenges, prompt, ["assist"]);
    if (!challenge) throw new Error(`No meaning answer key for ${JSON.stringify(prompt)}`);
    return { kind: "choice", challenge, answer: challengeChoiceAnswer(challenge) };
  }

  if (body.includes("Write this in English")) {
    const index = lines.indexOf("Write this in English");
    const prompt = lines[index + 1] || "";
    const challenge = exactPrompt(challenges, prompt, ["translate", "speak"]);
    if (!challenge) throw new Error(`No English answer key for ${JSON.stringify(prompt)}`);
    const answer = challenge.type === "speak"
      ? words(challenge.solutionTranslation)
      : challenge.correctTokens?.length
        ? challenge.correctTokens
        : challengeChoiceAnswer(challenge);
    return { kind: "tokens", challenge, answer };
  }

  if (body.includes("Write this in Italian")) {
    const index = lines.indexOf("Write this in Italian");
    const english = lines[index + 1] || "";
    const challenge = exactReverse(challenges, english);
    const answer = challenge?.prompt ? words(challenge.prompt) : generatedReverseAnswer(english, screen.tapTokens, lexicon);
    return { kind: "tokens", challenge, answer, generatedEnglish: challenge ? null : english };
  }

  if (body.includes("Tap what you hear")) {
    const challenge = bestByChoices(challenges, ["listenTap", "listenSpeak"], body);
    if (!challenge) throw new Error("No listen answer key");
    const answer = challenge.correctTokens?.length ? challenge.correctTokens : challengeChoiceAnswer(challenge);
    return { kind: "tokens", challenge, answer };
  }

  if (body.includes("Select the matching pairs")) {
    const challenge = bestByChoices(challenges, ["match", "listenMatch"], body);
    if (!challenge) throw new Error("No match answer key");
    return { kind: "match", challenge, answer: challenge.pairs || [] };
  }

  const choiceChallenge = bestByChoices(challenges, ["tapComplete", "patternTapComplete", "dialogue", "assist", "select"], body);
  if (choiceChallenge) return { kind: "choice", challenge: choiceChallenge, answer: challengeChoiceAnswer(choiceChallenge) };

  throw new Error(`Unsupported organic screen: ${body.slice(0, 1400)}`);
}

async function execute(page, plan) {
  if (plan.kind === "disable-speaking") {
    const s = await state(page);
    const disable = s.controls.find((item) => /CAN'T SPEAK/i.test(item.text));
    if (!disable) throw new Error("No CAN'T SPEAK control");
    await clickControlText(page, disable.text);
    await sleep(500);
    const confirmState = await state(page);
    const confirm = confirmState.controls.find((item) => /TURN OFF|DISABLE/i.test(item.text));
    if (confirm) await clickControlText(page, confirm.text);
    await sleep(450);
    await dismissFeedback(page);
    return null;
  }

  if (plan.kind === "match") {
    for (const pair of plan.answer) {
      const left = pair.learningToken ?? pair.learningWord ?? pair.learningPhrase;
      const right = pair.fromToken ?? pair.fromWord ?? pair.fromPhrase;
      if (!left || !right) continue;
      await clickControlText(page, left);
      await sleep(100);
      await clickControlText(page, right);
      await sleep(180);
    }
  } else if (plan.kind === "tokens") {
    for (const token of plan.answer) {
      await clickControlText(page, token, { selector: '[data-test$="-challenge-tap-token"], [data-test="challenge-tap-token"]' });
      await sleep(110);
    }
  } else {
    for (const choice of plan.answer) {
      await clickControlText(page, choice, { selector: '[data-test="challenge-choice"], [role="radio"], button' });
      await sleep(120);
    }
  }
  return submit(page);
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
    test: "organic-duolingo-e2e-v2",
    sourceSha: process.env.GITHUB_SHA || null,
    authenticated: false,
    lessonEntered: false,
    lessonCompleted: false,
    completionReviewOpened: false,
    steps: [],
    observations: [],
  };
  const sessions = [];
  let browser;

  try {
    const payload = decodeSession(await readFile(sessionPath, "ascii"));
    summary.cookieNames = (payload.cookies || []).map((cookie) => cookie.name).sort();

    browser = await puppeteer.launch({
      headless: false,
      pipe: true,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: ["--no-sandbox", "--disable-dev-shm-usage", `--disable-extensions-except=${root}`, `--load-extension=${root}`],
    });
    const extensionTarget = await browser.waitForTarget((target) => target.type() === "service_worker" && target.url().startsWith("chrome-extension://"), { timeout: 10_000 });
    const extensionId = new URL(extensionTarget.url()).host;
    summary.extensionId = extensionId;

    const page = await browser.newPage();
    page.on("response", async (response) => {
      if (!response.url().endsWith("/2023-05-23/sessions") || response.status() !== 200) return;
      try {
        const data = await response.json();
        if (Array.isArray(data?.challenges) && data.challenges.length) sessions.push(data);
      } catch {}
    });

    await restore(page, payload);
    summary.authenticated = true;
    await page.waitForSelector('button[aria-label^="Lesson "]', { timeout: 10_000 });
    summary.lessonControl = await page.$eval('button[aria-label^="Lesson "]', (el) => el.getAttribute("aria-label"));
    await page.click('button[aria-label^="Lesson "]');
    await sleep(700);
    await clickControlText(page, "START", { prefix: true });
    await page.waitForFunction(() => location.pathname === "/lesson", { timeout: 20_000 });
    await sleep(2300);
    summary.lessonEntered = true;

    const first = await state(page);
    await writeFile(path.join(outputDir, "00-first-screen.json"), JSON.stringify(first, null, 2));
    await page.screenshot({ path: path.join(outputDir, "00-first-screen.png"), fullPage: false });
    const ranked = sessions.map((session) => ({ session, score: sessionScore(session, first) })).sort((a, b) => b.score - a.score);
    const lesson = ranked[0]?.session;
    if (!lesson || ranked[0].score <= 0) throw new Error("Could not identify active lesson session");
    summary.sessionId = lesson.id;
    summary.challengeCount = lesson.challenges.length;
    summary.sessionNewWords = [...new Set(lesson.challenges.flatMap((challenge) => challenge.newWords || []))];
    await writeFile(path.join(outputDir, "active-session.json"), JSON.stringify(lesson, null, 2));
    const lexicon = buildLexicon(lesson.challenges);

    let capture = 1;
    for (let step = 0; step < 60; step += 1) {
      await dismissFeedback(page);
      await sleep(300);
      const before = await state(page);
      const plan = screenPlan(before, lesson.challenges, lexicon);
      if (plan.kind === "complete") {
        summary.lessonCompleted = true;
        summary.completionText = before.text.slice(0, 6000);
        await writeFile(path.join(outputDir, "completion-screen.json"), JSON.stringify(before, null, 2));
        await page.screenshot({ path: path.join(outputDir, "completion-screen.png"), fullPage: false });
        break;
      }

      const expected = plan.challenge?.newWords || [];
      summary.steps.push({
        step,
        kind: plan.kind,
        challengeType: plan.challenge?.type || null,
        challengeId: plan.challenge?.id || null,
        prompt: plan.challenge?.prompt || plan.generatedEnglish || null,
        expectedNewWords: expected,
        newWordMarker: before.newWord,
        answer: plan.answer,
        screenStart: before.text.slice(0, 2200),
      });

      let stem = null;
      if (before.newWord || expected.length) {
        stem = `${String(capture++).padStart(2, "0")}-new-word-step-${step}`;
        await writeFile(path.join(outputDir, `${stem}-before.json`), JSON.stringify(before, null, 2));
        await page.screenshot({ path: path.join(outputDir, `${stem}-before.png`), fullPage: false });
      }

      const feedback = await execute(page, plan);
      if (feedback) {
        if (stem) {
          await writeFile(path.join(outputDir, `${stem}-feedback.json`), JSON.stringify(feedback, null, 2));
          await page.screenshot({ path: path.join(outputDir, `${stem}-feedback.png`), fullPage: false });
        }
        await sleep(450);
        const ext = await extensionState(browser, extensionId);
        const stagedWords = (ext.staged || []).map((item) => item.word);
        if (before.newWord || expected.length) {
          summary.observations.push({
            step,
            expectedNewWords: expected,
            newWordMarker: before.newWord,
            stagedWords,
            expectedStaged: expected.filter((word) => stagedWords.some((staged) => norm(staged) === norm(word))),
          });
        }
      }
    }

    if (!summary.lessonCompleted) throw new Error("Did not reach organic lesson completion within 60 live UI steps");

    await sleep(1200);
    const finalExt = await extensionState(browser, extensionId);
    summary.finalStaged = (finalExt.staged || []).map((item) => ({ word: item.word, context: item.context, lessonId: item.lessonId, status: item.status, detectionCount: item.detectionCount }));

    const reviewTargets = browser.targets().filter((target) => target.url().startsWith(`chrome-extension://${extensionId}/review.html?lesson=`));
    summary.completionReviewOpened = reviewTargets.length > 0;
    if (reviewTargets.length) {
      const target = reviewTargets.at(-1);
      summary.completionReviewUrl = target.url();
      const review = await target.page();
      if (review) {
        await review.waitForSelector("body", { timeout: 5000 });
        summary.reviewText = (await review.$eval("body", (body) => body.innerText)).slice(0, 8000);
        await review.screenshot({ path: path.join(outputDir, "review-screen.png"), fullPage: true });
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
