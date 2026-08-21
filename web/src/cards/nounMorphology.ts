import type {
  Flashcard,
  NounArticleProfile,
  NounGender,
  NounDetails,
} from "./types";

export type { NounArticleProfile, NounGender } from "./types";
export type NounNumberMode = "both" | "singular" | "plural";
export type NounArticleCapability = "definite-singular" | "definite-plural" | "indefinite-singular";
export type NounFormNumber = "singular" | "plural";

export type NounFormTransform = {
  suffix: string;
};

export type NounDeclensionRule = {
  name: string;
  forms: Partial<Record<NounFormNumber, NounFormTransform>>;
};

export type NounInferenceSet = {
  name: string;
  declensionRules: string[];
};

export type NounSyntaxMarker =
  | { kind: "gender"; required: boolean }
  | { kind: "tantum"; required: boolean; value: "singular" | "plural" };

export type NounSyntaxField =
  | { kind: "article"; definiteness: "definite" | "indefinite"; number: NounFormNumber }
  | { kind: "noun"; number: NounFormNumber };

export type NounSyntaxRule = {
  name: string;
  markers: NounSyntaxMarker[];
  markerOrder: "any";
  fields: NounSyntaxField[];
  inferenceSet: string;
};

export type NounMorphology = {
  declensionRules: NounDeclensionRule[];
  inferenceSets: NounInferenceSet[];
  syntaxRules: NounSyntaxRule[];
};

export type NounDefinition = NounDetails;

export type ResolvedNounForms = NounDefinition & {
  numberMode: NounNumberMode;
  singular: string;
  plural: string;
  definiteSingularArticle: string;
  definitePluralArticle: string;
  indefiniteArticle: string;
};

export const nounArticleProfiles = {
  all: { definiteSingular: true, definitePlural: true, indefiniteSingular: true },
  definiteSingularOnly: { definiteSingular: true, definitePlural: false, indefiniteSingular: false },
  definitePluralOnly: { definiteSingular: false, definitePlural: true, indefiniteSingular: false },
  none: { definiteSingular: false, definitePlural: false, indefiniteSingular: false },
} as const satisfies Record<string, NounArticleProfile>;

