import type { Flashcard } from "./types";

export type NounGender = "masculine" | "feminine";
export type NounNumberMode = "both" | "singular" | "plural";
export type NounArticleMode = "automatic" | "none";
export type NounFormNumber = "singular" | "plural";

export type NounFormTransform = {
  suffix: string;
};

export type NounDeclensionRule = {
  id: string;
  name: string;
  forms: Partial<Record<NounFormNumber, NounFormTransform>>;
};

export type NounInferenceSet = {
  id: string;
  name: string;
  declensionRuleIds: string[];
};

export type NounSyntaxMarker =
  | { kind: "gender"; required: boolean }
  | { kind: "tantum"; required: boolean; value: "singular" | "plural" };

export type NounSyntaxField =
  | { kind: "article"; definiteness: "definite" | "indefinite"; number: NounFormNumber }
  | { kind: "noun"; number: NounFormNumber };

export type NounSyntaxRule = {
  id: string;
  name: string;
  markers: NounSyntaxMarker[];
  markerOrder: "any";
  fields: NounSyntaxField[];
  numberMode: NounNumberMode;
  articleMode: NounArticleMode;
  inferenceSetId: string;
};

export type NounMorphology = {
  declensionRules: NounDeclensionRule[];
  inferenceSets: NounInferenceSet[];
  syntaxRules: NounSyntaxRule[];
};

export type NounDefinition = {
  ruleId: string;
  base: string;
  gender: NounGender;
  numberMode: NounNumberMode;
  articleMode: NounArticleMode;
};

export type ResolvedNounForms = NounDefinition & {
  singular: string;
  plural: string;
  definiteSingularArticle: string;
  definitePluralArticle: string;
  indefiniteArticle: string;
};

export const defaultNounMorphology: NounMorphology = {
  declensionRules: [
    { id: "singular-base", name: "Singular form is the base", forms: { singular: { suffix: "" } } },
    { id: "plural-base", name: "Plural form is the base", forms: { plural: { suffix: "" } } },
    { id: "identity", name: "Unchanged singular / plural", forms: { singular: { suffix: "" }, plural: { suffix: "" } } },
    { id: "o-i", name: "-o → -i", forms: { singular: { suffix: "o" }, plural: { suffix: "i" } } },
    { id: "e-i", name: "-e → -i", forms: { singular: { suffix: "e" }, plural: { suffix: "i" } } },
    { id: "a-e", name: "-a → -e", forms: { singular: { suffix: "a" }, plural: { suffix: "e" } } },
    { id: "a-i", name: "-a → -i", forms: { singular: { suffix: "a" }, plural: { suffix: "i" } } },
    { id: "ca-che", name: "-ca → -che", forms: { singular: { suffix: "ca" }, plural: { suffix: "che" } } },
    { id: "ga-ghe", name: "-ga → -ghe", forms: { singular: { suffix: "ga" }, plural: { suffix: "ghe" } } },
    { id: "chio-chi", name: "-chio → -chi", forms: { singular: { suffix: "chio" }, plural: { suffix: "chi" } } },
  ],
  inferenceSets: [
    {
      id: "full-noun",
      name: "Full noun answers",
      declensionRuleIds: ["singular-base", "plural-base", "identity", "o-i", "e-i", "a-e", "a-i", "ca-che", "ga-ghe", "chio-chi"],
    },
    {
      id: "learned-shorthand",
      name: "Learned shorthand",
      declensionRuleIds: ["identity", "o-i", "e-i", "a-e", "a-i", "ca-che", "ga-ghe"],
    },
  ],
  syntaxRules: [
    {
      id: "article-singular",
      name: "Article + singular",
      markers: [{ kind: "gender", required: false }],
      markerOrder: "any",
      fields: [
        { kind: "article", definiteness: "definite", number: "singular" },
        { kind: "noun", number: "singular" },
      ],
      numberMode: "both",
      articleMode: "automatic",
      inferenceSetId: "learned-shorthand",
    },
    {
      id: "full-declension",
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
      numberMode: "both",
      articleMode: "automatic",
      inferenceSetId: "full-noun",
    },
    {
      id: "singular-tantum",
      name: "Singular-only noun",
      markers: [
        { kind: "gender", required: false },
        { kind: "tantum", required: true, value: "singular" },
      ],
      markerOrder: "any",
      fields: [{ kind: "noun", number: "singular" }],
      numberMode: "singular",
      articleMode: "none",
      inferenceSetId: "full-noun",
    },
    {
      id: "singular-tantum-article",
      name: "Singular-only article + noun",
      markers: [
        { kind: "gender", required: false },
        { kind: "tantum", required: true, value: "singular" },
      ],
      markerOrder: "any",
      fields: [
        { kind: "article", definiteness: "definite", number: "singular" },
        { kind: "noun", number: "singular" },
      ],
      numberMode: "singular",
      articleMode: "automatic",
      inferenceSetId: "full-noun",
    },
    {
      id: "plural-tantum",
      name: "Plural-only noun",
      markers: [
        { kind: "gender", required: false },
        { kind: "tantum", required: true, value: "plural" },
      ],
      markerOrder: "any",
      fields: [
        { kind: "article", definiteness: "definite", number: "plural" },
        { kind: "noun", number: "plural" },
      ],
      numberMode: "plural",
      articleMode: "automatic",
      inferenceSetId: "full-noun",
    },
  ],
};

