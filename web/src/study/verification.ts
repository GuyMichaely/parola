import type { Flashcard } from "../cards/types";
import { getActiveNounPatterns } from "../cards/nounPatternRuntime";
import { nounPatternForCard, resolvedNounForms } from "../cards/nounPatterns";
import type { AnswerKeywords } from "../components/StudyOptions";

export type VerificationField = {
  key: string;
  label: string;
  expected: string;
};

type NounGender = "masculine" | "feminine";
export type NounNumberMode = "singular" | "plural";

export function inferArticle(fullForm: string | undefined, noun: string | undefined, fallback: string) {
  if (!fullForm || !noun) return fallback;
  if (fullForm.endsWith(noun)) {
    const article = fullForm.slice(0, -noun.length).trim();
    return article || fallback;
  }
  return fallback;
}

export function normalizeAnswer(value: string) {
  return value
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase("it-IT")
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ");
}

export function keywordMatches(value: string, configured: string) {
  return normalizeAnswer(value) === normalizeAnswer(configured);
}

export function parseGender(value: string, keywords: AnswerKeywords): NounGender | null {
  if (keywordMatches(value, keywords.masculine)) return "masculine";
  if (keywordMatches(value, keywords.feminine)) return "feminine";
  return null;
}

export function parseNumberMode(value: string, keywords: AnswerKeywords): NounNumberMode | null {
  if (keywordMatches(value, keywords.singularOnly)) return "singular";
  if (keywordMatches(value, keywords.pluralOnly)) return "plural";
  return null;
}

export function parseNounMarkers(parts: string[], keywords: AnswerKeywords) {
  let index = 0;
  let gender: NounGender | null = null;
  let numberMode: NounNumberMode | null = null;
  const markers: Array<{ kind: "gender" | "number"; value: string }> = [];

  while (index < parts.length && markers.length < 2) {
    const token = parts[index] ?? "";
    const parsedGender = parseGender(token, keywords);
    if (parsedGender) {
      if (gender) return { gender, numberMode, markers, rest: parts.slice(index), invalid: true };
      gender = parsedGender;
      markers.push({ kind: "gender", value: parsedGender });
      index += 1;
      continue;
    }
    const parsedNumber = parseNumberMode(token, keywords);
    if (parsedNumber) {
      if (numberMode) return { gender, numberMode, markers, rest: parts.slice(index), invalid: true };
      numberMode = parsedNumber;
      markers.push({ kind: "number", value: parsedNumber });
      index += 1;
      continue;
    }
    break;
  }

  const nextToken = parts[index] ?? "";
  if (parseGender(nextToken, keywords) || parseNumberMode(nextToken, keywords)) {
    return { gender, numberMode, markers, rest: parts.slice(index), invalid: true };
  }
  return { gender, numberMode, markers, rest: parts.slice(index), invalid: false };
}

