import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import puppeteer from "puppeteer";

const extensionRoot = path.resolve(process.cwd());
let bridgeServer = null;

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

  await popup.evaluate(() => chrome.storage.local.set({
    "parola-extension:duolingo-session-export": {
      version: 1,
      origin: "https://www.duolingo.com",
      exportedAt: "2026-08-18T00:00:00.000Z",
      sourceUrl: "https://www.duolingo.com/learn",
      cookies: [
        { name: "session-test", value: "abc", domain: ".duolingo.com", path: "/", secure: true, httpOnly: true, session: true },
        { name: "client-test", value: "xyz", domain: ".duolingo.com", path: "/", secure: true, httpOnly: false, session: true },
      ],
      localStorage: { alpha: "one" },
      sessionStorage: { beta: "two" },
    },
  }));
  const exportPage = await browser.newPage();
  await exportPage.goto(`chrome-extension://${extensionId}/session-export.html`);
  await exportPage.waitForFunction(() => document.querySelector("#download-session")?.disabled === false, { timeout: 5000 });
  const exportSummary = await exportPage.$eval("#export-summary", (el) => el.textContent);
  assert.match(exportSummary, /2\s*Duolingo cookies/);
  assert.match(exportSummary, /1\s*HttpOnly cookies/);
  assert.match(exportSummary, /2\s*Storage keys/);
  assert.match(await exportPage.$eval("#export-status", (el) => el.textContent), /Ready/);
  await exportPage.close();

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
  await review.waitForSelector('input[data-detail="femininePlural"]');
  await new Promise((resolve) => setTimeout(resolve, 250));
  await review.click('button[data-action="approve"]');
  await review.waitForFunction(() => document.querySelector("#approved-summary")?.textContent === "1 approved");

  const state = await review.evaluate(() => chrome.runtime.sendMessage({ type: "get-state" }));
  const reviewed = state.staged.find((item) => item.lessonId === "e2e-review-lesson");
  assert.equal(reviewed.word, "verde");
  assert.equal(reviewed.english, "green");
  assert.equal(reviewed.cardType, "adjective");
  assert.equal(reviewed.status, "approved");
  assert.deepEqual(reviewed.details, {
    masculineSingular: "verde",
    feminineSingular: "verde",
    masculinePlural: "verdi",
    femininePlural: "verdi",
  });

  await popup.evaluate(() => chrome.runtime.sendMessage({
    type: "detected-new-word",
    detection: {
      lessonId: "e2e-other-lesson",
      lessonStartedAt: new Date().toISOString(),
      word: "blu",
      context: "una camicia blu",
      url: "https://www.duolingo.com/lesson/other",
      evidence: { newWordMarker: true, highlightedText: true },
    },
  }));
  await review.evaluate(() => chrome.runtime.sendMessage({ type: "clear-staged", lessonId: "e2e-review-lesson" }));
  const afterScopedClear = await review.evaluate(() => chrome.runtime.sendMessage({ type: "get-state" }));
  assert.equal(afterScopedClear.staged.some((item) => item.lessonId === "e2e-review-lesson"), false);
  assert.equal(afterScopedClear.staged.some((item) => item.lessonId === "e2e-other-lesson"), true, "clearing one lesson should preserve other staged lessons");

  bridgeServer = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><body>Parola bridge fixture</body></html>");
  });
  await new Promise((resolve) => bridgeServer.listen(0, "127.0.0.1", resolve));
  const address = bridgeServer.address();
  assert.ok(address && typeof address === "object");

  const bridge = await browser.newPage();
  await bridge.goto(`http://127.0.0.1:${address.port}/`);
  await bridge.evaluate(() => {
    localStorage.clear();
    window.__parolaImportListener = null;
    window.chrome = {
      runtime: {
        onMessage: {
          addListener(listener) {
            window.__parolaImportListener = listener;
          },
        },
      },
    };
  });
  await bridge.addScriptTag({ path: path.join(extensionRoot, "content", "parola.js") });
  const imported = await bridge.evaluate(() => new Promise((resolve, reject) => {
    if (!window.__parolaImportListener) {
      reject(new Error("Parola bridge did not register a message listener"));
      return;
    }
    const card = {
      id: 0,
      type: "adjective",
      english: "green",
      italian: "verde",
      setName: null,
      tags: [],
      details: {
        masculineSingular: "verde",
        feminineSingular: "verde",
        masculinePlural: "verdi",
        femininePlural: "verdi",
      },
    };
    window.__parolaImportListener({ type: "import-parola-cards", cards: [card] }, {}, (response) => {
      resolve({
        response,
        stored: JSON.parse(localStorage.getItem("parola:cards") || "[]"),
      });
    });
  }));
  assert.equal(imported.response.ok, true);
  assert.equal(imported.response.storage, "browser");
  assert.equal(imported.stored.length, 1);
  assert.equal(imported.stored[0].id, 1);
  assert.equal(imported.stored[0].english, "green");
  assert.equal(imported.stored[0].italian, "verde");
  assert.equal(imported.stored[0].details.femininePlural, "verdi");

  console.log(`Extension ${extensionId} loaded; session export encoded, detector staged ${detection.word}, lesson completion was recognized, complete review metadata persisted, and a studyable card imported into Parola browser storage.`);
} finally {
  if (bridgeServer) await new Promise((resolve) => bridgeServer.close(resolve));
  await browser.close();
}
