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
} = require(path.join(testDist, "cards", "nounMorphology.js"));
const {
  analyzeNounInput,
  evaluateNounAnswer,
} = require(path.join(testDist, "study", "nounSyntax.js"));
const {
  analyzeAnswerSyntax,
} = require(path.join(testDist, "components", "AnswerParsePreview.js"));

const keywords = {
  masculine: "m",
  feminine: "f",
  singularOnly: "s",
  pluralOnly: "p",
};

function nounCard({
  english,
  italian,
  ruleId,
  base,
  gender = "masculine",
  numberMode = "both",
  articleMode = "automatic",
}) {
  return {
    id: 1,
    type: "noun",
    english,
    italian,
    setName: null,
    tags: [],
    details: { ruleId, base, gender, numberMode, articleMode },
  };
}

function morphologyWithLearnedRule(ruleId) {
  const morphology = cloneNounMorphology(defaultNounMorphology);
  const learned = morphology.inferenceSets.find((set) => set.id === "learned-shorthand");
  assert.ok(learned, "learned-shorthand inference set should exist");
  if (!learned.declensionRuleIds.includes(ruleId)) learned.declensionRuleIds.push(ruleId);
  return morphology;
}

test("ordinary -o/-i shorthand recognizes cetriolo", () => {
  const card = nounCard({ english: "cucumber", italian: "cetriolo", ruleId: "o-i", base: "cetriol" });
  const evaluation = evaluateNounAnswer(card, "il cetriolo", defaultNounMorphology, keywords);
  assert.equal(evaluation.result, "correct");
  assert.ok(evaluation.matchingCandidates.some((candidate) => candidate.declensionRuleId === "o-i" && candidate.definition.base === "cetriol"));
});

test("specchio shorthand is wrong until chio-chi is learned", () => {
  const card = nounCard({ english: "mirror", italian: "specchio", ruleId: "chio-chi", base: "spec" });
  const evaluation = evaluateNounAnswer(card, "lo specchio", defaultNounMorphology, keywords);
  assert.equal(evaluation.result, "wrong");
  assert.equal(evaluation.matchingCandidates.length, 0);
  assert.ok(evaluation.candidates.some((candidate) => candidate.declensionRuleId === "o-i" && candidate.definition.base === "specchi"));
  assert.equal(evaluation.candidates.some((candidate) => candidate.declensionRuleId === "chio-chi"), false);
});

test("adding chio-chi to learned shorthand makes lo specchio correct", () => {
  const morphology = morphologyWithLearnedRule("chio-chi");
  const card = nounCard({ english: "mirror", italian: "specchio", ruleId: "chio-chi", base: "spec" });
  const evaluation = evaluateNounAnswer(card, "lo specchio", morphology, keywords);
  assert.equal(evaluation.result, "correct");
  assert.ok(evaluation.matchingCandidates.some((candidate) => candidate.declensionRuleId === "chio-chi" && candidate.definition.base === "spec"));
});

test("gender shorthand shares the learned-shorthand policy", () => {
  const card = nounCard({ english: "mirror", italian: "specchio", ruleId: "chio-chi", base: "spec" });
  assert.equal(evaluateNounAnswer(card, "m specchio", defaultNounMorphology, keywords).result, "wrong");
  assert.equal(evaluateNounAnswer(card, "m specchio", morphologyWithLearnedRule("chio-chi"), keywords).result, "correct");
});

test("elided definite articles are split and normalized during recognition", () => {
  const card = nounCard({ english: "entrance", italian: "entrata", ruleId: "a-e", base: "entrat", gender: "feminine" });
  assert.equal(evaluateNounAnswer(card, "l'entrata", defaultNounMorphology, keywords).result, "correct");
  assert.equal(evaluateNounAnswer(card, "l’entrata", defaultNounMorphology, keywords).result, "correct");
});

