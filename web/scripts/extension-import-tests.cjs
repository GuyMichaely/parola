const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const testDist = path.join(__dirname, "..", ".test-dist");
const {
  defaultNounMorphology,
} = require(path.join(testDist, "cards", "nounMorphology.js"));
const {
  extensionCandidatesToCards,
  normalizeExtensionImportCandidate,
  parseExtensionImportRequest,
} = require(path.join(testDist, "extensionImport.js"));

test("extension noun candidates are canonicalized through current noun morphology", () => {
  const [card] = extensionCandidatesToCards([{
    type: "noun",
    english: "mirror",
    italian: "specchio",
    details: {
      gender: "masculine",
      singular: "specchio",
      plural: "specchi",
      definiteSingularArticle: "lo",
      definitePluralArticle: "gli",
      indefiniteArticle: "uno",
    },
  }], defaultNounMorphology);

  assert.equal(card.type, "noun");
  assert.equal(card.italian, "specchio");
  assert.deepEqual(card.details, {
    ruleId: "chio-chi",
    base: "spec",
    gender: "masculine",
    numberMode: "both",
    articleMode: "automatic",
  });
});

test("extension plural-only noun candidates can resolve to plural-base", () => {
  const [card] = extensionCandidatesToCards([{
    type: "noun",
    english: "clothes",
    italian: "vestiti",
    details: {
      gender: "masculine",
      singular: "",
      plural: "vestiti",
      definiteSingularArticle: "",
      definitePluralArticle: "",
      indefiniteArticle: "",
    },
  }], defaultNounMorphology);

  assert.deepEqual(card.details, {
    ruleId: "plural-base",
    base: "vestiti",
    gender: "masculine",
    numberMode: "plural",
    articleMode: "none",
  });
});

test("extension candidates for other parts of speech use the current card model", () => {
  const cards = extensionCandidatesToCards([
    { type: "adverb", english: "very", italian: "molto", details: { form: "molto" } },
    {
      type: "verb",
      english: "to speak",
      italian: "parlare",
      details: {
        infinitive: "parlare",
        io: "parlo",
        tu: "parli",
        luiLei: "parla",
        noi: "parliamo",
        voi: "parlate",
        loro: "parlano",
        auxiliary: "avere",
        participle: "parlato",
      },
    },
  ], defaultNounMorphology);

  assert.equal(cards[0].type, "adverb");
  assert.equal(cards[0].italian, "molto");
  assert.equal(cards[1].type, "verb");
  assert.equal(cards[1].details.participle, "parlato");
});

test("extension import request parsing accepts only the current bridge protocol", () => {
  const request = parseExtensionImportRequest({
    source: "parola-capture-extension",
    type: "parola-extension-import",
    requestId: "request-1",
    candidates: [{ type: "adverb", english: "very", italian: "molto", details: {} }],
  });
  assert.equal(request?.requestId, "request-1");
  assert.equal(parseExtensionImportRequest({ source: "something-else", type: "parola-extension-import" }), null);
});

test("invalid candidate types are rejected", () => {
  assert.throws(() => normalizeExtensionImportCandidate({ type: "pronoun", english: "it", italian: "esso" }), /invalid part of speech/i);
});