export const defaultNounMorphology: NounMorphology = {
  declensionRules: [
    { name: "Singular form is the base", forms: { singular: { suffix: "" } } },
    { name: "Plural form is the base", forms: { plural: { suffix: "" } } },
    { name: "Unchanged singular / plural", forms: { singular: { suffix: "" }, plural: { suffix: "" } } },
    { name: "-o → -i", forms: { singular: { suffix: "o" }, plural: { suffix: "i" } } },
    { name: "-e → -i", forms: { singular: { suffix: "e" }, plural: { suffix: "i" } } },
    { name: "-a → -e", forms: { singular: { suffix: "a" }, plural: { suffix: "e" } } },
    { name: "-a → -i", forms: { singular: { suffix: "a" }, plural: { suffix: "i" } } },
    { name: "-ca → -che", forms: { singular: { suffix: "ca" }, plural: { suffix: "che" } } },
    { name: "-ga → -ghe", forms: { singular: { suffix: "ga" }, plural: { suffix: "ghe" } } },
    { name: "-chio → -chi", forms: { singular: { suffix: "chio" }, plural: { suffix: "chi" } } },
  ],
  inferenceSets: [
    {
      name: "Full noun answers",
      declensionRules: [
        "Singular form is the base",
        "Plural form is the base",
        "Unchanged singular / plural",
        "-o → -i",
        "-e → -i",
        "-a → -e",
        "-a → -i",
        "-ca → -che",
        "-ga → -ghe",
        "-chio → -chi",
      ],
    },
    {
      name: "Learned shorthand",
      declensionRules: [
        "Singular form is the base",
        "Plural form is the base",
        "Unchanged singular / plural",
        "-o → -i",
        "-e → -i",
        "-a → -e",
        "-a → -i",
        "-ca → -che",
        "-ga → -ghe",
      ],
    },
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
      inferenceSet: "Learned shorthand",
    },
    {
      name: "Definite plural article + noun",
      markers: [{ kind: "gender", required: false }],
      markerOrder: "any",
      fields: [
        { kind: "article", definiteness: "definite", number: "plural" },
        { kind: "noun", number: "plural" },
      ],
      inferenceSet: "Learned shorthand",
    },
    {
      name: "Indefinite singular article + noun",
      markers: [{ kind: "gender", required: false }],
      markerOrder: "any",
      fields: [
        { kind: "article", definiteness: "indefinite", number: "singular" },
        { kind: "noun", number: "singular" },
      ],
      inferenceSet: "Learned shorthand",
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
      inferenceSet: "Full noun answers",
    },
    {
      name: "Articleless singular noun",
      markers: [
        { kind: "gender", required: true },
        { kind: "tantum", required: true, value: "singular" },
      ],
      markerOrder: "any",
      fields: [{ kind: "noun", number: "singular" }],
      inferenceSet: "Full noun answers",
    },
    {
      name: "Articleless plural noun",
      markers: [
        { kind: "gender", required: true },
        { kind: "tantum", required: true, value: "plural" },
      ],
      markerOrder: "any",
      fields: [{ kind: "noun", number: "plural" }],
      inferenceSet: "Full noun answers",
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

function assertExactKeys(value: Record<string, unknown>, label: string, expected: string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${wanted.join(", ")}.`);
  }
}

function nonEmptyString(value: unknown, label: string) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`${label} must be a non-empty string.`);
  return result;
}

function normalizedTransform(value: unknown, label: string): NounFormTransform | undefined {
  if (value === undefined || value === null) return undefined;
  const transform = objectValue(value, label);
  assertExactKeys(transform, label, ["suffix"]);
  return { suffix: String(transform.suffix ?? "").normalize("NFC") };
}

function assertUniqueNames(values: { name: string }[], label: string) {
  const names = new Set<string>();
  for (const value of values) {
    if (names.has(value.name)) throw new Error(`Duplicate ${label} name: ${value.name}.`);
    names.add(value.name);
  }
}

export function cloneNounMorphology(value: NounMorphology) {
  return clone(value);
}

export function ruleNumberMode(rule: NounDeclensionRule): NounNumberMode {
  const singular = Boolean(rule.forms.singular);
  const plural = Boolean(rule.forms.plural);
  if (singular && plural) return "both";
  if (singular) return "singular";
  return "plural";
}

export function ruleSupportsNumberMode(rule: NounDeclensionRule, numberMode: NounNumberMode) {
  return ruleNumberMode(rule) === numberMode;
}

export function ruleSupportsFormNumber(rule: NounDeclensionRule, number: NounFormNumber) {
  return Boolean(rule.forms[number]);
}

export function articleProfileAllows(profile: NounArticleProfile, capability: NounArticleCapability) {
  if (capability === "definite-singular") return profile.definiteSingular;
  if (capability === "definite-plural") return profile.definitePlural;
  return profile.indefiniteSingular;
}

export function articleProfilesEqual(left: NounArticleProfile, right: NounArticleProfile) {
  return left.definiteSingular === right.definiteSingular
    && left.definitePlural === right.definitePlural
    && left.indefiniteSingular === right.indefiniteSingular;
}

export function normalizeNounArticleProfile(value: unknown, label = "Noun article profile"): NounArticleProfile {
  const profile = objectValue(value, label);
  assertExactKeys(profile, label, ["definiteSingular", "definitePlural", "indefiniteSingular"]);
  if (
    typeof profile.definiteSingular !== "boolean"
    || typeof profile.definitePlural !== "boolean"
    || typeof profile.indefiniteSingular !== "boolean"
  ) {
    throw new Error(`${label} capabilities must be booleans.`);
  }

  const normalized = {
    definiteSingular: profile.definiteSingular,
    definitePlural: profile.definitePlural,
    indefiniteSingular: profile.indefiniteSingular,
  };
  const allowed = Object.values(nounArticleProfiles).some((candidate) => articleProfilesEqual(candidate, normalized as NounArticleProfile));
  if (!allowed) {
    throw new Error(`${label} must be all articles, definite singular only, definite plural only, or no articles.`);
  }
  return normalized as NounArticleProfile;
}

export function articleProfileFromArticlePresence(input: {
  definiteSingularArticle: string;
  definitePluralArticle: string;
  indefiniteArticle: string;
}): NounArticleProfile | null {
  const profile = {
    definiteSingular: Boolean(input.definiteSingularArticle.trim()),
    definitePlural: Boolean(input.definitePluralArticle.trim()),
    indefiniteSingular: Boolean(input.indefiniteArticle.trim()),
  };
  return Object.values(nounArticleProfiles).find((candidate) => articleProfilesEqual(candidate, profile as NounArticleProfile)) ?? null;
}

export function articleProfileCompatibleWithRule(profile: NounArticleProfile, rule: NounDeclensionRule) {
  if (profile.definiteSingular && !rule.forms.singular) return false;
  if (profile.definitePlural && !rule.forms.plural) return false;
  if (profile.indefiniteSingular && !rule.forms.singular) return false;
  return true;
}

export function normalizeNounMorphology(value: unknown): NounMorphology {
  const payload = objectValue(value, "Noun morphology");
  assertExactKeys(payload, "Noun morphology", ["declensionRules", "inferenceSets", "syntaxRules"]);
  if (!Array.isArray(payload.declensionRules) || !Array.isArray(payload.inferenceSets) || !Array.isArray(payload.syntaxRules)) {
    throw new Error("Noun morphology needs declensionRules, inferenceSets, and syntaxRules arrays.");
  }

  const declensionRules: NounDeclensionRule[] = payload.declensionRules.map((raw) => {
    const rule = objectValue(raw, "Declension rule");
    assertExactKeys(rule, "Declension rule", ["name", "forms"]);
    const forms = objectValue(rule.forms, "Declension rule forms");
    const formKeys = Object.keys(forms);
    if (formKeys.some((key) => key !== "singular" && key !== "plural")) throw new Error("Declension rule forms can contain only singular and plural.");
    const singular = normalizedTransform(forms.singular, "Singular transform");
    const plural = normalizedTransform(forms.plural, "Plural transform");
    if (!singular && !plural) throw new Error("A declension rule must define at least one form.");
    return {
      name: nonEmptyString(rule.name, "Declension rule name"),
      forms: { ...(singular ? { singular } : {}), ...(plural ? { plural } : {}) },
    };
  });
  assertUniqueNames(declensionRules, "declension rule");
  const ruleNames = new Set(declensionRules.map((rule) => rule.name));

  const inferenceSets: NounInferenceSet[] = payload.inferenceSets.map((raw) => {
    const set = objectValue(raw, "Inference set");
    assertExactKeys(set, "Inference set", ["name", "declensionRules"]);
    if (!Array.isArray(set.declensionRules)) throw new Error("Inference set declensionRules must be an array.");
    const declensionRuleNames = set.declensionRules.map((name) => nonEmptyString(name, "Inference rule name"));
    for (const name of declensionRuleNames) {
      if (!ruleNames.has(name)) throw new Error(`Inference set references unknown declension rule: ${name}.`);
    }
    return {
      name: nonEmptyString(set.name, "Inference set name"),
      declensionRules: [...new Set(declensionRuleNames)],
    };
  });
  assertUniqueNames(inferenceSets, "inference set");
  const inferenceSetNames = new Set(inferenceSets.map((set) => set.name));

  const syntaxRules: NounSyntaxRule[] = payload.syntaxRules.map((raw) => {
    const syntax = objectValue(raw, "Syntax rule");
    assertExactKeys(syntax, "Syntax rule", ["name", "markers", "markerOrder", "fields", "inferenceSet"]);
    if (!Array.isArray(syntax.markers) || !Array.isArray(syntax.fields)) throw new Error("Syntax rule markers and fields must be arrays.");
    if (syntax.markerOrder !== "any") throw new Error("Syntax markerOrder must be any.");

    const markers: NounSyntaxMarker[] = syntax.markers.map((rawMarker) => {
      const marker = objectValue(rawMarker, "Syntax marker");
      if (marker.kind === "gender") {
        assertExactKeys(marker, "Gender syntax marker", ["kind", "required"]);
        return { kind: "gender", required: Boolean(marker.required) };
      }
      if (marker.kind === "tantum" && (marker.value === "singular" || marker.value === "plural")) {
        assertExactKeys(marker, "Tantum syntax marker", ["kind", "required", "value"]);
        return { kind: "tantum", required: Boolean(marker.required), value: marker.value };
      }
      throw new Error("Syntax marker must be a gender marker or a singular/plural tantum marker.");
    });
    if (markers.filter((marker) => marker.kind === "gender").length > 1) throw new Error("A syntax rule can contain at most one gender marker.");
    if (markers.filter((marker) => marker.kind === "tantum").length > 1) throw new Error("A syntax rule can contain at most one tantum marker.");

    const fields: NounSyntaxField[] = syntax.fields.map((rawField) => {
      const field = objectValue(rawField, "Syntax field");
      if (field.kind === "noun" && (field.number === "singular" || field.number === "plural")) {
        assertExactKeys(field, "Noun syntax field", ["kind", "number"]);
        return { kind: "noun", number: field.number };
      }
      if (
        field.kind === "article"
        && (field.number === "singular" || field.number === "plural")
        && (field.definiteness === "definite" || field.definiteness === "indefinite")
      ) {
        assertExactKeys(field, "Article syntax field", ["kind", "definiteness", "number"]);
        if (field.definiteness === "indefinite" && field.number !== "singular") throw new Error("Indefinite article fields must be singular.");
        return { kind: "article", number: field.number, definiteness: field.definiteness };
      }
      throw new Error("Syntax field must be a noun form or article field.");
    });
    if (!fields.some((field) => field.kind === "noun")) throw new Error("A syntax rule must contain at least one noun field.");

    const inferenceSet = nonEmptyString(syntax.inferenceSet, "Syntax inference set");
    if (!inferenceSetNames.has(inferenceSet)) throw new Error("Syntax rule references an unknown inference set.");
    const tantum = markers.find((marker) => marker.kind === "tantum");
    if (tantum && fields.some((field) => field.number !== tantum.value)) {
      throw new Error(`Noun syntax ${syntax.name} has a ${tantum.value}-only marker but contains a field of the other number.`);
    }
    if (!fields.some((field) => field.kind === "article")) {
      const genderMarker = markers.find((marker) => marker.kind === "gender");
      if (!genderMarker?.required || !tantum?.required) {
        throw new Error("An articleless syntax must require explicit gender and singular/plural-only markers.");
      }
    }

    return {
      name: nonEmptyString(syntax.name, "Syntax rule name"),
      markers,
      markerOrder: "any",
      fields,
      inferenceSet,
    };
  });
  assertUniqueNames(syntaxRules, "syntax rule");

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

export function suggestedNounArticles(
  gender: NounGender,
  singular: string,
  plural: string,
  articleProfile: NounArticleProfile = nounArticleProfiles.all,
) {
  const startsWithVowel = (word: string) => /^[aeiouàèéìòóù]/u.test(normalizeText(word));
  const takesLoSet = (word: string) => {
    const normalized = normalizeText(word);
    return /^(?:z|x|y|gn|ps|pn)/u.test(normalized)
      || /^s[^aeiouàèéìòóù]/u.test(normalized)
      || /^i[aeouàèéòóù]/u.test(normalized);
  };

  let definiteSingularArticle = "";
  let definitePluralArticle = "";
  let indefiniteArticle = "";
  if (gender === "feminine") {
    definiteSingularArticle = singular ? (startsWithVowel(singular) ? "l’" : "la") : "";
    definitePluralArticle = plural ? "le" : "";
    indefiniteArticle = singular ? (startsWithVowel(singular) ? "un’" : "una") : "";
  } else {
    definiteSingularArticle = singular ? (startsWithVowel(singular) ? "l’" : takesLoSet(singular) ? "lo" : "il") : "";
    definitePluralArticle = plural ? (startsWithVowel(plural) || takesLoSet(plural) ? "gli" : "i") : "";
    indefiniteArticle = singular ? (takesLoSet(singular) ? "uno" : "un") : "";
  }

  return {
    definiteSingularArticle: articleProfile.definiteSingular ? definiteSingularArticle : "",
    definitePluralArticle: articleProfile.definitePlural ? definitePluralArticle : "",
    indefiniteArticle: articleProfile.indefiniteSingular ? indefiniteArticle : "",
  };
}

export function nounDefinitionForCard(card: Flashcard): NounDefinition {
  if (card.type !== "noun") throw new Error("Only noun cards have noun definitions.");
  const d = card.details;
  const rule = d.rule.trim();
  const base = d.base.normalize("NFC");
  if (!rule) throw new Error(`Noun card ${card.id} does not have a canonical noun definition.`);
  return {
    rule,
    base,
    gender: d.gender,
    articleProfile: normalizeNounArticleProfile(d.articleProfile, `Noun card ${card.id} article profile`),
  };
}

export function resolvedNounForms(card: Flashcard, morphology: NounMorphology): ResolvedNounForms {
  const definition = nounDefinitionForCard(card);
  const rule = morphology.declensionRules.find((item) => item.name === definition.rule);
  if (!rule) throw new Error(`Noun card ${card.id} references unknown declension rule ${definition.rule}.`);
  if (!articleProfileCompatibleWithRule(definition.articleProfile, rule)) {
    throw new Error(`Noun card ${card.id} has an article profile that requires a noun form its declension does not provide.`);
  }
  const numberMode = ruleNumberMode(rule);
  const singular = generateNounForm(rule, definition.base, "singular") ?? "";
  const plural = generateNounForm(rule, definition.base, "plural") ?? "";
  return {
    ...definition,
    numberMode,
    singular,
    plural,
    ...suggestedNounArticles(definition.gender, singular, plural, definition.articleProfile),
  };
}

export function ruleForNounCard(card: Flashcard, morphology: NounMorphology) {
  const definition = nounDefinitionForCard(card);
  return morphology.declensionRules.find((rule) => rule.name === definition.rule) ?? null;
}

export function nounDefinitionMatches(left: NounDefinition, right: NounDefinition) {
  return left.rule === right.rule
    && normalizeText(left.base) === normalizeText(right.base)
    && left.gender === right.gender
    && articleProfilesEqual(left.articleProfile, right.articleProfile);
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
  const articleProfile = articleProfileFromArticlePresence(input);
  if (!articleProfile) return null;

  const matches: Array<NounDefinition & { specificity: number }> = [];
  for (const rule of morphology.declensionRules) {
    if (!ruleSupportsNumberMode(rule, numberMode) || !articleProfileCompatibleWithRule(articleProfile, rule)) continue;
    const singularBase = singular ? recognizeNounForm(rule, singular, "singular") : null;
    const pluralBase = plural ? recognizeNounForm(rule, plural, "plural") : null;
    if (singular && singularBase === null) continue;
    if (plural && pluralBase === null) continue;
    const base = singularBase ?? pluralBase ?? "";
    if (singularBase !== null && pluralBase !== null && normalizeText(singularBase) !== normalizeText(pluralBase)) continue;
    const generatedSingular = generateNounForm(rule, base, "singular") ?? "";
    const generatedPlural = generateNounForm(rule, base, "plural") ?? "";
    const articles = suggestedNounArticles(input.gender, generatedSingular, generatedPlural, articleProfile);
    if (normalizeText(articles.definiteSingularArticle) !== normalizeText(input.definiteSingularArticle)) continue;
    if (normalizeText(articles.definitePluralArticle) !== normalizeText(input.definitePluralArticle)) continue;
    if (normalizeText(articles.indefiniteArticle) !== normalizeText(input.indefiniteArticle)) continue;
    const suffixLengths = [rule.forms.singular?.suffix.length, rule.forms.plural?.suffix.length].filter((value): value is number => value !== undefined);
    matches.push({
      rule: rule.name,
      base,
      gender: input.gender,
      articleProfile,
      specificity: Math.max(...suffixLengths),
    });
  }
  matches.sort((left, right) => right.specificity - left.specificity || left.rule.localeCompare(right.rule));
  const match = matches[0];
  if (!match) return null;
  if (matches[1]?.specificity === match.specificity) return null;
  const { specificity: _specificity, ...definition } = match;
  return definition;
}
