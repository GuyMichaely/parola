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
  await page.waitForFunction(() => window.__parolaMessages.length > 0, { timeout: 5000 });
  const messages = await page.evaluate(() => window.__parolaMessages);
  const detection = messages.find((message) => message.type === "detected-new-word")?.detection;
  assert.ok(detection, "fixture should produce a new-word detection");
  assert.equal(detection.word, "verde");
  assert.match(detection.context, /verde/);
  assert.equal(detection.evidence.newWordMarker, true);
  assert.equal(detection.evidence.highlightedText, true);

  console.log(`Extension ${extensionId} loaded; detector staged ${detection.word}.`);
} finally {
  await browser.close();
}
