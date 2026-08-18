import assert from "node:assert/strict";
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

  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  assert.match(await popup.title(), /Parola Capture/i);
  assert.equal(await popup.$eval("#staged-count", (element) => element.textContent), "0");

  await popup.type("#capture-input", "gatto");
  await popup.click('#capture-form button[type="submit"]');
  await popup.waitForFunction(() => document.querySelector("#staged-count")?.textContent === "1");

  await popup.type("#capture-input", "Vorrei un *panino*, per favore.");
  await popup.click('#capture-form button[type="submit"]');
  await popup.waitForFunction(() => document.querySelector("#staged-count")?.textContent === "2");

  const selected = await popup.evaluate(() => chrome.runtime.sendMessage({
    type: "stage-selection",
    selectionText: "pollo",
    sourceUrl: "https://example.test/lesson",
  }));
  assert.equal(selected.word, "pollo");

  const invalid = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "stage-input", input: "due parole" }));
  assert.match(invalid.error, /asterisks/i);

  const state = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "get-state" }));
  assert.deepEqual(state.staged.map((item) => item.word), ["gatto", "panino", "pollo"]);
  assert.deepEqual(state.staged[1].contexts, ["Vorrei un panino, per favore."]);
  assert.equal(state.staged[2].sourceUrl, "https://example.test/lesson");
  assert.ok(state.staged.every((item) => item.createdAt && item.updatedAt));
  assert.ok(Array.isArray(state.events));

  const debug = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "get-debug-bundle" }));
  assert.equal(debug.formatVersion, 2);
  assert.equal(debug.staged.length, 3);
  assert.ok(debug.events.some((event) => event.type === "capture-staged" && event.word === "panino"));
  assert.ok(debug.events.some((event) => event.type === "error" && event.operation === "stage-input"));

  const review = await browser.newPage();
  await review.goto(`chrome-extension://${extensionId}/review.html`);
  await review.waitForSelector('.staged-card[data-id] input[data-field="word"]');
  const reviewText = await review.$eval("body", (element) => element.textContent || "");
  assert.match(reviewText, /Italian/);
  assert.match(reviewText, /Context:/);
  const gattoId = await review.$eval('.staged-card[data-id] input[data-field="word"]', (input) => input.closest(".staged-card").dataset.id);
  const gattoCard = `.staged-card[data-id="${gattoId}"]`;
  const italianSelector = `${gattoCard} input[data-field="word"]`;
  const englishSelector = `${gattoCard} input[data-field="english"]`;
  const typeSelector = `${gattoCard} select[data-field="cardType"]`;

  await review.focus(italianSelector);
  await review.keyboard.down("Control");
  await review.keyboard.press("A");
  await review.keyboard.up("Control");
  await review.keyboard.type("gattino");
  await review.keyboard.press("Tab");
  await review.waitForFunction(
    (selector) => document.activeElement === document.querySelector(selector),
    { timeout: 5000 },
    englishSelector,
  );

  await review.keyboard.type("cat");
  await review.keyboard.press("Tab");
  await review.waitForFunction(
    (selector) => document.activeElement === document.querySelector(selector),
    { timeout: 5000 },
    typeSelector,
  );

  await review.select(typeSelector, "noun");
  await review.waitForSelector(`${gattoCard} select[data-detail="gender"]`);
  await review.keyboard.press("Tab");
  await review.waitForFunction(
    (selector) => document.activeElement === document.querySelector(selector),
    { timeout: 5000 },
    `${gattoCard} select[data-detail="gender"]`,
  );

  await review.select(`${gattoCard} select[data-detail="gender"]`, "masculine");
  await new Promise((resolve) => setTimeout(resolve, 300));
  await review.click(`${gattoCard} button[data-action="approve"]`);
  await review.waitForFunction(
    (id) => document.querySelector(`.staged-card[data-id="${id}"]`)?.classList.contains("approved"),
    { timeout: 5000 },
    gattoId,
  );

  const reviewedState = await review.evaluate(() => chrome.runtime.sendMessage({ type: "get-state" }));
  const gatto = reviewedState.staged.find((item) => item.id === gattoId);
  assert.equal(gatto.word, "gattino");
  assert.equal(gatto.english, "cat");
  assert.equal(gatto.cardType, "noun");
  assert.equal(gatto.details.gender, "masculine");
  assert.equal(gatto.status, "approved");
  assert.ok(reviewedState.events.some((event) => event.type === "review-update" && event.stagedId === gattoId));
  assert.ok(reviewedState.events.some((event) => event.type === "review-status" && event.stagedId === gattoId));

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
    if (!window.__parolaImportListener) return reject(new Error("Parola bridge did not register a message listener"));
    const card = {
      id: 0,
      type: "noun",
      english: "cat",
      italian: "gatto",
      setName: null,
      tags: [],
      details: { gender: "masculine", singular: "gatto", plural: "gatti" },
    };
    window.__parolaImportListener({ type: "import-parola-cards", cards: [card] }, {}, (response) => {
      resolve({ response, stored: JSON.parse(localStorage.getItem("parola:cards") || "[]") });
    });
  }));
  assert.equal(imported.response.ok, true);
  assert.equal(imported.response.storage, "browser");
  assert.equal(imported.stored.length, 1);
  assert.equal(imported.stored[0].italian, "gatto");

  console.log(`Extension ${extensionId} loaded; capture, staging, review focus/state, debug events, and the Parola browser-storage bridge passed deterministic tests.`);
} finally {
  if (bridgeServer) await new Promise((resolve) => bridgeServer.close(resolve));
  await browser.close();
}