test("ambiguous l' branches gender without consulting the target card", () => {
  const card = nounCard({ english: "tree", italian: "albero", ruleId: "o-i", base: "alber", gender: "masculine" });
  const evaluation = evaluateNounAnswer(card, "l'albero", defaultNounMorphology, keywords);
  assert.equal(evaluation.result, "correct");
  const genders = evaluation.candidates
    .filter((candidate) => candidate.syntaxRuleId === "article-singular" && candidate.declensionRuleId === "o-i")
    .map((candidate) => candidate.definition.gender)
    .sort();
  assert.deepEqual(genders, ["feminine", "masculine"]);
});

test("conflicting explicit gender and article evidence is invalid", () => {
  const card = nounCard({ english: "house", italian: "casa", ruleId: "a-e", base: "cas", gender: "feminine" });
  assert.equal(evaluateNounAnswer(card, "m la casa", defaultNounMorphology, keywords).result, "invalid");
});

test("pluralia tantum uses plural-base and has no inferred singular", () => {
  const card = nounCard({
    english: "clothes",
    italian: "vestiti",
    ruleId: "plural-base",
    base: "vestiti",
    numberMode: "plural",
  });
  const evaluation = evaluateNounAnswer(card, "p i vestiti", defaultNounMorphology, keywords);
  assert.equal(evaluation.result, "correct");
  assert.ok(evaluation.matchingCandidates.every((candidate) => candidate.definition.ruleId === "plural-base" && candidate.definition.base === "vestiti"));
});

test("singularia tantum uses singular-base and accepts marker order in either direction", () => {
  const card = nounCard({
    english: "Venice",
    italian: "Venezia",
    ruleId: "singular-base",
    base: "Venezia",
    gender: "feminine",
    numberMode: "singular",
    articleMode: "none",
  });
  assert.equal(evaluateNounAnswer(card, "f s Venezia", defaultNounMorphology, keywords).result, "correct");
  assert.equal(evaluateNounAnswer(card, "s f Venezia", defaultNounMorphology, keywords).result, "correct");
});

test("a structurally complete syntax with zero candidates is wrong, not invalid", () => {
  const morphology = cloneNounMorphology(defaultNounMorphology);
  const learned = morphology.inferenceSets.find((set) => set.id === "learned-shorthand");
  assert.ok(learned);
  learned.declensionRuleIds = [];
  const card = nounCard({ english: "cucumber", italian: "cetriolo", ruleId: "o-i", base: "cetriol" });
  const evaluation = evaluateNounAnswer(card, "il cetriolo", morphology, keywords);
  assert.equal(evaluation.result, "wrong");
  assert.ok(evaluation.attempts.some((attempt) => attempt.syntax.id === "article-singular" && attempt.status === "complete" && attempt.candidates.length === 0));
});

test("candidate ordering prefers the more specific suffix without discarding broader candidates", () => {
  const morphology = morphologyWithLearnedRule("chio-chi");
  const attempts = analyzeNounInput("lo specchio", morphology, keywords);
  const articleAttempt = attempts.find((attempt) => attempt.syntax.id === "article-singular");
  assert.ok(articleAttempt);
  assert.equal(articleAttempt.status, "complete");
  assert.equal(articleAttempt.candidates[0]?.declensionRuleId, "chio-chi");
  assert.ok(articleAttempt.candidates.some((candidate) => candidate.declensionRuleId === "o-i"));
});

test("live preview lists declensions only from the syntax it displays", () => {
  const morphology = cloneNounMorphology(defaultNounMorphology);
  const articleSyntax = morphology.syntaxRules.find((syntax) => syntax.id === "article-singular");
  assert.ok(articleSyntax);
  morphology.syntaxRules.splice(1, 0, {
    ...JSON.parse(JSON.stringify(articleSyntax)),
    id: "article-singular-full",
    name: "Article + singular (full inference)",
    inferenceSetId: "full-noun",
  });

  const card = nounCard({ english: "mirror", italian: "specchio", ruleId: "chio-chi", base: "spec" });
  const preview = analyzeAnswerSyntax(card, "lo specchio", keywords, morphology);
  assert.equal(preview.syntaxName, "Article + singular");
  assert.ok(preview.candidateNames.includes("-o → -i"));
  assert.equal(preview.candidateNames.includes("-chio → -chi"), false);
});
