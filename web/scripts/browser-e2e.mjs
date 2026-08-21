import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.PAROLA_E2E_URL || "http://127.0.0.1:4173/";

const morphology = {
  declensionRules: [
    {
      name: "-chio → -chi",
      forms: {
        singular: { suffix: "chio" },
        plural: { suffix: "chi" },
      },
    },
  ],
  inferenceSets: [
    { name: "All test rules", declensionRules: ["-chio → -chi"] },
  ],
  syntaxRules: [
    {
      name: "Definite singular article + noun",
      markers: [{ kind: "gender", required: false }],
      markerOrder: "any",
      fields: [
        { kind: "article", definiteness: "definite", number: "singular" },
        { kind: "noun", number: "singular" },
      ],
      inferenceSet: "All test rules",
    },
    {
      name: "Full declension",
      markers: [{ kind: "gender", required: false }],
      markerOrder: "any",
      fields: [
        { kind: "article", definiteness: "definite", number: "singular" },
        { kind: "noun", number: "singular" },
        { kind: "article", definiteness: "definite", number: "plural" },
        { kind: "noun", number: "plural" },
        { kind: "article", definiteness: "indefinite", number: "singular" },
      ],
      inferenceSet: "All test rules",
    },
  ],
};

const currentInventory = {
  cards: [
    {
      id: 59,
      type: "noun",
      english: "mirror",
      setName: null,
      tags: [],
      details: {
        rule: "-chio → -chi",
        base: "spec",
        gender: "masculine",
        articleProfile: {
          definiteSingular: true,
          definitePlural: true,
          indefiniteSingular: true,
        },
      },
    },
  ],
  nounMorphology: morphology,
};

const staleLocalSnapshot = {
  ...currentInventory,
  cards: currentInventory.cards.map((card) => ({ ...card, italian: "specchio" })),
  updatedAt: "2026-08-20T14:00:00.000Z",
};

let browser;
let page;

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.addInitScript((snapshot) => {
    const seedKey = "parola:e2e-stale-state-seeded";
    if (window.sessionStorage.getItem(seedKey)) return;
    window.localStorage.clear();
    window.localStorage.setItem("parola:inventory", JSON.stringify(snapshot));
    window.sessionStorage.setItem(seedKey, "1");
  }, staleLocalSnapshot);

  await page.goto(baseUrl, { waitUntil: "networkidle" });

  const storageWarning = page.getByText(/Storage unavailable: Noun card 59 must not store a derived italian field\./i);
  await storageWarning.waitFor({ state: "visible" });

  await page.getByRole("button", { name: "Local" }).click();
  await page.getByLabel("Import inventory JSON").fill(JSON.stringify(currentInventory));

  page.once("dialog", async (dialog) => {
    assert.match(dialog.message(), /Replace the current inventory with the 1-card inventory/i);
    await dialog.accept();
  });

  const navigation = page.waitForNavigation({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Import pasted JSON" }).click();
  await navigation;

  await page.getByRole("heading", { name: "mirror" }).waitFor({ state: "visible" });
  assert.equal(await page.getByText("English · Noun", { exact: true }).count(), 1);

  const persisted = await page.evaluate(() => JSON.parse(window.localStorage.getItem("parola:inventory") || "null"));
  assert.ok(persisted, "Imported inventory should be persisted to localStorage.");
  assert.equal(persisted.cards.length, 1);
  assert.equal(persisted.cards[0].english, "mirror");
  assert.equal(Object.prototype.hasOwnProperty.call(persisted.cards[0], "italian"), false);

  await page.getByRole("checkbox", { name: /Type to verify/i }).check();
  await page.getByText("English prompt · Noun", { exact: true }).waitFor({ state: "visible" });

  const answer = page.getByRole("textbox", { name: "Answer" });
  await answer.fill("lo");
  const articleGender = page.locator(".answer-parse-piece").filter({ hasText: "Gender from article" });
  await articleGender.waitFor({ state: "visible" });
  assert.match(await articleGender.textContent(), /masculine/i);

  await answer.fill("lo specchio");
  const stillNeeded = page.locator(".answer-parse-message").filter({ hasText: "Still needed:" });
  await stillNeeded.waitFor({ state: "visible" });
  assert.match(await stillNeeded.textContent(), /Definite plural article/i);
  assert.match(await stillNeeded.textContent(), /Plural noun/i);
  assert.match(await stillNeeded.textContent(), /Indefinite article/i);

  await answer.fill("lo specchio gli specchi uno");
  await page.getByRole("button", { name: "Check answer" }).click();
  await page.getByRole("status").filter({ hasText: "Correct" }).waitFor({ state: "visible" });

  assert.deepEqual(pageErrors, [], `Unexpected page errors: ${pageErrors.map(String).join("\n")}`);
  console.log("Browser E2E passed: stale inventory replacement, noun prompt metadata, lo gender evidence, and full-declension verification.");
} catch (error) {
  await mkdir("test-results", { recursive: true });
  if (page) {
    await page.screenshot({ path: "test-results/browser-e2e.png", fullPage: true }).catch(() => {});
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
