import type { Flashcard } from "../cards/types";
import {
  generateNounForm,
  nounDefinitionForCard,
  nounDefinitionMatches,
  recognizeNounForm,
  ruleSupportsNumberMode,
  suggestedNounArticles,
  type NounDefinition,
  type NounGender,
  type NounMorphology,
  type NounSyntaxField,
  type NounSyntaxRule,
} from "../cards/nounMorphology";
import type { AnswerKeywords } from "../components/StudyOptions";

export type NounSyntaxAttemptStatus = "not-applicable" | "partial" | "complete";

export type NounSyntaxPiece = {
  label: string;
  value: string;
};

export type NounSyntaxCandidate = {
  syntaxRuleId: string;
  syntaxName: string;
  declensionRuleId: string;
  declensionRuleName: string;
  definition: NounDefinition;
};

export type NounSyntaxAttempt = {
  syntax: NounSyntaxRule;
  status: NounSyntaxAttemptStatus;
  pieces: NounSyntaxPiece[];
  missing: string[];
  candidates: NounSyntaxCandidate[];
  consumedTokens: number;
  reason: string;
};

export type NounAnswerEvaluation = {
  result: "correct" | "wrong" | "invalid";
  attempts: NounSyntaxAttempt[];
  candidates: NounSyntaxCandidate[];
  matchingCandidates: NounSyntaxCandidate[];
};

