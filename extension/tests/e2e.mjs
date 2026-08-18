import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer";

const extensionRoot = path.resolve(process.cwd());

const browser = await puppeteer.launch({
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

try {
  const extensionTarget = await browser.waitForTarget(
    (target) => target.type() === "service_worker" && target.url().startsWith("chrome-extension://"),
    { timeout: 10000 },
  );
  const extensionId = new URL(extensionTarget.url()).host;
  assert.ok(extensionId, "extension id should be available from the service worker");

  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  assert.match(await popup.title(), /Parola/i);
  assert.equal(await popup.$eval("#staged-count", (el) => el.textContent), "0");

  const fixture = await readFile(path.join(extensionRoot, "tests", "fixture.html"), "utf8");
  const page = await browser.newPage();
  await page.setContent(fixture);
  await page.evaluate(() => {
    window.__parolaMessages = [];
    window.chrome = {
      runtime: {
        sendMessage(message) {
          window.__parolaMessages.push(message);
          return Promise.resolve({ stagedCount: 1 });
        },
        onMessage: { addListener() {} },
      },
    };
  });
  await page.addScriptTag({ path: path.join(extensionRoot, "content", "duolingo.js") });
  await page.waitForFunction(() => window.__parolaMessages.some((message) => message.type === "detected-new-word"), { timeout: 5000 });
  const messages = await page.evaluate(() => window.__parolaMessages);
  const detection = messages.find((message) => message.type === "detected-new-word")?.detection;
  assert.ok(detection, "fixture should produce a new-word detection");
  assert.equal(detection.word, "verde");
  assert.match(detection.context, /verde/);
  assert.equal(detection.evidence.newWordMarker, true);
  assert.equal(detection.evidence.highlightedText, true);
  assert.ok(detection.lessonId, "detected words should be scoped to a lesson session");

  await page.evaluate(() => {
    const heading = document.createElement("h2");
    heading.textContent = "Lesson complete!";
    document.querySelector("main")?.appendChild(heading);
  });
  await page.waitForFunction(() => window.__parolaMessages.some((message) => message.type === "lesson-complete"), { timeout: 5000 });
  const completion = (await page.evaluate(() => window.__parolaMessages)).find((message) => message.type === "lesson-complete");
  assert.equal(completion.lessonId, detection.lessonId, "completion should close the same lesson session that staged the word");

  const seeded = await popup.evaluate(() => chrome.runtime.sendMessage({
    type: "detected-new-word",
    detection: {
      lessonId: "e2e-review-lesson",
      lessonStartedAt: new Date().toISOString(),
      word: "verde",
      context: "la gonna verde",
      url: "https://www.duolingo.com/lesson/e2e",
      evidence: { newWordMarker: true, highlightedText: true },
    },
  }));
  assert.equal(seeded.lessonId, "e2e-review-lesson");

  const review = await browser.newPage();
  await review.goto(`chrome-extension://${extensionId}/review.html?lesson=e2e-review-lesson`);
  await review.waitForSelector('[data-id] input[data-field="word"]');
  assert.equal(await review.$eval('input[data-field="word"]', (el) => el.value), "verde");

  await review.$eval('input[data-field="english"]', (el) => {
    el.value = "green";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await review.select('select[data-field="cardType"]', "adjective");
  await new Promise((resolve) => setTimeout(resolve, 250));
  await review.click('button[data-action="approve"]');
  await review.waitForFunction(() => document.querySelector("#approved-summary")?.textContent === "1 approved");

  const state = await review.evaluate(() => chrome.runtime.sendMessage({ type: "get-state" }));
  const reviewed = state.staged.find((item) => item.lessonId === "e2e-review-lesson");
  assert.equal(reviewed.word, "verde");
  assert.equal(reviewed.english, "green");
  assert.equal(reviewed.cardType, "adjective");
  assert.equal(reviewed.status, "approved");

  console.log(`Extension ${extensionId} loaded; detector staged ${detection.word}, recognized lesson completion, and persisted editable review metadata.`);
} finally {
  await browser.close();
}
