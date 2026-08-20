import type { Flashcard } from "./types";

export type NounPatternGender = "masculine" | "feminine";
export type NounPatternSyntax = "full" | "article-singular";

export type NounPattern = {
  id: string;
  name: string;
  gender: NounPatternGender;
  singularSuffix: string;
  pluralSuffix: string;
  syntax: NounPatternSyntax;
};

export type DerivedNounForms = {
  gender: NounPatternGender;
  singular: string;
  plural: string;
  definiteSingularArticle: string;
  definitePluralArticle: string;
  indefiniteArticle: string;
};

export const defaultNounPatterns: NounPattern[] = [
  { id: "m-o-i", name: "Masculine -o → -i", gender: "masculine", singularSuffix: "o", pluralSuffix: "i", syntax: "article-singular" },
  { id: "m-e-i", name: "Masculine -e → -i", gender: "masculine", singularSuffix: "e", pluralSuffix: "i", syntax: "article-singular" },
  { id: "m-a-i", name: "Masculine -a → -i", gender: "masculine", singularSuffix: "a", pluralSuffix: "i", syntax: "article-singular" },
  { id: "f-a-e", name: "Feminine -a → -e", gender: "feminine", singularSuffix: "a", pluralSuffix: "e", syntax: "article-singular" },
  { id: "f-e-i", name: "Feminine -e → -i", gender: "feminine", singularSuffix: "e", pluralSuffix: "i", syntax: "article-singular" },
  { id: "f-ca-che", name: "Feminine -ca → -che", gender: "feminine", singularSuffix: "ca", pluralSuffix: "che", syntax: "article-singular" },
  { id: "f-ga-ghe", name: "Feminine -ga → -ghe", gender: "feminine", singularSuffix: "ga", pluralSuffix: "ghe", syntax: "article-singular" },
  { id: "m-chio-chi", name: "Masculine -chio → -chi", gender: "masculine", singularSuffix: "chio", pluralSuffix: "chi", syntax: "full" },
];

function normalizeText(value: string) {
  return value.normalize("NFC").trim().toLocaleLowerCase("it-IT").replace(/[’`]/g, "'").replace(/\s+/g, " ");
}

export function cloneNounPatterns(patterns: NounPattern[]) {
  return patterns.map((pattern) => ({ ...pattern }));
}

export function normalizeNounPattern(value: unknown): NounPattern {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Noun pattern must be an object.");
  const pattern = value as Partial<NounPattern>;
  const id = String(pattern.id || "").trim();
  const name = String(pattern.name || "").trim();
  const gender = pattern.gender === "feminine" ? "feminine" : pattern.gender === "masculine" ? "masculine" : null;
  const singularSuffix = String(pattern.singularSuffix ?? "").normalize("NFC").trim();
  const pluralSuffix = String(pattern.pluralSuffix ?? "").normalize("NFC").trim();
  const syntax = pattern.syntax === "article-singular" ? "article-singular" : pattern.syntax === "full" ? "full" : null;
  if (!id || !name || !gender || !singularSuffix || !pluralSuffix || !syntax) {
    throw new Error("Noun pattern needs an id, name, gender, singular suffix, plural suffix, and syntax.");
  }
  return { id, name, gender, singularSuffix, pluralSuffix, syntax };
}

export function normalizeNounPatterns(values: unknown): NounPattern[] {
  if (!Array.isArray(values)) throw new Error("Noun patterns must be an array.");
  const patterns = values.map(normalizeNounPattern);
  const ids = new Set<string>();
  for (const pattern of patterns) {
    if (ids.has(pattern.id)) throw new Error(`Duplicate noun pattern id: ${pattern.id}.`);
    ids.add(pattern.id);
  }
  return patterns;
}

export function suggestedNounArticles(gender: NounPatternGender, singular: string, plural: string) {
  const startsWithVowel = (word: string) => /^[aeiouàèéìòóù]/u.test(normalizeText(word));
  const takesLoSet = (word: string) => {
    const normalized = normalizeText(word);
    return /^(?:z|x|y|gn|ps|pn)/u.test(normalized)
      || /^s[^aeiouàèéìòóù]/u.test(normalized)
      || /^i[aeouàèéòóù]/u.test(normalized);
  };
  if (gender === "feminine") {
    return {
      definiteSingularArticle: singular.trim() ? (startsWithVowel(singular) ? "l’" : "la") : "",
      definitePluralArticle: plural.trim() ? "le" : "",
      indefiniteArticle: singular.trim() ? (startsWithVowel(singular) ? "un’" : "una") : "",
    };
  }
  return {
    definiteSingularArticle: singular.trim() ? (startsWithVowel(singular) ? "l’" : takesLoSet(singular) ? "lo" : "il") : "",
    definitePluralArticle: plural.trim() ? (startsWithVowel(plural) || takesLoSet(plural) ? "gli" : "i") : "",
    indefiniteArticle: singular.trim() ? (takesLoSet(singular) ? "uno" : "un") : "",
  };
}

export function deriveNounPatternForms(pattern: NounPattern, base: string): DerivedNounForms | null {
  const singular = base.normalize("NFC").trim();
  const normalizedSingular = normalizeText(singular);
  const normalizedSuffix = normalizeText(pattern.singularSuffix);
  if (!singular || !normalizedSingular.endsWith(normalizedSuffix)) return null;
  const plural = `${singular.slice(0, singular.length - pattern.singularSuffix.length)}${pattern.pluralSuffix}`;
  return {
    gender: pattern.gender,
    singular,
    plural,
    ...suggestedNounArticles(pattern.gender, singular, plural),
  };
}

export function nounPatternForCard(card: Flashcard, patterns: NounPattern[]) {
  if (card.type !== "noun") return null;
  const patternId = card.details.patternId;
  if (!patternId || patternId === "manual") return null;
  return patterns.find((pattern) => pattern.id === patternId) ?? null;
}

export function nounPatternMatchesCard(pattern: NounPattern, card: Flashcard) {
  if (card.type !== "noun") return false;
  const singular = card.details.singular ?? card.italian;
  const derived = deriveNounPatternForms(pattern, singular);
  if (!derived) return false;
  const d = card.details;
  const actualGender = d.gender === "feminine" ? "feminine" : "masculine";
  const fields = [
    [derived.gender, actualGender],
    [derived.singular, singular],
    [derived.plural, d.plural ?? ""],
    [derived.definiteSingularArticle, d.definiteSingularArticle ?? ""],
    [derived.definitePluralArticle, d.definitePluralArticle ?? ""],
    [derived.indefiniteArticle, d.indefiniteArticle ?? ""],
  ];
  return fields.every(([expected, actual]) => normalizeText(expected) === normalizeText(actual));
}

export function inferNounPatternId(card: Flashcard, patterns: NounPattern[]) {
  if (card.type !== "noun") return "manual";
  const matches = patterns.filter((pattern) => nounPatternMatchesCard(pattern, card));
  if (!matches.length) return "manual";
  matches.sort((left, right) => right.singularSuffix.length - left.singularSuffix.length);
  return matches[0].id;
}
