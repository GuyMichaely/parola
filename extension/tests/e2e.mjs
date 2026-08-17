import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import puppeteer from "puppeteer-core";

const extensionRoot = path.resolve(process.cwd());
const chromePath = process.env.CHROME_PATH || "/usr/bin/google-chrome";

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: false,
  enableExtensions: [extensionRoot],
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const extensions = await browser.extensions();
  assert.ok(extensions.length >= 1, "extension should load in Chrome");
  const extension = extensions.find((item) => item.name === "Parola for Duolingo") || extensions[0];
  assert.ok(extension?.id, "extension id should be available");

  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extension.id}/popup.html`);
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

  console.log(`Extension ${extension.id} loaded; detector staged ${detection.word}.`);
} finally {
  await browser.close();
}
