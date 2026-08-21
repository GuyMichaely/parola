const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const testDist = path.join(__dirname, "..", ".test-dist");
fs.mkdirSync(testDist, { recursive: true });
fs.writeFileSync(path.join(testDist, "package.json"), '{"type":"commonjs"}\n');

const {
  cloneNounMorphology,
  defaultNounMorphology,
  normalizeNounMorphology,
  nounArticleProfiles,
  resolvedNounForms,
  ruleNumberMode,
} = require(path.join(testDist, "cards", "nounMorphology.js"));
const {
  analyzeNounInput,
  evaluateNounAnswer,
} = require(path.join(testDist, "study", "nounSyntax.js"));
const {
  analyzeAnswerSyntax,
} = require(path.join(testDist, "components", "AnswerParsePreview.js"));

const rules = {
  singularBase: "Singular form is the base",
  pluralBase: "Plural form is the base",
  identity: "Unchanged singular / plural",
  oI: "-o → -i",
  aE: "-a → -e",
  chioChi: "-chio → -chi",
};

const keywords = {
  masculine: "m",
  feminine: "f",
  singularOnly: "s",
  pluralOnly: "p",
};

function nounCard({
  english,
  rule,
  base,
  gender = "masculine",
  articleProfile = nounArticleProfiles.all,
}) {
  return {
    id: 1,
    type: "noun",
    english,
    setName: null,
    tags: [],
    details: { rule, base, gender, articleProfile },
  };
}

function morphologyWithLearnedRule(ruleName) {
  const morphology = cloneNounMorphology(defaultNounMorphology);
  const learned = morphology.inferenceSets.find((set) => set.name === "Learned shorthand");
  assert.ok(learned, "Learned shorthand inference set should exist");
  if (!learned.declensionRules.includes(ruleName)) learned.declensionRules.push(ruleName);
  return morphology;
}

test("declension forms determine number behavior", () => {
  const byName = new Map(defaultNounMorphology.declensionRules.map((rule) => [rule.name, rule]));
  assert.equal(ruleNumberMode(byName.get(rules.oI)), "both");
  assert.equal(ruleNumberMode(byName.get(rules.singularBase)), "singular");
  assert.equal(ruleNumberMode(byName.get(rules.pluralBase)), "plural");
});

test("ordinary -o/-i shorthand recognizes cetriolo", () => {
  const card = nounCard({ english: "cucumber", rule: rules.oI, base: "cetriol" });
  const evaluation = evaluateNounAnswer(card, "il cetriolo", defaultNounMorphology, keywords);
  assert.equal(evaluation.result, "correct");
  assert.ok(evaluation.matchingCandidates.some((candidate) => candidate.declensionRule === rules.oI && candidate.definition.base === "cetriol"));
});

test("lo-class nouns require full declension even when their rule is learned", () => {
  const morphology = morphologyWithLearnedRule(rules.chioChi);
  const card = nounCard({ english: "mirror", rule: rules.chioChi, base: "spec" });
  assert.equal(evaluateNounAnswer(card, "lo specchio", defaultNounMorphology, keywords).result, "wrong");
  assert.equal(evaluateNounAnswer(card, "lo specchio", morphology, keywords).result, "wrong");
  assert.equal(evaluateNounAnswer(card, "lo specchio gli specchi uno", morphology, keywords).result, "correct");
});

test("lo full-declension policy also applies to ordinary learned declensions", () => {
  const card = nounCard({ english: "backpack", rule: rules.oI, base: "zain" });
  assert.equal(evaluateNounAnswer(card, "lo zaino", defaultNounMorphology, keywords).result, "wrong");
  assert.equal(evaluateNounAnswer(card, "lo zaino gli zaini uno", defaultNounMorphology, keywords).result, "correct");
});

test("parser exposes masculine gender supplied by lo while full declension is still incomplete", () => {
  const card = nounCard({ english: "backpack", rule: rules.oI, base: "zain" });
  const preview = analyzeAnswerSyntax(card, "lo zaino", keywords, defaultNounMorphology);
  assert.equal(preview.syntaxName, "Full declension");
  assert.equal(preview.status, "partial");
  assert.ok(preview.pieces.some((piece) => piece.label === "Gender from article" && piece.value === "masculine"));
});

test("article-taking shorthand requires an article", () => {
  const morphology = morphologyWithLearnedRule(rules.chioChi);
  const card = nounCard({ english: "mirror", rule: rules.chioChi, base: "spec" });
  assert.equal(evaluateNounAnswer(card, "m specchio", morphology, keywords).result, "invalid");
});

test("elided definite article requires an explicit gender when the article is ambiguous", () => {
  const card = nounCard({ english: "tree", rule: rules.oI, base: "alber", gender: "masculine" });
  assert.equal(evaluateNounAnswer(card, "l'albero", defaultNounMorphology, keywords).result, "invalid");
  assert.equal(evaluateNounAnswer(card, "l’albero", defaultNounMorphology, keywords).result, "invalid");
  assert.equal(evaluateNounAnswer(card, "m l'albero", defaultNounMorphology, keywords).result, "correct");
});

test("conflicting explicit gender and article evidence is invalid", () => {
  const card = nounCard({ english: "house", rule: rules.aE, base: "cas", gender: "feminine" });
  assert.equal(evaluateNounAnswer(card, "m la casa", defaultNounMorphology, keywords).result, "invalid");
});