function normalize(value: string) {
  return value.normalize("NFC").trim().toLocaleLowerCase("it-IT").replace(/[’`]/g, "'").replace(/\s+/g, " ");
}

function keywordMatches(value: string, configured: string) {
  return normalize(value) === normalize(configured);
}

function tokenize(value: string) {
  return (value.normalize("NFC").match(/"[^"]*"|\S+/g) ?? []).map((part) => {
    const unquoted = part.startsWith('"') && part.endsWith('"') ? part.slice(1, -1) : part;
    return unquoted === "-" || unquoted === "—" ? "" : unquoted;
  });
}

function expandElidedArticleTokens(parts: string[]) {
  return parts.flatMap((part) => {
    const match = part.match(/^(l['’]|un['’])(.+)$/i);
    return match ? [match[1], match[2]] : [part];
  });
}

function genderMarker(value: string, keywords: AnswerKeywords): NounGender | null {
  if (keywordMatches(value, keywords.masculine)) return "masculine";
  if (keywordMatches(value, keywords.feminine)) return "feminine";
  return null;
}

function tantumMarker(value: string, keywords: AnswerKeywords): "singular" | "plural" | null {
  if (keywordMatches(value, keywords.singularOnly)) return "singular";
  if (keywordMatches(value, keywords.pluralOnly)) return "plural";
  return null;
}

function articleFacts(value: string) {
  const article = normalize(value);
  if (["il", "lo"].includes(article)) return { definiteness: "definite" as const, number: "singular" as const, gender: "masculine" as const };
  if (article === "la") return { definiteness: "definite" as const, number: "singular" as const, gender: "feminine" as const };
  if (article === "l'") return { definiteness: "definite" as const, number: "singular" as const, gender: null };
  if (["i", "gli"].includes(article)) return { definiteness: "definite" as const, number: "plural" as const, gender: "masculine" as const };
  if (article === "le") return { definiteness: "definite" as const, number: "plural" as const, gender: "feminine" as const };
  if (["un", "uno"].includes(article)) return { definiteness: "indefinite" as const, number: "singular" as const, gender: "masculine" as const };
  if (["una", "un'"].includes(article)) return { definiteness: "indefinite" as const, number: "singular" as const, gender: "feminine" as const };
  return null;
}

function fieldLabel(field: NounSyntaxField) {
  if (field.kind === "noun") return field.number === "singular" ? "Singular noun" : "Plural noun";
  if (field.definiteness === "indefinite") return "Indefinite article";
  return field.number === "singular" ? "Definite singular article" : "Definite plural article";
}

function expectedArticle(field: Extract<NounSyntaxField, { kind: "article" }>, articles: ReturnType<typeof suggestedNounArticles>) {
  if (field.definiteness === "indefinite") return articles.indefiniteArticle;
  return field.number === "singular" ? articles.definiteSingularArticle : articles.definitePluralArticle;
}

function parseMarkers(tokens: string[], syntax: NounSyntaxRule, keywords: AnswerKeywords) {
  let index = 0;
  let gender: NounGender | null = null;
  let tantum: "singular" | "plural" | null = null;
  const pieces: NounSyntaxPiece[] = [];
  const allowedGender = syntax.markers.some((marker) => marker.kind === "gender");
  const allowedTantum = syntax.markers.find((marker) => marker.kind === "tantum");

  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    const parsedGender = genderMarker(token, keywords);
    const parsedTantum = tantumMarker(token, keywords);
    if (parsedGender) {
      if (!allowedGender || gender) return { invalid: true as const, index, gender, tantum, pieces, reason: "Gender marker is not allowed here or was repeated." };
      gender = parsedGender;
      pieces.push({ label: "Gender marker", value: parsedGender });
      index += 1;
      continue;
    }
    if (parsedTantum) {
      if (!allowedTantum || tantum || allowedTantum.value !== parsedTantum) {
        return { invalid: true as const, index, gender, tantum, pieces, reason: "Tantum marker does not match this syntax or was repeated." };
      }
      tantum = parsedTantum;
      pieces.push({ label: "Tantum marker", value: parsedTantum === "singular" ? "singular only" : "plural only" });
      index += 1;
      continue;
    }
    break;
  }

  const missingRequired = syntax.markers.filter((marker) => marker.required && (marker.kind === "gender" ? !gender : tantum !== marker.value));
  return { invalid: false as const, index, gender, tantum, pieces, missingRequired };
}

function candidateGenders(explicitGender: NounGender | null, fields: NounSyntaxField[], values: string[]): NounGender[] {
  const articleGenders = new Set<NounGender>();
  fields.forEach((field, index) => {
    if (field.kind !== "article") return;
    const facts = articleFacts(values[index] ?? "");
    if (facts?.gender) articleGenders.add(facts.gender);
  });

  if (explicitGender) {
    if ([...articleGenders].some((gender) => gender !== explicitGender)) return [];
    return [explicitGender];
  }
  if (articleGenders.size > 1) return [];
  if (articleGenders.size === 1) return [[...articleGenders][0]!];
  return ["masculine", "feminine"];
}

function buildCandidates(
  syntax: NounSyntaxRule,
  morphology: NounMorphology,
  genders: NounGender[],
  values: string[],
): NounSyntaxCandidate[] {
  const inferenceSet = morphology.inferenceSets.find((set) => set.id === syntax.inferenceSetId);
  if (!inferenceSet || !genders.length) return [];
  const result: NounSyntaxCandidate[] = [];

  for (const ruleId of inferenceSet.declensionRuleIds) {
    const rule = morphology.declensionRules.find((item) => item.id === ruleId);
    if (!rule || !ruleSupportsNumberMode(rule, syntax.numberMode)) continue;
    const observedBases: string[] = [];
    syntax.fields.forEach((field, index) => {
      if (field.kind !== "noun") return;
      const base = recognizeNounForm(rule, values[index] ?? "", field.number);
      if (base !== null) observedBases.push(base);
      else observedBases.push("\u0000NO_MATCH\u0000");
    });
    if (observedBases.some((base) => base === "\u0000NO_MATCH\u0000")) continue;
    const normalizedBases = new Set(observedBases.map(normalize));
    if (normalizedBases.size !== 1) continue;
    const base = observedBases[0] ?? "";

    const singular = syntax.numberMode === "plural" ? "" : generateNounForm(rule, base, "singular") ?? "";
    const plural = syntax.numberMode === "singular" ? "" : generateNounForm(rule, base, "plural") ?? "";

    for (const gender of genders) {
      const articles = suggestedNounArticles(gender, singular, plural, syntax.articleMode);
      const articlesMatch = syntax.fields.every((field, index) => {
        if (field.kind !== "article") return true;
        return normalize(values[index] ?? "") === normalize(expectedArticle(field, articles));
      });
      if (!articlesMatch) continue;

      result.push({
        syntaxRuleId: syntax.id,
        syntaxName: syntax.name,
        declensionRuleId: rule.id,
        declensionRuleName: rule.name,
        definition: {
          ruleId: rule.id,
          base,
          gender,
          numberMode: syntax.numberMode,
          articleMode: syntax.articleMode,
        },
      });
    }
  }
  return result;
}

export function attemptNounSyntax(rawValue: string, syntax: NounSyntaxRule, morphology: NounMorphology, keywords: AnswerKeywords): NounSyntaxAttempt {
  const originalTokens = tokenize(rawValue);
  const markerParse = parseMarkers(originalTokens, syntax, keywords);
  if (markerParse.invalid) {
    return { syntax, status: "not-applicable", pieces: markerParse.pieces, missing: [], candidates: [], consumedTokens: markerParse.index, reason: markerParse.reason };
  }

  if (markerParse.missingRequired.length && markerParse.index === originalTokens.length) {
    return {
      syntax,
      status: "partial",
      pieces: markerParse.pieces,
      missing: markerParse.missingRequired.map((marker) => marker.kind === "gender" ? "Gender marker" : marker.value === "singular" ? "Singular-only marker" : "Plural-only marker"),
      candidates: [],
      consumedTokens: markerParse.index,
      reason: "Required noun markers are still missing.",
    };
  }
  if (markerParse.missingRequired.length) {
    return { syntax, status: "not-applicable", pieces: markerParse.pieces, missing: [], candidates: [], consumedTokens: markerParse.index, reason: "Required noun marker is missing before the answer fields." };
  }

  const values = expandElidedArticleTokens(originalTokens.slice(markerParse.index));
  const pieces = [...markerParse.pieces];
  if (values.length > syntax.fields.length) {
    return { syntax, status: "not-applicable", pieces, missing: [], candidates: [], consumedTokens: originalTokens.length, reason: "Too many fields for this syntax." };
  }

  for (let index = 0; index < values.length; index += 1) {
    const field = syntax.fields[index];
    const value = values[index] ?? "";
    if (!field) break;
    if (field.kind === "article") {
      const facts = articleFacts(value);
      if (!facts || facts.number !== field.number || facts.definiteness !== field.definiteness) {
        return { syntax, status: "not-applicable", pieces, missing: [], candidates: [], consumedTokens: markerParse.index + index, reason: `${fieldLabel(field)} does not contain a valid article.` };
      }
    }
    pieces.push({ label: fieldLabel(field), value });
  }

  if (values.length < syntax.fields.length) {
    return {
      syntax,
      status: "partial",
      pieces,
      missing: syntax.fields.slice(values.length).map(fieldLabel),
      candidates: [],
      consumedTokens: originalTokens.length,
      reason: "This syntax matches the input so far.",
    };
  }

  const genders = candidateGenders(markerParse.gender, syntax.fields, values);
  if (!genders.length) {
    return { syntax, status: "not-applicable", pieces, missing: [], candidates: [], consumedTokens: originalTokens.length, reason: "The supplied gender and articles conflict." };
  }

  const candidates = buildCandidates(syntax, morphology, genders, values);
  return {
    syntax,
    status: "complete",
    pieces,
    missing: [],
    candidates,
    consumedTokens: originalTokens.length,
    reason: candidates.length ? "Syntax is complete." : "The syntax is complete, but no allowed declension rule recognizes the supplied forms.",
  };
}

export function analyzeNounInput(rawValue: string, morphology: NounMorphology, keywords: AnswerKeywords) {
  return morphology.syntaxRules.map((syntax) => attemptNounSyntax(rawValue, syntax, morphology, keywords));
}

export function choosePreviewAttempt(attempts: NounSyntaxAttempt[]) {
  const completeWithCandidates = attempts.filter((attempt) => attempt.status === "complete" && attempt.candidates.length);
  if (completeWithCandidates.length) return completeWithCandidates[0];
  const complete = attempts.filter((attempt) => attempt.status === "complete");
  if (complete.length) return complete[0];
  const partial = attempts.filter((attempt) => attempt.status === "partial");
  partial.sort((left, right) => right.consumedTokens - left.consumedTokens || left.missing.length - right.missing.length);
  return partial[0] ?? null;
}

export function evaluateNounAnswer(card: Flashcard, rawValue: string, morphology: NounMorphology, keywords: AnswerKeywords): NounAnswerEvaluation {
  if (card.type !== "noun") throw new Error("Noun evaluator requires a noun card.");
  const attempts = analyzeNounInput(rawValue, morphology, keywords);
  const candidates = attempts.flatMap((attempt) => attempt.status === "complete" ? attempt.candidates : []);
  const target = nounDefinitionForCard(card);
  const matchingCandidates = candidates.filter((candidate) => nounDefinitionMatches(candidate.definition, target));
  return {
    result: matchingCandidates.length ? "correct" : candidates.length ? "wrong" : "invalid",
    attempts,
    candidates,
    matchingCandidates,
  };
}
