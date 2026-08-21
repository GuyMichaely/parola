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
  italian,
  rule,
  base,
  gender = "masculine",
  articleMode = "automatic",
}) {
  return {
    id: 1,
    type: "noun",
    english,
    italian,
    setName: null,
    tags: [],
    details: { rule, base, gender, articleMode },
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
  const card = nounCard({ english: "cucumber", italian: "cetriolo", rule: rules.oI, base: "cetriol" });
  const evaluation = evaluateNounAnswer(card, "il cetriolo", defaultNounMorphology, keywords);
  assert.equal(evaluation.result, "correct");
  assert.ok(evaluation.matchingCandidates.some((candidate) => candidate.declensionRule === rules.oI && candidate.definition.base === "cetriol"));
});

test("specchio shorthand is wrong until -chio/-chi is learned", () => {
  const card = nounCard({ english: "mirror", italian: "specchio", rule: rules.chioChi, base: "spec" });
  const evaluation = evaluateNounAnswer(card, "lo specchio", defaultNounMorphology, keywords);
  assert.equal(evaluation.result, "wrong");
  assert.equal(evaluation.matchingCandidates.length, 0);
  assert.ok(evaluation.candidates.some((candidate) => candidate.declensionRule === rules.oI && candidate.definition.base === "specchi"));
  assert.equal(evaluation.candidates.some((candidate) => candidate.declensionRule === rules.chioChi), false);
});

test("adding -chio/-chi to learned shorthand makes lo specchio correct", () => {
  const morphology = morphologyWithLearnedRule(rules.chioChi);
  const card = nounCard({ english: "mirror", italian: "specchio", rule: rules.chioChi, base: "spec" });
  const evaluation = evaluateNounAnswer(card, "lo specchio", morphology, keywords);
  assert.equal(evaluation.result, "correct");
  assert.ok(evaluation.matchingCandidates.some((candidate) => candidate.declensionRule === rules.chioChi && candidate.definition.base === "spec"));
});

test("gender shorthand shares the learned-shorthand policy", () => {
  const card = nounCard({ english: "mirror", italian: "specchio", rule: rules.chioChi, base: "spec" });
  assert.equal(evaluateNounAnswer(card, "m specchio", defaultNounMorphology, keywords).result, "wrong");
  assert.equal(evaluateNounAnswer(card, "m specchio", morphologyWithLearnedRule(rules.chioChi), keywords).result, "correct");
});

test("elided definite articles are split and normalized during recognition", () => {
  const card = nounCard({ english: "entrance", italian: "entrata", rule: rules.aE, base: "entrat", gender: "feminine" });
  assert.equal(evaluateNounAnswer(card, "l'entrata", defaultNounMorphology, keywords).result, "correct");
  assert.equal(evaluateNounAnswer(card, "l’entrata", defaultNounMorphology, keywords).result, "correct");
});

test("ambiguous l' branches gender without consulting the target card", () => {
  const card = nounCard({ english: "tree", italian: "albero", rule: rules.oI, base: "alber", gender: "masculine" });
  const evaluation = evaluateNounAnswer(card, "l'albero", defaultNounMorphology, keywords);
  assert.equal(evaluation.result, "correct");
  const genders = evaluation.candidates
    .filter((candidate) => candidate.syntaxName === "Article + singular" && candidate.declensionRule === rules.oI)
    .map((candidate) => candidate.definition.gender)
    .sort();
  assert.deepEqual(genders, ["feminine", "masculine"]);
});

test("conflicting explicit gender and article evidence is invalid", () => {
  const card = nounCard({ english: "house", italian: "casa", rule: rules.aE, base: "cas", gender: "feminine" });
  assert.equal(evaluateNounAnswer(card, "m la casa", defaultNounMorphology, keywords).result, "invalid");
});

test("pluralia tantum derives plural-only behavior from its rule", () => {
  const card = nounCard({
    english: "clothes",
    italian: "vestiti",
    rule: rules.pluralBase,
    base: "vestiti",
  });
  const evaluation = evaluateNounAnswer(card, "p i vestiti", defaultNounMorphology, keywords);
  assert.equal(evaluation.result, "correct");
  assert.ok(evaluation.matchingCandidates.every((candidate) => candidate.definition.rule === rules.pluralBase && candidate.definition.base === "vestiti"));
});

test("singularia tantum derives singular-only behavior and accepts marker order either way", () => {
  const card = nounCard({
    english: "Venice",
    italian: "Venezia",
    rule: rules.singularBase,
    base: "Venezia",
    gender: "feminine",
    articleMode: "none",
  });
  assert.equal(evaluateNounAnswer(card, "f s Venezia", defaultNounMorphology, keywords).result, "correct");
  assert.equal(evaluateNounAnswer(card, "s f Venezia", defaultNounMorphology, keywords).result, "correct");
});

test("a structurally complete syntax with zero candidates is wrong, not invalid", () => {
  const morphology = cloneNounMorphology(defaultNounMorphology);
  const learned = morphology.inferenceSets.find((set) => set.name === "Learned shorthand");
  assert.ok(learned);
  learned.declensionRules = [];
  const card = nounCard({ english: "cucumber", italian: "cetriolo", rule: rules.oI, base: "cetriol" });
  const evaluation = evaluateNounAnswer(card, "il cetriolo", morphology, keywords);
  assert.equal(evaluation.result, "wrong");
  assert.ok(evaluation.attempts.some((attempt) => attempt.syntax.name === "Article + singular" && attempt.status === "complete" && attempt.candidates.length === 0));
});

test("candidate ordering prefers the more specific suffix without discarding broader candidates", () => {
  const morphology = morphologyWithLearnedRule(rules.chioChi);
  const attempts = analyzeNounInput("lo specchio", morphology, keywords);
  const articleAttempt = attempts.find((attempt) => attempt.syntax.name === "Article + singular");
  assert.ok(articleAttempt);
  assert.equal(articleAttempt.status, "complete");
  assert.equal(articleAttempt.candidates[0]?.declensionRule, rules.chioChi);
  assert.ok(articleAttempt.candidates.some((candidate) => candidate.declensionRule === rules.oI));
});

test("live preview lists declensions only from the syntax it displays", () => {
  const morphology = cloneNounMorphology(defaultNounMorphology);
  const articleSyntax = morphology.syntaxRules.find((syntax) => syntax.name === "Article + singular");
  assert.ok(articleSyntax);
  morphology.syntaxRules.splice(1, 0, {
    ...JSON.parse(JSON.stringify(articleSyntax)),
    name: "Article + singular (full inference)",
    inferenceSet: "Full noun answers",
  });

  const card = nounCard({ english: "mirror", italian: "specchio", rule: rules.chioChi, base: "spec" });
  const preview = analyzeAnswerSyntax(card, "lo specchio", keywords, morphology);
  assert.equal(preview.syntaxName, "Article + singular");
  assert.ok(preview.candidateNames.includes(rules.oI));
  assert.equal(preview.candidateNames.includes(rules.chioChi), false);
});
