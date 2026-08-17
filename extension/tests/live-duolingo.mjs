import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer";

const email = process.env.DUOLINGO_TEST_EMAIL;
const password = process.env.DUOLINGO_TEST_PASSWORD;
if (!email || !password) throw new Error("DUOLINGO_TEST_EMAIL and DUOLINGO_TEST_PASSWORD are required.");

const extensionRoot = path.resolve(process.cwd());
const outputDir = path.resolve(process.env.DUOLINGO_CAPTURE_DIR || "live-capture");
await mkdir(outputDir, { recursive: true });

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

async function capture(page, name) {
  await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true });
  await writeFile(path.join(outputDir, `${name}.html`), await page.content(), "utf8");
  await writeFile(
    path.join(outputDir, `${name}.json`),
    JSON.stringify({ url: page.url(), title: await page.title() }, null, 2),
    "utf8",
  );
}

try {
  const extensionTarget = await browser.waitForTarget(
    (target) => target.type() === "service_worker" && target.url().startsWith("chrome-extension://"),
    { timeout: 10000 },
  );
  const extensionId = new URL(extensionTarget.url()).host;
  assert.ok(extensionId, "extension did not load");

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto("https://www.duolingo.com/log-in", { waitUntil: "domcontentloaded", timeout: 60000 });
  await capture(page, "01-login-page");

  const passwordInput = await page.waitForSelector('input[type="password"]', { visible: true, timeout: 30000 });
  const identityInput = await page.$('input[type="email"]') || await page.$('input[name*="email" i]') || await page.$('input[name*="username" i]') || await page.$('input[type="text"]');
  if (!identityInput) throw new Error("Could not find the Duolingo account field.");

  await identityInput.click({ clickCount: 3 });
  await identityInput.type(email, { delay: 10 });
  await passwordInput.click({ clickCount: 3 });
  await passwordInput.type(password, { delay: 10 });
  await passwordInput.press("Enter");

  await Promise.race([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
    new Promise((resolve) => setTimeout(resolve, 8000)),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await capture(page, "02-after-login");

  const stillHasPassword = Boolean(await page.$('input[type="password"]'));
  const bodyText = await page.evaluate(() => document.body?.innerText || "");
  const challengeText = /captcha|verify you are human|security check/i.test(bodyText);

  await writeFile(
    path.join(outputDir, "summary.json"),
    JSON.stringify({
      extensionId,
      finalUrl: page.url(),
      title: await page.title(),
      loginFormStillPresent: stillHasPassword,
      possibleAntiBotChallenge: challengeText,
    }, null, 2),
    "utf8",
  );

  console.log(`Live capture complete at ${page.url()}; extension ${extensionId}.`);
  if (challengeText) console.log("Duolingo appears to have presented an anti-bot/security challenge; artifact capture was preserved for inspection.");
} finally {
  await browser.close();
}
