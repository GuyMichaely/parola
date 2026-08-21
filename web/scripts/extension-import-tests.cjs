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

function canonicalNoun(overrides = {}) {
  return {
    id: 0,
    type: "noun",
    english: "mirror",
    setName: null,
    tags: [],
    details: {
      rule: "-chio → -chi",
      base: "spec",
      gender: "masculine",
      articleProfile: nounArticleProfiles.all,
    },
    ...overrides,
  };
}

test("extension imports accept a current canonical noun card unchanged", () => {
  const input = canonicalNoun();
  const [card] = extensionCandidatesToCards([input], defaultNounMorphology);
  assert.deepEqual(card, input);
});

test("extension imports reject a stored Italian field on nouns", () => {
  const retired = canonicalNoun({ italian: "specchio" });
  assert.throws(
    () => extensionCandidatesToCards([retired], defaultNounMorphology),
    /must not store a derived italian field/i,
  );
});

test("extension imports reject the retired noun forms/details shape", () => {
  const legacy = canonicalNoun({
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
  const retired = canonicalNoun({
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

test("extension imports reject noun article profiles unsupported by their declension", () => {
  const invalid = canonicalNoun({
    english: "clothes",
    details: {
      rule: "Plural form is the base",
      base: "vestiti",
      gender: "masculine",
      articleProfile: nounArticleProfiles.all,
    },
  });

  assert.throws(
    () => extensionCandidatesToCards([invalid], defaultNounMorphology),
    /requires a noun form/i,
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
