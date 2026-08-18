import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer";

const outputDir = path.resolve(process.env.DUOLINGO_CAPTURE_DIR || "organic-duolingo-capture");
const summaryPath = path.join(outputDir, "summary.json");

const originalLaunch = puppeteer.launch.bind(puppeteer);
let capturedBrowser = null;
let realClose = null;

function normalizeControlText(value) {
  return String(value || "")
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function normalizeChallengeForSolver(challenge) {
  if (
    challenge?.sourceLanguage === "en"
    && challenge?.targetLanguage === "it"
    && Array.isArray(challenge.correctSolutions)
    && challenge.correctSolutions.length
  ) {
    return {
      ...challenge,
      solutionTranslation: challenge.prompt,
      prompt: challenge.correctSolutions[0],
    };
  }
  return challenge;
}

function normalizeSessionPayload(data) {
  if (!data || !Array.isArray(data.challenges)) return data;
  const pools = [
    data.challenges,
    data.adaptiveChallenges,
    data.mistakesReplacementChallenges,
    data.adaptiveInterleavedChallenges,
  ];
  const merged = [];
  const seen = new Set();
  for (const challenge of pools.flatMap((pool) => Array.isArray(pool) ? pool : [])) {
    const normalized = normalizeChallengeForSolver(challenge);
    const key = normalized?.id || JSON.stringify([
      normalized?.type,
      normalized?.prompt,
      normalized?.solutionTranslation,
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(normalized);
  }
  return { ...data, challenges: merged };
}

function hardenSessionResponses(page) {
  const originalOn = page.on.bind(page);
  page.on = (eventName, listener) => {
    if (eventName !== "response") return originalOn(eventName, listener);
    return originalOn("response", (response) => {
      if (!response.url().endsWith("/2023-05-23/sessions") || response.status() !== 200) {
        return listener(response);
      }
      const proxy = new Proxy(response, {
        get(target, property) {
          if (property === "json") {
            return async () => normalizeSessionPayload(await target.json());
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      return listener(proxy);
    });
  };
}

async function captureStartState(page, originalEvaluate, clickedStartText) {
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const snapshot = await originalEvaluate((clickedText) => {
    function visible(element) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity || "1") > 0
        && rect.width > 0
        && rect.height > 0;
    }
    return {
      href: location.href,
      pathname: location.pathname,
      clickedStartText: clickedText,
      bodyText: (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n").slice(0, 20_000),
      visibleButtons: [...document.querySelectorAll("button")]
        .filter(visible)
        .map((button) => ({
          text: (button.innerText || button.textContent || "").replace(/\s+/g, " ").trim().slice(0, 500),
          dataTest: button.getAttribute("data-test"),
          ariaLabel: button.getAttribute("aria-label"),
          disabled: button.matches(":disabled") || button.getAttribute("aria-disabled") === "true",
        })),
    };
  }, clickedStartText);
  await writeFile(path.join(outputDir, "start-transition.json"), JSON.stringify(snapshot, null, 2));
  await page.screenshot({ path: path.join(outputDir, "start-transition.png"), fullPage: false });
}

async function clickNumberedChoice(page, originalEvaluate, details) {
  const selector = '[data-test="challenge-choice"], [role="radio"], button';
  const choices = await page.$$(selector);
  const target = normalizeControlText(details.wanted);
  for (const choice of choices) {
    const info = await originalEvaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim(),
        visible: style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity || "1") > 0
          && rect.width > 0
          && rect.height > 0,
        disabled: element.matches(":disabled") || element.getAttribute("aria-disabled") === "true",
      };
    }, choice);
    if (!info.visible || info.disabled) continue;
    const text = normalizeControlText(info.text);
    const deindexed = text.replace(/^\d+\s+/, "").replace(/\s+\d+$/, "");
    const matches = details.prefix
      ? text.startsWith(target) || deindexed.startsWith(target)
      : text === target || deindexed === target;
    if (!matches) continue;
    await choice.click();
    return true;
  }
  return false;
}

async function hardenPageForOrganicStart(page) {
  hardenSessionResponses(page);
  const originalEvaluate = page.evaluate.bind(page);
  const originalWaitForFunction = page.waitForFunction.bind(page);

  page.evaluate = async (pageFunction, ...args) => {
    const details = args[0];
    if (details?.wanted && typeof details?.selector === "string" && details.selector.includes("challenge-choice")) {
      if (await clickNumberedChoice(page, originalEvaluate, details)) return true;
    }
    if (details?.wanted === "START" && details?.prefix === true) {
      const buttons = await page.$$("button");
      for (const button of buttons) {
        const info = await originalEvaluate((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return {
            text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim(),
            visible: style.display !== "none"
              && style.visibility !== "hidden"
              && Number(style.opacity || "1") > 0
              && rect.width > 0
              && rect.height > 0,
            disabled: element.matches(":disabled") || element.getAttribute("aria-disabled") === "true",
          };
        }, button);
        if (!info.visible || info.disabled || !normalizeControlText(info.text).startsWith("start")) continue;
        await button.click();
        await captureStartState(page, originalEvaluate, info.text);
        return true;
      }
    }
    return originalEvaluate(pageFunction, ...args);
  };

  page.waitForFunction = async (pageFunction, options, ...args) => {
    const source = String(pageFunction);
    if (source.includes('location.pathname === "/lesson"')) {
      return originalWaitForFunction(
        () => !location.pathname.startsWith("/learn"),
        options,
        ...args,
      );
    }
    return originalWaitForFunction(pageFunction, options, ...args);
  };
}

puppeteer.launch = async (...args) => {
  const browser = await originalLaunch(...args);
  capturedBrowser = browser;
  realClose = browser.close.bind(browser);

  const originalNewPage = browser.newPage.bind(browser);
  browser.newPage = async (...pageArgs) => {
    const page = await originalNewPage(...pageArgs);
    await hardenPageForOrganicStart(page);
    return page;
  };

  Object.defineProperty(browser, "close", {
    configurable: true,
    value: async () => {},
  });
  return browser;
};

function normalize(value) {
  return String(value || "").normalize("NFC").toLocaleLowerCase("it-IT").trim();
}

const cardPlans = [
  { detected: "pollo", italian: "pollo", english: "chicken", type: "noun", gender: "masculine" },
  { detected: "panino", italian: "panino", english: "sandwich", type: "noun", gender: "masculine" },
  { detected: "panini", italian: "panino", english: "sandwich", type: "noun", gender: "masculine" },
  { detected: "fagiolo", italian: "fagiolo", english: "bean", type: "noun", gender: "masculine" },
  { detected: "fagioli", italian: "fagiolo", english: "bean", type: "noun", gender: "masculine" },
  { detected: "buono", italian: "buono", english: "good", type: "adjective" },
  { detected: "buoni", italian: "buono", english: "good", type: "adjective" },
  { detected: "polpetta", italian: "polpetta", english: "meatball", type: "noun", gender: "feminine" },
  { detected: "patata", italian: "patata", english: "potato", type: "noun", gender: "feminine" },
  { detected: "polpette", italian: "polpetta", english: "meatball", type: "noun", gender: "feminine" },
  { detected: "patate", italian: "patata", english: "potato", type: "noun", gender: "feminine" },
  { detected: "piccole", italian: "piccolo", english: "small", type: "adjective" },
  { detected: "piccola", italian: "piccolo", english: "small", type: "adjective" },
  { detected: "piccolo", italian: "piccolo", english: "small", type: "adjective" },
];

async function waitForReview(browser, extensionId) {
  const existing = browser.targets().find((target) => target.url().startsWith(`chrome-extension://${extensionId}/review.html?lesson=`));
  const target = existing || await browser.waitForTarget(
    (candidate) => candidate.url().startsWith(`chrome-extension://${extensionId}/review.html?lesson=`),
    { timeout: 10_000 },
  );
  const page = await target.page();
  assert.ok(page, "organic completion review target should have a page");
  await page.waitForSelector(".staged-card[data-id]", { timeout: 10_000 });
  return page;
}

async function availableReviewCards(review) {
  return review.$$eval(".staged-card[data-id]", (cards) => cards.map((card) => ({
    id: card.dataset.id,
    word: card.querySelector('input[data-field="word"]')?.value || "",
    status: card.classList.contains("approved") ? "approved" : "pending",
  })));
}

async function findPlan(review) {
  const cards = await availableReviewCards(review);
  for (const plan of cardPlans) {
    const card = cards.find((candidate) => normalize(candidate.word) === normalize(plan.detected));
    if (card) return { ...plan, id: card.id, originalWord: card.word };
  }
  throw new Error(`No importable organic card was detected. Review contained: ${cards.map((card) => card.word).join(", ")}`);
}

async function setInput(review, id, field, value) {
  const selector = `.staged-card[data-id="${id}"] input[data-field="${field}"]`;
  await review.waitForSelector(selector, { timeout: 5000 });
  await review.$eval(selector, (input, nextValue) => {
    input.value = nextValue;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await new Promise((resolve) => setTimeout(resolve, 550));
}

async function setCardType(review, id, type) {
  const selector = `.staged-card[data-id="${id}"] select[data-field="cardType"]`;
  await review.waitForSelector(selector, { timeout: 5000 });
  await review.select(selector, type);
  await new Promise((resolve) => setTimeout(resolve, 650));
}

async function setDetailSelect(review, id, detail, value) {
  const selector = `.staged-card[data-id="${id}"] select[data-detail="${detail}"]`;
  await review.waitForSelector(selector, { timeout: 5000 });
  await review.select(selector, value);
  await new Promise((resolve) => setTimeout(resolve, 650));
}

async function completeCard(review, plan) {
  if (normalize(plan.originalWord) !== normalize(plan.italian)) {
    await setInput(review, plan.id, "word", plan.italian);
  }
  await setInput(review, plan.id, "english", plan.english);
  await setCardType(review, plan.id, plan.type);
  if (plan.type === "noun") {
    await setDetailSelect(review, plan.id, "gender", plan.gender);
  }

  const selector = `.staged-card[data-id="${plan.id}"] button[data-action="approve"]`;
  await review.waitForSelector(selector, { timeout: 5000 });
  await review.click(selector);
  await review.waitForFunction(
    (id) => document.querySelector(`.staged-card[data-id="${id}"]`)?.classList.contains("approved"),
    { timeout: 7000 },
    plan.id,
  );
  await review.waitForFunction(
    () => document.querySelector("#approved-summary")?.textContent === "1 approved",
    { timeout: 7000 },
  );
}

async function importApproved(review, browser) {
  const parolaTargetPromise = browser.waitForTarget(
    (target) => target.url().startsWith("https://guymichaely.com/parola/"),
    { timeout: 30_000 },
  );
  await review.click("#add-approved");
  const parolaTarget = await parolaTargetPromise;
  const parola = await parolaTarget.page();
  assert.ok(parola, "Parola import target should have a page");

  await review.waitForFunction(
    () => /Added 1 word to Parola/.test(document.querySelector("#import-status")?.textContent || ""),
    { timeout: 30_000 },
  );
  const importStatus = await review.$eval("#import-status", (element) => element.textContent || "");

  await parola.waitForFunction(
    () => {
      try {
        return JSON.parse(localStorage.getItem("parola:cards") || "[]").length > 0;
      } catch {
        return false;
      }
    },
    { timeout: 30_000 },
  );
  const cards = await parola.evaluate(() => JSON.parse(localStorage.getItem("parola:cards") || "[]"));
  return { parola, cards, importStatus };
}

let baseError = null;
try {
  await import("./organic-duolingo-e2e.mjs");
} catch (error) {
  baseError = error;
} finally {
  puppeteer.launch = originalLaunch;
}

try {
  if (baseError) throw baseError;
  assert.ok(capturedBrowser, "organic driver should expose its Chrome instance");

  const summary = JSON.parse(await readFile(summaryPath, "utf8"));
  assert.equal(summary.lessonCompleted, true, "organic lesson must complete before review/import testing");
  assert.equal(summary.completionReviewOpened, true, "organic completion must open a scoped review");

  const review = await waitForReview(capturedBrowser, summary.extensionId);
  const plan = await findPlan(review);
  await completeCard(review, plan);
  summary.reviewCardApproved = true;
  summary.approvedCard = {
    detected: plan.originalWord,
    italian: plan.italian,
    english: plan.english,
    type: plan.type,
  };
  await review.screenshot({ path: path.join(outputDir, "review-approved.png"), fullPage: true });

  const { parola, cards, importStatus } = await importApproved(review, capturedBrowser);
  const imported = cards.find((card) =>
    normalize(card.italian) === normalize(plan.italian)
    && String(card.english || "").toLocaleLowerCase() === plan.english.toLocaleLowerCase()
    && card.type === plan.type
  );
  assert.ok(imported, `Parola browser storage did not contain expected imported ${plan.type} card`);

  summary.importedToParola = true;
  summary.importStatus = importStatus;
  summary.importStorage = /\(browser storage\)/i.test(importStatus) ? "browser" : "unknown";
  summary.importedCard = imported;
  summary.parolaCardCount = cards.length;
  await parola.screenshot({ path: path.join(outputDir, "parola-after-import.png"), fullPage: false });
  await writeFile(summaryPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({
    organicLessonCompleted: summary.lessonCompleted,
    completionReviewOpened: summary.completionReviewOpened,
    reviewCardApproved: summary.reviewCardApproved,
    importedToParola: summary.importedToParola,
    importedCard: summary.importedCard,
  }));
} catch (error) {
  try {
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    summary.fullE2eError = `${error?.name || "Error"}: ${error?.message || String(error)}`;
    await writeFile(summaryPath, JSON.stringify(summary, null, 2));
  } catch {}
  throw error;
} finally {
  if (capturedBrowser && realClose) {
    try {
      await realClose();
    } catch {}
  }
}