export function parseNounShorthandAnswer(value: string, keywords: AnswerKeywords) {
  let answer = value.normalize("NFC").trim().replace(/[’`]/g, "'").replace(/\s+/g, " ");
  let explicitGender: NounGender | null = null;
  const firstSpace = answer.search(/\s/);
  if (firstSpace > 0) {
    const possibleGender = answer.slice(0, firstSpace);
    explicitGender = parseGender(possibleGender, keywords);
    if (explicitGender) answer = answer.slice(firstSpace).trim();
  }

  let article = "";
  let singular = "";
  const elidedMatch = answer.match(/^(l'|un')(.+)$/i);
  const spacedMatch = answer.match(/^(il|lo|la|un|uno|una)\s+(.+)$/i);
  if (elidedMatch) [article, singular] = [elidedMatch[1].toLowerCase(), elidedMatch[2].trim()];
  else if (spacedMatch) [article, singular] = [spacedMatch[1].toLowerCase(), spacedMatch[2].trim()];
  else return null;

  const articleGender: NounGender | null = ["il", "lo", "un", "uno"].includes(article)
    ? "masculine"
    : ["la", "una", "un'"].includes(article) ? "feminine" : null;
  const gender = explicitGender ?? articleGender;
  if (!gender || (explicitGender && articleGender && explicitGender !== articleGender)) return null;
  return {
    article,
    singular,
    gender,
    articleKind: ["un", "uno", "una", "un'"].includes(article) ? "indefinite" as const : "definite" as const,
  };
}

export function standardAdjectivePattern(masculineSingular: string) {
  const word = masculineSingular.trim();
  const lower = word.toLocaleLowerCase("it-IT");
  if (lower.endsWith("o")) {
    const stem = word.slice(0, -1);
    return { masculineSingular: word, feminineSingular: `${stem}a`, masculinePlural: `${stem}i`, femininePlural: `${stem}e` };
  }
  if (lower.endsWith("e")) {
    const plural = `${word.slice(0, -1)}i`;
    return { masculineSingular: word, feminineSingular: word, masculinePlural: plural, femininePlural: plural };
  }
  return null;
}

export function cardSupportsStandardAdjectivePattern(card: Flashcard) {
  if (card.type !== "adjective") return false;
  const pattern = standardAdjectivePattern(card.details.masculineSingular || card.italian);
  return Boolean(pattern && verificationFields(card).every((field) => normalizeAnswer(pattern[field.key as keyof typeof pattern] ?? "") === normalizeAnswer(field.expected)));
}

export function genderIndicatedByArticles(articles: string[]): NounGender | null {
  const genders = new Set(articles.flatMap((article) => {
    const normalized = normalizeAnswer(article);
    if (["il", "lo", "i", "gli", "un", "uno"].includes(normalized)) return ["masculine" as const];
    if (["la", "le", "una", "un'"].includes(normalized)) return ["feminine" as const];
    return [];
  }));
  return genders.size === 1 ? [...genders][0] : null;
}

export function isDefinitePluralArticle(article: string) {
  return ["i", "gli", "le"].includes(normalizeAnswer(article));
}

export function whitespaceParts(value: string) {
  return (value.match(/"[^"]*"|\S+/g) ?? []).map((part) => {
    const unquoted = part.startsWith('"') && part.endsWith('"') ? part.slice(1, -1) : part;
    return unquoted === "-" || unquoted === "—" ? "" : unquoted;
  });
}

export function hasImplicitNounShape(value: string, keywords: AnswerKeywords) {
  const parts = whitespaceParts(value);
  const markerParse = parseNounMarkers(parts, keywords);
  const token = normalizeAnswer(markerParse.rest[0] ?? "");
  return markerParse.markers.length > 0
    || ["il", "lo", "la", "l'", "i", "gli", "le", "un", "uno", "una", "un'"].includes(token)
    || /^(?:l'|un').+/.test(token);
}

export function expandElidedArticleTokens(parts: string[]) {
  return parts.flatMap((part) => {
    const match = part.match(/^(l['’]|un['’])(.+)$/i);
    return match ? [match[1], match[2]] : [part];
  });
}

export function matchesExpected(actual: string[], expected: string[]) {
  return actual.length === expected.length && actual.every((value, index) => normalizeAnswer(value) === normalizeAnswer(expected[index] ?? ""));
}

export function verifyPowerAnswer(card: Flashcard, rawValue: string, keywords: AnswerKeywords) {
  const answer = rawValue.trim();
  const d = card.details;

  if (card.type === "noun") {
    const patterns = getActiveNounPatterns();
    const forms = resolvedNounForms(card, patterns);
    const pattern = nounPatternForCard(card, patterns);

    if (whitespaceParts(answer).length <= 3 && pattern?.syntax === "article-singular") {
      const parsed = parseNounShorthandAnswer(answer, keywords);
      if (parsed) {
        const expectedArticle = parsed.articleKind === "indefinite"
          ? forms.indefiniteArticle
          : forms.definiteSingularArticle;
        return parsed.gender === forms.gender
          && normalizeAnswer(parsed.article) === normalizeAnswer(expectedArticle)
          && normalizeAnswer(parsed.singular) === normalizeAnswer(forms.singular);
      }
    }

    const rawParts = whitespaceParts(answer);
    const markerParse = parseNounMarkers(rawParts, keywords);
    if (markerParse.invalid) return false;
    if (markerParse.gender && markerParse.gender !== forms.gender) return false;

    const expectsElidedArticle = [forms.definiteSingularArticle, forms.definitePluralArticle, forms.indefiniteArticle]
      .some((article) => /^(l|un)['’]$/i.test(article));
    const parts = expectsElidedArticle ? expandElidedArticleTokens(markerParse.rest) : markerParse.rest;

    if (markerParse.numberMode === "singular") {
      if (!forms.singular || forms.plural) return false;
      return matchesExpected(parts, [
        ...(forms.definiteSingularArticle ? [forms.definiteSingularArticle] : []),
        forms.singular,
        ...(forms.indefiniteArticle ? [forms.indefiniteArticle] : []),
      ]);
    }
    if (markerParse.numberMode === "plural") {
      if (forms.singular || !forms.plural) return false;
      return matchesExpected(parts, [
        ...(forms.definitePluralArticle ? [forms.definitePluralArticle] : []),
        forms.plural,
      ]);
    }
    if (!forms.singular && forms.plural && isDefinitePluralArticle(forms.definitePluralArticle)) {
      return matchesExpected(parts, [forms.definitePluralArticle, forms.plural]);
    }
    if (!forms.singular || !forms.plural) return false;
    return matchesExpected(parts, [
      ...(forms.definiteSingularArticle ? [forms.definiteSingularArticle] : []),
      forms.singular,
      ...(forms.definitePluralArticle ? [forms.definitePluralArticle] : []),
      forms.plural,
      ...(forms.indefiniteArticle ? [forms.indefiniteArticle] : []),
    ]);
  }

  if (card.type === "verb") {
    return matchesExpected(whitespaceParts(answer), [card.italian, d.io, d.tu, d.luiLei, d.noi, d.voi, d.loro, d.auxiliary, d.participle]);
  }

  if (card.type === "adverb") return normalizeAnswer(answer) === normalizeAnswer(card.italian);

  const adjectiveParts = whitespaceParts(answer);
  if (adjectiveParts.length === 1 && cardSupportsStandardAdjectivePattern(card)) {
    const pattern = standardAdjectivePattern(adjectiveParts[0]);
    return Boolean(pattern && verificationFields(card).every((field) => normalizeAnswer(pattern[field.key as keyof typeof pattern] ?? "") === normalizeAnswer(field.expected)));
  }
  return matchesExpected(adjectiveParts, [d.masculineSingular || card.italian, d.feminineSingular, d.masculinePlural, d.femininePlural]);
}

export function verificationFields(card: Flashcard): VerificationField[] {
  const d = card.details;
  if (card.type === "noun") {
    const forms = resolvedNounForms(card, getActiveNounPatterns());
    return [
      { key: "singular", label: "Singular noun", expected: forms.singular },
      { key: "plural", label: "Plural noun", expected: forms.plural },
      { key: "definiteSingularArticle", label: "Definite singular article", expected: forms.definiteSingularArticle },
      { key: "definitePluralArticle", label: "Definite plural article", expected: forms.definitePluralArticle },
      { key: "indefiniteArticle", label: "Indefinite article", expected: forms.indefiniteArticle },
    ].filter((field) => Boolean(field.expected));
  }
  if (card.type === "verb") {
    return [
      { key: "infinitive", label: "Infinitive", expected: card.italian },
      { key: "io", label: "io", expected: d.io },
      { key: "tu", label: "tu", expected: d.tu },
      { key: "luiLei", label: "lui / lei", expected: d.luiLei },
      { key: "noi", label: "noi", expected: d.noi },
      { key: "voi", label: "voi", expected: d.voi },
      { key: "loro", label: "loro", expected: d.loro },
      { key: "auxiliary", label: "Auxiliary", expected: d.auxiliary },
      { key: "participle", label: "Past participle", expected: d.participle },
    ];
  }
  if (card.type === "adverb") return [{ key: "form", label: "Adverb", expected: card.italian }];
  return [
    { key: "masculineSingular", label: "Masculine singular", expected: d.masculineSingular || card.italian },
    { key: "feminineSingular", label: "Feminine singular", expected: d.feminineSingular },
    { key: "masculinePlural", label: "Masculine plural", expected: d.masculinePlural },
    { key: "femininePlural", label: "Feminine plural", expected: d.femininePlural },
  ];
}