test("article capability constraints do not require an exact profile match", () => {
  const all = nounCard({ english: "book", rule: rules.oI, base: "libr", articleProfile: nounArticleProfiles.all });
  assert.equal(evaluateNounAnswer(all, "il libro", defaultNounMorphology, keywords).result, "correct");
  assert.equal(evaluateNounAnswer(all, "i libri", defaultNounMorphology, keywords).result, "correct");
  assert.equal(evaluateNounAnswer(all, "un libro", defaultNounMorphology, keywords).result, "correct");

  const definiteSingularOnly = nounCard({ english: "book", rule: rules.oI, base: "libr", articleProfile: nounArticleProfiles.definiteSingularOnly });
  assert.equal(evaluateNounAnswer(definiteSingularOnly, "il libro", defaultNounMorphology, keywords).result, "correct");
  assert.equal(evaluateNounAnswer(definiteSingularOnly, "i libri", defaultNounMorphology, keywords).result, "wrong");
  assert.equal(evaluateNounAnswer(definiteSingularOnly, "un libro", defaultNounMorphology, keywords).result, "wrong");
});

test("article profile is independent from whether a declension has plural forms", () => {
  const card = nounCard({ english: "book", rule: rules.oI, base: "libr", articleProfile: nounArticleProfiles.definiteSingularOnly });
  const forms = resolvedNounForms(card, defaultNounMorphology);
  assert.equal(forms.singular, "libro");
  assert.equal(forms.plural, "libri");
  assert.equal(forms.definiteSingularArticle, "il");
  assert.equal(forms.definitePluralArticle, "");
  assert.equal(forms.indefiniteArticle, "");
});

test("singular-only and plural-only article nouns use ordinary article shorthand", () => {
  const morphology = morphologyWithLearnedRule(rules.singularBase);
  const learned = morphology.inferenceSets.find((set) => set.name === "Learned shorthand");
  assert.ok(learned);
  if (!learned.declensionRules.includes(rules.pluralBase)) learned.declensionRules.push(rules.pluralBase);

  const burro = nounCard({ english: "butter", rule: rules.singularBase, base: "burro", articleProfile: nounArticleProfiles.definiteSingularOnly });
  assert.equal(evaluateNounAnswer(burro, "il burro", morphology, keywords).result, "correct");

  const nozze = nounCard({ english: "wedding", rule: rules.pluralBase, base: "nozze", gender: "feminine", articleProfile: nounArticleProfiles.definitePluralOnly });
  assert.equal(evaluateNounAnswer(nozze, "le nozze", morphology, keywords).result, "correct");
});

test("articleless nouns require explicit gender and plurality", () => {
  const card = nounCard({
    english: "Venice",
    rule: rules.singularBase,
    base: "Venezia",
    gender: "feminine",
    articleProfile: nounArticleProfiles.none,
  });
  assert.equal(evaluateNounAnswer(card, "f s Venezia", defaultNounMorphology, keywords).result, "correct");
  assert.equal(evaluateNounAnswer(card, "s f Venezia", defaultNounMorphology, keywords).result, "correct");
  assert.equal(evaluateNounAnswer(card, "f Venezia", defaultNounMorphology, keywords).result, "invalid");
  assert.equal(evaluateNounAnswer(card, "la Venezia", morphologyWithLearnedRule(rules.singularBase), keywords).result, "wrong");
});

test("a structurally complete syntax with zero candidates is wrong, not invalid", () => {
  const morphology = cloneNounMorphology(defaultNounMorphology);
  const learned = morphology.inferenceSets.find((set) => set.name === "Learned shorthand");
  assert.ok(learned);
  learned.declensionRules = [];
  const card = nounCard({ english: "cucumber", rule: rules.oI, base: "cetriol" });
  const evaluation = evaluateNounAnswer(card, "il cetriolo", morphology, keywords);
  assert.equal(evaluation.result, "wrong");
  assert.ok(evaluation.attempts.some((attempt) => attempt.syntax.name === "Definite singular article + noun" && attempt.status === "complete" && attempt.candidates.length === 0));
});

test("candidate ordering prefers a specific suffix over a base-only rule", () => {
  const attempts = analyzeNounInput("la casa", defaultNounMorphology, keywords);
  const articleAttempt = attempts.find((attempt) => attempt.syntax.name === "Definite singular article + noun");
  assert.ok(articleAttempt);
  assert.equal(articleAttempt.status, "complete");
  assert.equal(articleAttempt.candidates[0]?.declensionRule, rules.aE);
  assert.ok(articleAttempt.candidates.some((candidate) => candidate.declensionRule === rules.singularBase));
});

test("live preview lists declensions only from the syntax it displays", () => {
  const morphology = cloneNounMorphology(defaultNounMorphology);
  const articleSyntax = morphology.syntaxRules.find((syntax) => syntax.name === "Definite singular article + noun");
  assert.ok(articleSyntax);
  morphology.syntaxRules.splice(1, 0, {
    ...JSON.parse(JSON.stringify(articleSyntax)),
    name: "Definite singular article + noun (full inference)",
    inferenceSet: "Full noun answers",
  });

  const card = nounCard({ english: "house", rule: rules.aE, base: "cas", gender: "feminine" });
  const preview = analyzeAnswerSyntax(card, "la casa", keywords, morphology);
  assert.equal(preview.syntaxName, "Definite singular article + noun");
  assert.ok(preview.candidateNames.includes(rules.aE));
  assert.equal(preview.candidateNames.includes(rules.chioChi), false);
});

test("morphology schema rejects retired syntax article and number properties", () => {
  const retired = cloneNounMorphology(defaultNounMorphology);
  retired.syntaxRules[0].articleMode = "automatic";
  retired.syntaxRules[0].numberMode = "both";
  assert.throws(() => normalizeNounMorphology(retired), /must contain exactly/i);
});