function normalizeText(value: string) {
  return value.normalize("NFC").trim().toLocaleLowerCase("it-IT").replace(/[’`]/g, "'").replace(/\s+/g, " ");
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function objectValue(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`${label} must be a non-empty string.`);
  return result;
}

function normalizedTransform(value: unknown, label: string): NounFormTransform | undefined {
  if (value === undefined || value === null) return undefined;
  const transform = objectValue(value, label);
  return { suffix: String(transform.suffix ?? "").normalize("NFC") };
}

export function cloneNounMorphology(value: NounMorphology) {
  return clone(value);
}

export function ruleSupportsNumberMode(rule: NounDeclensionRule, numberMode: NounNumberMode) {
  const singular = Boolean(rule.forms.singular);
  const plural = Boolean(rule.forms.plural);
  if (numberMode === "both") return singular && plural;
  if (numberMode === "singular") return singular && !plural;
  return plural && !singular;
}

export function normalizeNounMorphology(value: unknown): NounMorphology {
  const payload = objectValue(value, "Noun morphology");
  if (!Array.isArray(payload.declensionRules) || !Array.isArray(payload.inferenceSets) || !Array.isArray(payload.syntaxRules)) {
    throw new Error("Noun morphology needs declensionRules, inferenceSets, and syntaxRules arrays.");
  }

  const declensionRules: NounDeclensionRule[] = payload.declensionRules.map((raw) => {
    const rule = objectValue(raw, "Declension rule");
    const forms = objectValue(rule.forms, "Declension rule forms");
    const singular = normalizedTransform(forms.singular, "Singular transform");
    const plural = normalizedTransform(forms.plural, "Plural transform");
    if (!singular && !plural) throw new Error("A declension rule must define at least one form.");
    return {
      id: nonEmptyString(rule.id, "Declension rule id"),
      name: nonEmptyString(rule.name, "Declension rule name"),
      forms: { ...(singular ? { singular } : {}), ...(plural ? { plural } : {}) },
    };
  });

  const ruleIds = new Set<string>();
  for (const rule of declensionRules) {
    if (ruleIds.has(rule.id)) throw new Error(`Duplicate declension rule id: ${rule.id}.`);
    ruleIds.add(rule.id);
  }

  const inferenceSets: NounInferenceSet[] = payload.inferenceSets.map((raw) => {
    const set = objectValue(raw, "Inference set");
    if (!Array.isArray(set.declensionRuleIds)) throw new Error("Inference set declensionRuleIds must be an array.");
    const declensionRuleIds = set.declensionRuleIds.map((id) => nonEmptyString(id, "Inference rule id"));
    for (const id of declensionRuleIds) {
      if (!ruleIds.has(id)) throw new Error(`Inference set references unknown declension rule: ${id}.`);
    }
    return {
      id: nonEmptyString(set.id, "Inference set id"),
      name: nonEmptyString(set.name, "Inference set name"),
      declensionRuleIds: [...new Set(declensionRuleIds)],
    };
  });

  const inferenceSetIds = new Set<string>();
  for (const set of inferenceSets) {
    if (inferenceSetIds.has(set.id)) throw new Error(`Duplicate inference set id: ${set.id}.`);
    inferenceSetIds.add(set.id);
  }

  const syntaxRules: NounSyntaxRule[] = payload.syntaxRules.map((raw) => {
    const syntax = objectValue(raw, "Syntax rule");
    if (!Array.isArray(syntax.markers) || !Array.isArray(syntax.fields)) throw new Error("Syntax rule markers and fields must be arrays.");
    const markers: NounSyntaxMarker[] = syntax.markers.map((rawMarker) => {
      const marker = objectValue(rawMarker, "Syntax marker");
      if (marker.kind === "gender") return { kind: "gender", required: Boolean(marker.required) };
      if (marker.kind === "tantum" && (marker.value === "singular" || marker.value === "plural")) {
        return { kind: "tantum", required: Boolean(marker.required), value: marker.value };
      }
      throw new Error("Syntax marker must be a gender marker or a singular/plural tantum marker.");
    });
    if (markers.filter((marker) => marker.kind === "gender").length > 1) throw new Error("A syntax rule can contain at most one gender marker.");
    if (markers.filter((marker) => marker.kind === "tantum").length > 1) throw new Error("A syntax rule can contain at most one tantum marker.");

    const fields: NounSyntaxField[] = syntax.fields.map((rawField) => {
      const field = objectValue(rawField, "Syntax field");
      if (field.kind === "noun" && (field.number === "singular" || field.number === "plural")) {
        return { kind: "noun", number: field.number };
      }
      if (
        field.kind === "article"
        && (field.number === "singular" || field.number === "plural")
        && (field.definiteness === "definite" || field.definiteness === "indefinite")
      ) {
        if (field.definiteness === "indefinite" && field.number !== "singular") throw new Error("Indefinite article fields must be singular.");
        return { kind: "article", number: field.number, definiteness: field.definiteness };
      }
      throw new Error("Syntax field must be a noun form or article field.");
    });
    if (!fields.some((field) => field.kind === "noun")) throw new Error("A syntax rule must contain at least one noun field.");

    const numberMode = syntax.numberMode === "both" || syntax.numberMode === "singular" || syntax.numberMode === "plural" ? syntax.numberMode : null;
    const articleMode = syntax.articleMode === "automatic" || syntax.articleMode === "none" ? syntax.articleMode : null;
    const inferenceSetId = nonEmptyString(syntax.inferenceSetId, "Syntax inferenceSetId");
    if (!numberMode || !articleMode || !inferenceSetIds.has(inferenceSetId)) throw new Error("Syntax rule has invalid number, article, or inference-set configuration.");
    if (articleMode === "none" && fields.some((field) => field.kind === "article")) throw new Error("A no-article syntax cannot contain article fields.");
    return {
      id: nonEmptyString(syntax.id, "Syntax rule id"),
      name: nonEmptyString(syntax.name, "Syntax rule name"),
      markers,
      markerOrder: "any",
      fields,
      numberMode,
      articleMode,
      inferenceSetId,
    };
  });

  const syntaxIds = new Set<string>();
  for (const syntax of syntaxRules) {
    if (syntaxIds.has(syntax.id)) throw new Error(`Duplicate syntax rule id: ${syntax.id}.`);
    syntaxIds.add(syntax.id);
  }

  return { declensionRules, inferenceSets, syntaxRules };
}

export function generateNounForm(rule: NounDeclensionRule, base: string, number: NounFormNumber) {
  const transform = rule.forms[number];
  if (!transform) return null;
  return `${base.normalize("NFC")}${transform.suffix}`;
}

export function recognizeNounForm(rule: NounDeclensionRule, surface: string, number: NounFormNumber) {
  const transform = rule.forms[number];
  if (!transform) return null;
  const value = surface.normalize("NFC").trim();
  const suffix = transform.suffix.normalize("NFC");
  if (!suffix) return value;
  if (!normalizeText(value).endsWith(normalizeText(suffix))) return null;
  return value.slice(0, value.length - suffix.length);
}

export function suggestedNounArticles(gender: NounGender, singular: string, plural: string, articleMode: NounArticleMode = "automatic") {
  if (articleMode === "none") {
    return { definiteSingularArticle: "", definitePluralArticle: "", indefiniteArticle: "" };
  }
  const startsWithVowel = (word: string) => /^[aeiouàèéìòóù]/u.test(normalizeText(word));
  const takesLoSet = (word: string) => {
    const normalized = normalizeText(word);
    return /^(?:z|x|y|gn|ps|pn)/u.test(normalized)
      || /^s[^aeiouàèéìòóù]/u.test(normalized)
      || /^i[aeouàèéòóù]/u.test(normalized);
  };
  if (gender === "feminine") {
    return {
      definiteSingularArticle: singular ? (startsWithVowel(singular) ? "l’" : "la") : "",
      definitePluralArticle: plural ? "le" : "",
      indefiniteArticle: singular ? (startsWithVowel(singular) ? "un’" : "una") : "",
    };
  }
  return {
    definiteSingularArticle: singular ? (startsWithVowel(singular) ? "l’" : takesLoSet(singular) ? "lo" : "il") : "",
    definitePluralArticle: plural ? (startsWithVowel(plural) || takesLoSet(plural) ? "gli" : "i") : "",
    indefiniteArticle: singular ? (takesLoSet(singular) ? "uno" : "un") : "",
  };
}

export function nounDefinitionForCard(card: Flashcard): NounDefinition {
  if (card.type !== "noun") throw new Error("Only noun cards have noun definitions.");
  const d = card.details;
  const ruleId = String(d.ruleId ?? "").trim();
  const base = String(d.base ?? "").normalize("NFC");
  const gender: NounGender | null = d.gender === "masculine" || d.gender === "feminine" ? d.gender : null;
  const numberMode: NounNumberMode | null = d.numberMode === "both" || d.numberMode === "singular" || d.numberMode === "plural" ? d.numberMode : null;
  const articleMode: NounArticleMode | null = d.articleMode === "automatic" || d.articleMode === "none" ? d.articleMode : null;
  if (!ruleId || !gender || !numberMode || !articleMode) throw new Error(`Noun card ${card.id} does not have a canonical noun definition.`);
  return { ruleId, base, gender, numberMode, articleMode };
}

export function resolvedNounForms(card: Flashcard, morphology: NounMorphology): ResolvedNounForms {
  const definition = nounDefinitionForCard(card);
  const rule = morphology.declensionRules.find((item) => item.id === definition.ruleId);
  if (!rule) throw new Error(`Noun card ${card.id} references unknown declension rule ${definition.ruleId}.`);
  if (!ruleSupportsNumberMode(rule, definition.numberMode)) {
    throw new Error(`Declension rule ${rule.id} does not support ${definition.numberMode} noun definitions.`);
  }
  const singular = definition.numberMode === "plural" ? "" : generateNounForm(rule, definition.base, "singular") ?? "";
  const plural = definition.numberMode === "singular" ? "" : generateNounForm(rule, definition.base, "plural") ?? "";
  return {
    ...definition,
    singular,
    plural,
    ...suggestedNounArticles(definition.gender, singular, plural, definition.articleMode),
  };
}

export function ruleForNounCard(card: Flashcard, morphology: NounMorphology) {
  const definition = nounDefinitionForCard(card);
  return morphology.declensionRules.find((rule) => rule.id === definition.ruleId) ?? null;
}

export function nounDefinitionMatches(left: NounDefinition, right: NounDefinition) {
  return left.ruleId === right.ruleId
    && normalizeText(left.base) === normalizeText(right.base)
    && left.gender === right.gender
    && left.numberMode === right.numberMode
    && left.articleMode === right.articleMode;
}

export function inferNounDefinitionFromForms(input: {
  singular: string;
  plural: string;
  gender: NounGender;
  definiteSingularArticle: string;
  definitePluralArticle: string;
  indefiniteArticle: string;
}, morphology: NounMorphology): NounDefinition | null {
  const singular = input.singular.normalize("NFC").trim();
  const plural = input.plural.normalize("NFC").trim();
  if (!singular && !plural) return null;
  const numberMode: NounNumberMode = singular && plural ? "both" : singular ? "singular" : "plural";
  const articleMode: NounArticleMode = input.definiteSingularArticle || input.definitePluralArticle || input.indefiniteArticle ? "automatic" : "none";

  const matches: Array<NounDefinition & { specificity: number }> = [];
  for (const rule of morphology.declensionRules) {
    if (!ruleSupportsNumberMode(rule, numberMode)) continue;
    const singularBase = singular ? recognizeNounForm(rule, singular, "singular") : null;
    const pluralBase = plural ? recognizeNounForm(rule, plural, "plural") : null;
    if (singular && singularBase === null) continue;
    if (plural && pluralBase === null) continue;
    const base = singularBase ?? pluralBase ?? "";
    if (singularBase !== null && pluralBase !== null && normalizeText(singularBase) !== normalizeText(pluralBase)) continue;
    const generatedSingular = numberMode === "plural" ? "" : generateNounForm(rule, base, "singular") ?? "";
    const generatedPlural = numberMode === "singular" ? "" : generateNounForm(rule, base, "plural") ?? "";
    const articles = suggestedNounArticles(input.gender, generatedSingular, generatedPlural, articleMode);
    if (normalizeText(articles.definiteSingularArticle) !== normalizeText(input.definiteSingularArticle)) continue;
    if (normalizeText(articles.definitePluralArticle) !== normalizeText(input.definitePluralArticle)) continue;
    if (normalizeText(articles.indefiniteArticle) !== normalizeText(input.indefiniteArticle)) continue;
    const suffixLengths = [rule.forms.singular?.suffix.length, rule.forms.plural?.suffix.length].filter((value): value is number => value !== undefined);
    matches.push({
      ruleId: rule.id,
      base,
      gender: input.gender,
      numberMode,
      articleMode,
      specificity: Math.max(...suffixLengths),
    });
  }
  matches.sort((left, right) => right.specificity - left.specificity || left.ruleId.localeCompare(right.ruleId));
  const match = matches[0];
  if (!match) return null;
  if (matches[1]?.specificity === match.specificity) return null;
  const { specificity: _specificity, ...definition } = match;
  return definition;
}
