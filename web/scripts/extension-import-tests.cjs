const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const testDist = path.join(__dirname, "..", ".test-dist");
fs.mkdirSync(testDist, { recursive: true });
fs.writeFileSync(path.join(testDist, "package.json"), '{"type":"commonjs"}\n');

const {
  defaultNounMorphology,
  nounArticleProfiles,
} = require(path.join(testDist, "cards", "nounMorphology.js"));
const {
  extensionCandidatesToCards,
  parseExtensionImportRequest,
} = require(path.join(testDist, "extensionImport.js"));

function canonicalCard(overrides) {
  return {
    id: 0,
    type: "adverb",
    english: "very",
    italian: "molto",
    setName: null,
    tags: [],
    details: {},
    ...overrides,
  };
}

test("extension imports accept a current canonical noun card unchanged", () => {
  const input = canonicalCard({
    type: "noun",
    english: "mirror",
    italian: "specchio",
    details: {
      rule: "-chio → -chi",
      base: "spec",
      gender: "masculine",
      articleProfile: nounArticleProfiles.all,
    },
  });

  const [card] = extensionCandidatesToCards([input], defaultNounMorphology);
  assert.deepEqual(card, input);
});

test("extension imports reject the retired noun forms/details shape", () => {
  const legacy = canonicalCard({
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
  });

  assert.throws(
    () => extensionCandidatesToCards([legacy], defaultNounMorphology),
    /must contain exactly.*articleProfile.*base.*gender.*rule/i,
  );
});

test("extension imports reject the retired articleMode noun schema", () => {
  const retired = canonicalCard({
    type: "noun",
    english: "mirror",
    italian: "specchio",
    details: {
      rule: "-chio → -chi",
      base: "spec",
      gender: "masculine",
      articleMode: "automatic",
    },
  });

  assert.throws(
    () => extensionCandidatesToCards([retired], defaultNounMorphology),
    /must contain exactly.*articleProfile.*base.*gender.*rule/i,
  );
});

test("extension imports reject canonical nouns that disagree with active morphology", () => {
  const invalid = canonicalCard({
    type: "noun",
    english: "mirror",
    italian: "specchio",
    details: {
      rule: "-chio → -chi",
      base: "wrong",
      gender: "masculine",
      articleProfile: nounArticleProfiles.all,
    },
  });

  assert.throws(
    () => extensionCandidatesToCards([invalid], defaultNounMorphology),
    /canonical morphology produces/i,
  );
});

test("extension imports reject unknown card types", () => {
  const invalid = canonicalCard({ type: "pronoun", english: "it", italian: "esso" });
  assert.throws(
    () => extensionCandidatesToCards([invalid], defaultNounMorphology),
    /incomplete or invalid card/i,
  );
});

test("extension import request parsing accepts only the bridge envelope", () => {
  const request = parseExtensionImportRequest({
    source: "parola-capture-extension",
    type: "parola-extension-import",
    requestId: "request-1",
    candidates: [canonicalCard({})],
  });
  assert.equal(request?.requestId, "request-1");
  assert.equal(parseExtensionImportRequest({ source: "something-else", type: "parola-extension-import" }), null);
});
