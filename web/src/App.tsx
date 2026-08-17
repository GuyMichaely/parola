import { FormEvent, useEffect, useMemo, useState } from "react";
import { createCardStorage, readStorageEndpoint, readStorageMode, saveStorageEndpoint, saveStorageMode, type CardStorage, type CardType, type Flashcard, type StorageMode } from "./storage";

type ScopeMode = "all" | "only" | "exclude";
type PromptLanguage = "english" | "italian";
type PromptMode = PromptLanguage | "both";
type AnswerSyntaxMode = "universal" | "compact";

type AnswerKeywords = {
  noun: string;
  verb: string;
  adjective: string;
  adverb: string;
  masculine: string;
  feminine: string;
  singularOnly: string;
  pluralOnly: string;
};

type BatchRow = {
  id: string;
  english: string;
  gender: "masculine" | "feminine";
  singular: string;
  plural: string;
  definiteSingularArticle: string;
  definitePluralArticle: string;
  indefiniteArticle: string;
};

type VerbBatchRow = {
  id: string;
  english: string;
  infinitive: string;
  io: string;
  tu: string;
  luiLei: string;
  noi: string;
  voi: string;
  loro: string;
  auxiliary: "avere" | "essere";
  participle: string;
};

type AdjectiveBatchRow = {
  id: string;
  english: string;
  masculineSingular: string;
  feminineSingular: string;
  masculinePlural: string;
  femininePlural: string;
};

type AdverbBatchRow = {
  id: string;
  english: string;
  form: string;
};

type BatchDraft<Row> = {
  setName: string;
  tags: string;
  rows: Row[];
};

type SaveState = "idle" | "saving" | "saved" | "failed";

type StudyItem = {
  key: string;
  card: Flashcard;
  promptLanguage: PromptLanguage;
};

type StudyScopeOption = {
  key: string;
  label: string;
  kind: "type" | "set" | "deck" | "tag";
};

type VerificationField = {
  key: string;
  label: string;
  expected: string;
};

const typeLabels: Record<CardType, string> = {
  noun: "Noun",
  verb: "Verb",
  adjective: "Adjective",
  adverb: "Adverb",
};

const cardTypes: CardType[] = ["noun", "verb", "adjective", "adverb"];

const cardAdderTypeKey = "parola:card-adder:type:v1";
const deckTagPrefix = "__deck__:";
const answerKeywordsKey = "parola:answer-keywords:v1";
const defaultAnswerKeywords: AnswerKeywords = {
  noun: "n",
  verb: "v",
  adjective: "a",
  adverb: "adv",
  masculine: "m",
  feminine: "f",
  singularOnly: "sin",
  pluralOnly: "plu",
};

function answerKeyword(type: CardType, keywords: AnswerKeywords) {
  return type === "noun" ? keywords.noun : type === "verb" ? keywords.verb : type === "adjective" ? keywords.adjective : keywords.adverb;
}

function readAnswerKeywords(): AnswerKeywords {
  if (typeof window === "undefined") return defaultAnswerKeywords;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(answerKeywordsKey) ?? "{}") as Partial<AnswerKeywords>;
    return Object.fromEntries(Object.entries(defaultAnswerKeywords).map(([key, fallback]) => {
      const stored = parsed[key as keyof AnswerKeywords];
      return [key, typeof stored === "string" && stored.trim() ? stored.trim() : fallback];
    })) as AnswerKeywords;
  } catch {
    return defaultAnswerKeywords;
  }
}

function writeAnswerKeywords(keywords: AnswerKeywords) {
  try {
    window.localStorage.setItem(answerKeywordsKey, JSON.stringify(keywords));
  } catch {
    // Keyword customization is optional; verification still works with the current in-memory values.
  }
}

function cardAdderDraftKey(type: CardType) {
  return `parola:card-adder:${type}:v1`;
}

function readCardAdderType(): CardType {
  if (typeof window === "undefined") return "noun";
  try {
    const stored = window.localStorage.getItem(cardAdderTypeKey);
    return cardTypes.includes(stored as CardType) ? stored as CardType : "noun";
  } catch {
    return "noun";
  }
}

function readBatchDraft<Row>(type: CardType, createRows: () => Row[]): BatchDraft<Row> {
  const fallback = { setName: "", tags: "", rows: createRows() };
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(cardAdderDraftKey(type));
    if (!stored) return fallback;
    const parsed = JSON.parse(stored) as Partial<BatchDraft<Row>>;
    return {
      setName: typeof parsed.setName === "string" ? parsed.setName : "",
      tags: typeof parsed.tags === "string" ? parsed.tags : "",
      rows: Array.isArray(parsed.rows) && parsed.rows.length ? parsed.rows : createRows(),
    };
  } catch {
    return fallback;
  }
}

function clearBatchDraft(type: CardType) {
  try {
    window.localStorage.removeItem(cardAdderDraftKey(type));
  } catch {
    // Draft persistence is a convenience; saving cards must still work if storage is unavailable.
  }
}

function writeBatchDraft<Row>(type: CardType, draft: BatchDraft<Row>) {
  try {
    window.localStorage.setItem(cardAdderDraftKey(type), JSON.stringify(draft));
  } catch {
    // Keep the editor usable when the browser blocks or exhausts local storage.
  }
}

function writeCardAdderType(type: CardType) {
  try {
    window.localStorage.setItem(cardAdderTypeKey, type);
  } catch {
    // Keep the editor usable when the browser blocks local storage.
  }
}

let nextRowId = 0;

function newRowId() {
  nextRowId += 1;
  return `${Date.now()}-${nextRowId}`;
}

function joinArticle(article: string, noun: string) {
  const cleanArticle = article.trim();
  const cleanNoun = noun.trim();
  if (!cleanArticle) return cleanNoun;
  return cleanArticle.endsWith("’") || cleanArticle.endsWith("'")
    ? `${cleanArticle}${cleanNoun}`
    : `${cleanArticle} ${cleanNoun}`;
}

function parseTags(value: string) {
  return Array.from(new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean)));
}

function visibleTags(tags: string[]) {
  return tags.filter((tag) => !tag.startsWith(deckTagPrefix));
}

function deckName(tag: string) {
  return tag.startsWith(deckTagPrefix) ? tag.slice(deckTagPrefix.length) : null;
}

function localDateStamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function inferArticle(fullForm: string | undefined, noun: string | undefined, fallback: string) {
  if (!fullForm || !noun) return fallback;
  if (fullForm.endsWith(noun)) {
    const article = fullForm.slice(0, -noun.length).trim();
    return article || fallback;
  }
  return fallback;
}

function normalizeAnswer(value: string) {
  return value
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase("it-IT")
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ");
}

type NounGender = "masculine" | "feminine";

function standardNounPattern(singular: string, gender: NounGender) {
  const word = singular.trim();
  if (!word) return null;
  const lower = word.toLocaleLowerCase("it-IT");
  let plural = "";
  if (lower.endsWith("a")) {
    if (gender === "feminine" && lower.endsWith("ca")) plural = `${word.slice(0, -2)}che`;
    else if (gender === "feminine" && lower.endsWith("ga")) plural = `${word.slice(0, -2)}ghe`;
    else plural = `${word.slice(0, -1)}${gender === "feminine" ? "e" : "i"}`;
  } else if (lower.endsWith("o") || lower.endsWith("e")) {
    plural = `${word.slice(0, -1)}i`;
  } else {
    return null;
  }
  const beginsWithVowel = /^[aeiouàèéìòóù]/i.test(lower);
  const takesLo = /^(z|x|y|gn|pn|ps|s[^aeiouàèéìòóù])/i.test(lower);
  const definiteSingularArticle = gender === "feminine" ? (beginsWithVowel ? "l’" : "la") : beginsWithVowel ? "l’" : takesLo ? "lo" : "il";
  const definitePluralArticle = gender === "feminine" ? "le" : (beginsWithVowel || takesLo ? "gli" : "i");
  const indefiniteArticle = gender === "feminine" ? (beginsWithVowel ? "un’" : "una") : (takesLo ? "uno" : "un");
  return { singular: word, plural, definiteSingularArticle, definitePluralArticle, indefiniteArticle };
}

function keywordMatches(value: string, configured: string, _aliases: string[] = []) {
  return normalizeAnswer(value) === normalizeAnswer(configured);
}

function parseRegularNounAnswer(value: string, keywords: AnswerKeywords) {
  let answer = value.normalize("NFC").trim().replace(/[’`]/g, "'").replace(/\s+/g, " ");
  let explicitGender: NounGender | null = null;
  const firstSpace = answer.search(/\s/);
  if (firstSpace > 0) {
    const possibleGender = answer.slice(0, firstSpace);
    if (keywordMatches(possibleGender, keywords.masculine, ["masculine"])) explicitGender = "masculine";
    else if (keywordMatches(possibleGender, keywords.feminine, ["feminine"])) explicitGender = "feminine";
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

function cardSupportsStandardNounPattern(card: Flashcard) {
  if (card.type !== "noun") return false;
  const gender = card.details.gender === "feminine" ? "feminine" : "masculine";
  const singular = card.details.singular ?? card.italian;
  if (!singular || !card.details.plural || !card.details.definiteSingularArticle || !card.details.definitePluralArticle || !card.details.indefiniteArticle) return false;
  const pattern = standardNounPattern(singular, gender);
  if (!pattern) return false;
  return verificationFields(card).every((field) => normalizeAnswer(pattern[field.key as keyof typeof pattern] ?? "") === normalizeAnswer(field.expected));
}

function standardAdjectivePattern(masculineSingular: string) {
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

function cardSupportsStandardAdjectivePattern(card: Flashcard) {
  if (card.type !== "adjective") return false;
  const pattern = standardAdjectivePattern(card.details.masculineSingular || card.italian);
  return Boolean(pattern && verificationFields(card).every((field) => normalizeAnswer(pattern[field.key as keyof typeof pattern] ?? "") === normalizeAnswer(field.expected)));
}

function parseGender(value: string, keywords: AnswerKeywords): NounGender | null {
  if (keywordMatches(value, keywords.masculine, ["masculine"])) return "masculine";
  if (keywordMatches(value, keywords.feminine, ["feminine"])) return "feminine";
  return null;
}

function genderIndicatedByArticles(articles: string[]): NounGender | null {
  const genders = new Set(articles.flatMap((article) => {
    const normalized = normalizeAnswer(article);
    if (["il", "lo", "i", "gli", "un", "uno"].includes(normalized)) return ["masculine" as const];
    if (["la", "le", "una", "un'"].includes(normalized)) return ["feminine" as const];
    return [];
  }));
  return genders.size === 1 ? [...genders][0] : null;
}

function isDefinitePluralArticle(article: string) {
  return ["i", "gli", "le"].includes(normalizeAnswer(article));
}

function parsePowerAnswerPrefix(value: string, keywords: AnswerKeywords) {
  const match = value.trim().match(/^(\S+)(?:\s*:\s*|\s+)([\s\S]*)$/);
  if (!match) return null;
  const token = match[1];
  const type: CardType | null = keywordMatches(token, keywords.noun, ["noun"])
    ? "noun"
    : keywordMatches(token, keywords.verb, ["verb"])
      ? "verb"
      : keywordMatches(token, keywords.adjective, ["adj", "adjective"])
        ? "adjective"
        : keywordMatches(token, keywords.adverb, ["adverb"])
          ? "adverb"
        : null;
  return type ? { type, answer: match[2].trim() } : null;
}

function whitespaceParts(value: string) {
  return (value.match(/"[^"]*"|\S+/g) ?? []).map((part) => {
    const unquoted = part.startsWith('"') && part.endsWith('"') ? part.slice(1, -1) : part;
    return unquoted === "-" || unquoted === "—" ? "" : unquoted;
  });
}

function hasImplicitNounShape(value: string, keywords: AnswerKeywords) {
  const parts = whitespaceParts(value);
  let index = 0;
  const hasGender = Boolean(parseGender(parts[index] ?? "", keywords));
  if (hasGender) index += 1;
  const hasNumber = keywordMatches(parts[index] ?? "", keywords.singularOnly, ["s", "sin"])
    || keywordMatches(parts[index] ?? "", keywords.pluralOnly, ["p", "plu"]);
  if (hasNumber) index += 1;
  const token = normalizeAnswer(parts[index] ?? "");
  return (hasGender && hasNumber)
    || ["il", "lo", "la", "l'", "i", "gli", "le", "un", "uno", "una", "un'"].includes(token)
    || /^(?:l'|un').+/.test(token);
}

function expandElidedArticleTokens(parts: string[]) {
  return parts.flatMap((part) => {
    const match = part.match(/^(l['’]|un['’])(.+)$/i);
    return match ? [match[1], match[2]] : [part];
  });
}

function matchesExpected(actual: string[], expected: string[]) {
  return actual.length === expected.length && actual.every((value, index) => normalizeAnswer(value) === normalizeAnswer(expected[index] ?? ""));
}

function shuffled<T>(items: T[], seed: number) {
  const result = [...items];
  let state = seed >>> 0 || 1;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const swapIndex = state % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function withEnglishPromptFirst(items: StudyItem[]) {
  const result = [...items];
  const positions = new Map<number, Partial<Record<PromptLanguage, number>>>();
  result.forEach((item, index) => {
    positions.set(item.card.id, { ...positions.get(item.card.id), [item.promptLanguage]: index });
  });
  positions.forEach(({ english, italian }) => {
    if (english !== undefined && italian !== undefined && english > italian) {
      [result[english], result[italian]] = [result[italian], result[english]];
    }
  });
  return result;
}

function verifyPowerAnswer(card: Flashcard, rawValue: string, syntaxMode: AnswerSyntaxMode, keywords: AnswerKeywords) {
  const prefixed = parsePowerAnswerPrefix(rawValue, keywords);
  const implicitNoun = !prefixed && hasImplicitNounShape(rawValue, keywords);
  if (syntaxMode === "universal" && !prefixed && !implicitNoun) return false;
  if (prefixed && prefixed.type !== card.type) return false;
  if (implicitNoun && card.type !== "noun") return false;
  const answer = prefixed?.answer ?? rawValue.trim();
  const d = card.details;

  if (card.type === "noun") {
    const singular = d.singular ?? card.italian;

    if (whitespaceParts(answer).length <= 3 && cardSupportsStandardNounPattern(card)) {
      const parsed = parseRegularNounAnswer(answer, keywords);
      if (parsed) {
        const pattern = standardNounPattern(parsed.singular, parsed.gender);
        const expectedGender = d.gender === "feminine" ? "feminine" : "masculine";
        const expectedArticle = parsed.articleKind === "indefinite" ? pattern?.indefiniteArticle : pattern?.definiteSingularArticle;
        return Boolean(pattern && parsed.gender === expectedGender && normalizeAnswer(parsed.article) === normalizeAnswer(expectedArticle ?? "") && verificationFields(card).every((field) => normalizeAnswer(pattern[field.key as keyof typeof pattern] ?? "") === normalizeAnswer(field.expected)));
      }
    }

    const rawParts = whitespaceParts(answer);
    const expectedGender = d.gender === "feminine" ? "feminine" : "masculine";
    const plural = d.plural ?? "";
    const definiteSingularArticle = d.definiteSingularArticle || inferArticle(d.definiteSingular, singular, "");
    const definitePluralArticle = d.definitePluralArticle || inferArticle(d.definitePlural, plural, "");
    const indefiniteArticle = d.indefiniteArticle || inferArticle(d.indefinite, singular, "");
    const explicitGender = parseGender(rawParts[0] ?? "", keywords);
    if (explicitGender && explicitGender !== expectedGender) return false;
    if (!explicitGender && genderIndicatedByArticles([definiteSingularArticle, definitePluralArticle, indefiniteArticle]) !== expectedGender) return false;

    const expectsElidedArticle = [definiteSingularArticle, definitePluralArticle, indefiniteArticle].some((article) => /^(l|un)['’]$/i.test(article));
    const answerParts = explicitGender ? rawParts.slice(1) : rawParts;
    const parts = expectsElidedArticle ? expandElidedArticleTokens(answerParts) : answerParts;

    if (keywordMatches(parts[0] ?? "", keywords.singularOnly, ["s", "sin"])) {
      if (!singular || plural) return false;
      return matchesExpected(parts.slice(1), [
        ...(definiteSingularArticle ? [definiteSingularArticle] : []),
        singular,
        ...(indefiniteArticle ? [indefiniteArticle] : []),
      ]);
    }
    if (keywordMatches(parts[0] ?? "", keywords.pluralOnly, ["p", "plu"])) {
      if (singular || !plural) return false;
      return matchesExpected(parts.slice(1), [
        ...(definitePluralArticle ? [definitePluralArticle] : []),
        plural,
      ]);
    }
    if (!singular && plural && isDefinitePluralArticle(definitePluralArticle)) {
      return matchesExpected(parts, [definitePluralArticle, plural]);
    }
    if (!singular || !plural) return false;
    return matchesExpected(parts, [
      ...(definiteSingularArticle ? [definiteSingularArticle] : []),
      singular,
      ...(definitePluralArticle ? [definitePluralArticle] : []),
      plural,
      ...(indefiniteArticle ? [indefiniteArticle] : []),
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

function verificationFields(card: Flashcard): VerificationField[] {
  const d = card.details;
  if (card.type === "noun") {
    const singular = d.singular === undefined ? card.italian : d.singular;
    return [
      { key: "singular", label: "Singular noun", expected: singular },
      { key: "plural", label: "Plural noun", expected: d.plural },
      { key: "definiteSingularArticle", label: "Definite singular article", expected: d.definiteSingularArticle || inferArticle(d.definiteSingular, singular, "") },
      { key: "definitePluralArticle", label: "Definite plural article", expected: d.definitePluralArticle || inferArticle(d.definitePlural, d.plural, "") },
      { key: "indefiniteArticle", label: "Indefinite article", expected: d.indefiniteArticle || inferArticle(d.indefinite, singular, "") },
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

function emptyBatchRow(id: string): BatchRow {
  return {
    id,
    english: "",
    gender: "masculine",
    singular: "",
    plural: "",
    definiteSingularArticle: "",
    definitePluralArticle: "",
    indefiniteArticle: "",
  };
}

function nounFormsError(input: Pick<BatchRow, "singular" | "plural" | "definiteSingularArticle" | "definitePluralArticle" | "indefiniteArticle">) {
  const singular = Boolean(input.singular.trim());
  const plural = Boolean(input.plural.trim());
  const definiteSingular = Boolean(input.definiteSingularArticle.trim());
  const definitePlural = Boolean(input.definitePluralArticle.trim());
  const indefinite = Boolean(input.indefiniteArticle.trim());
  if (!singular && !plural) return "Enter at least a singular or plural form.";
  if (!singular && (definiteSingular || indefinite)) return "Singular articles require a singular noun form.";
  if (!plural && definitePlural) return "A definite plural article requires a plural noun form.";
  return "";
}

function emptyVerbBatchRow(id: string): VerbBatchRow {
  return {
    id,
    english: "",
    infinitive: "",
    io: "",
    tu: "",
    luiLei: "",
    noi: "",
    voi: "",
    loro: "",
    auxiliary: "avere",
    participle: "",
  };
}

function emptyAdjectiveBatchRow(id: string): AdjectiveBatchRow {
  return {
    id,
    english: "",
    masculineSingular: "",
    feminineSingular: "",
    masculinePlural: "",
    femininePlural: "",
  };
}

function emptyAdverbBatchRow(id: string): AdverbBatchRow {
  return { id, english: "", form: "" };
}

function nounCard(input: {
  id: number;
  english: string;
  setName: string | null;
  tags: string[];
  gender: string;
  singular: string;
  plural: string;
  definiteSingularArticle: string;
  definitePluralArticle: string;
  indefiniteArticle: string;
}): Flashcard {
  const definiteSingular = joinArticle(input.definiteSingularArticle, input.singular);
  const definitePlural = joinArticle(input.definitePluralArticle, input.plural);
  const indefinite = joinArticle(input.indefiniteArticle, input.singular);
  return {
    id: input.id,
    type: "noun",
    english: input.english,
    italian: input.singular || input.plural,
    setName: input.setName,
    tags: input.tags,
    details: {
      gender: input.gender,
      singular: input.singular,
      plural: input.plural,
      definiteSingularArticle: input.definiteSingularArticle,
      definitePluralArticle: input.definitePluralArticle,
      indefiniteArticle: input.indefiniteArticle,
      definiteSingular,
      definitePlural,
      indefinite,
    },
  };
}

function verbCard(input: Omit<VerbBatchRow, "id"> & { id: number; setName: string | null; tags: string[] }): Flashcard {
  return {
    id: input.id,
    type: "verb",
    english: input.english,
    italian: input.infinitive,
    setName: input.setName,
    tags: input.tags,
    details: {
      io: input.io,
      tu: input.tu,
      luiLei: input.luiLei,
      noi: input.noi,
      voi: input.voi,
      loro: input.loro,
      auxiliary: input.auxiliary,
      participle: input.participle,
    },
  };
}

function adjectiveCard(input: Omit<AdjectiveBatchRow, "id"> & { id: number; setName: string | null; tags: string[] }): Flashcard {
  return {
    id: input.id,
    type: "adjective",
    english: input.english,
    italian: input.masculineSingular,
    setName: input.setName,
    tags: input.tags,
    details: {
      masculineSingular: input.masculineSingular,
      feminineSingular: input.feminineSingular,
      masculinePlural: input.masculinePlural,
      femininePlural: input.femininePlural,
    },
  };
}

function adverbCard(input: Omit<AdverbBatchRow, "id"> & { id: number; setName: string | null; tags: string[] }): Flashcard {
  return { id: input.id, type: "adverb", english: input.english, italian: input.form, setName: input.setName, tags: input.tags, details: {} };
}

function NounAnswer({ card }: { card: Flashcard }) {
  const d = card.details;
  const singular = d.singular === undefined ? card.italian : d.singular;
  const plural = d.plural ?? "";
  const definiteSingularArticle = d.definiteSingularArticle || inferArticle(d.definiteSingular, singular, "");
  const definitePluralArticle = d.definitePluralArticle || inferArticle(d.definitePlural, plural, "");
  const indefiniteArticle = d.indefiniteArticle || inferArticle(d.indefinite, singular, "");
  const hasArticles = Boolean(definiteSingularArticle || definitePluralArticle || indefiniteArticle);
  return (
    <div className="answer-content">
      <span className="answer-label">Italian · {d.gender}</span>
      <h2>{singular || plural || card.italian}</h2>
      {hasArticles && <table className="noun-forms-table">
        <thead><tr><th>Form</th><th>Article</th><th>Word</th></tr></thead>
        <tbody>
          {singular && definiteSingularArticle && <tr><td>Definite singular</td><td>{definiteSingularArticle}</td><td>{singular}</td></tr>}
          {plural && definitePluralArticle && <tr><td>Definite plural</td><td>{definitePluralArticle}</td><td>{plural}</td></tr>}
          {singular && indefiniteArticle && <tr><td>Indefinite</td><td>{indefiniteArticle}</td><td>{singular}</td></tr>}
        </tbody>
      </table>}
      {!hasArticles && <p className="noun-article-note">No stored articles</p>}
    </div>
  );
}

function VerbAnswer({ card }: { card: Flashcard }) {
  const d = card.details;
  return (
    <div className="answer-content compact-answer">
      <span className="answer-label">Italian · present tense</span>
      <h2>{card.italian}</h2>
      <div className="conjugation-grid">
        {[["io", d.io], ["tu", d.tu], ["lui / lei", d.luiLei], ["noi", d.noi], ["voi", d.voi], ["loro", d.loro]].map(([label, value]) => (
          <div key={label}><span>{label}</span><strong>{value}</strong></div>
        ))}
      </div>
      <p className="verb-extra">auxiliary <strong>{d.auxiliary}</strong> · participle <strong>{d.participle}</strong></p>
    </div>
  );
}

function AdjectiveAnswer({ card }: { card: Flashcard }) {
  const d = card.details;
  return (
    <div className="answer-content">
      <span className="answer-label">Italian · adjective</span>
      <h2>{card.italian}</h2>
      <div className="noun-answer-grid">
        <div><span>Masculine singular</span><strong>{d.masculineSingular}</strong></div>
        <div><span>Feminine singular</span><strong>{d.feminineSingular}</strong></div>
        <div><span>Masculine plural</span><strong>{d.masculinePlural}</strong></div>
        <div><span>Feminine plural</span><strong>{d.femininePlural}</strong></div>
      </div>
    </div>
  );
}

function AdverbAnswer({ card }: { card: Flashcard }) {
  return <div className="answer-content"><span className="answer-label">Italian · adverb</span><h2>{card.italian}</h2><p className="noun-article-note">Invariant</p></div>;
}

function CardAnswer({ card }: { card: Flashcard }) {
  if (card.type === "noun") return <NounAnswer card={card} />;
  if (card.type === "verb") return <VerbAnswer card={card} />;
  if (card.type === "adverb") return <AdverbAnswer card={card} />;
  return <AdjectiveAnswer card={card} />;
}

function ItalianPrompt({ card }: { card: Flashcard }) {
  return (
    <div className="question-content">
      <span className="answer-label">Italian</span>
      <h2>{card.type === "noun" ? card.details.singular || card.italian : card.italian}</h2>
    </div>
  );
}

function EnglishAnswer({ card, showType = false }: { card: Flashcard; showType?: boolean }) {
  return (
    <div className="answer-content english-answer">
      <span className="answer-label">English{showType ? ` · ${typeLabels[card.type]}` : ""}</span>
      <h2>{card.english}</h2>
    </div>
  );
}

function ItalianVerificationForm({ card, syntaxMode, compactType, keywords, onResult }: { card: Flashcard; syntaxMode: AnswerSyntaxMode; compactType: CardType | null; keywords: AnswerKeywords; onResult: (correct: boolean, answer: string) => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const answer = String(data.get("powerAnswer") ?? "");
    onResult(verifyPowerAnswer(card, answer, syntaxMode, keywords), answer);
  }

  const compactLabel = compactType ? `${typeLabels[compactType]} mode` : "Compact mode";
  const placeholder = syntaxMode === "universal"
    ? `il libro  ·  ${keywords.verb} parlare parlo …  ·  ${keywords.adjective} bello bella …  ·  ${keywords.adverb} molto`
    : compactType === "noun" ? `i vestiti  or  ${keywords.feminine} ${keywords.singularOnly} Venezia`
      : compactType === "verb" ? "parlare parlo parli parla …"
        : compactType === "adjective" ? "bello  or  bello bella belli belle"
          : "molto";

  return (
    <form className="verification-form power-verification-form" onSubmit={submit}>
      <div className="verification-heading">
        <span className="answer-label">Type the Italian</span>
        <p>{syntaxMode === "universal" ? `Start with ${keywords.noun}, ${keywords.verb}, ${keywords.adjective}, or ${keywords.adverb}. A noun answer beginning with an article or gender/number markers may omit ${keywords.noun}.` : `${compactLabel} is on, so the part-of-speech prefix is optional.`}</p>
      </div>
      <label className="power-answer-field"><span>Answer</span><input name="powerAnswer" required autoComplete="off" autoCapitalize="none" spellCheck={false} autoFocus placeholder={placeholder} /></label>
      <details className="answer-syntax-help">
        <summary>Answer format</summary>
        <div>
          <p><strong>Noun:</strong> omit <code>{keywords.noun}</code> when an article or gender/number markers identify the noun format. Full: <code>il libro i libri un</code> or <code>l’entrata le entrate un’</code>. Plural-only: <code>i vestiti</code>. Articleless singular-only: <code>{keywords.feminine} {keywords.singularOnly} Venezia</code>. An ambiguous article also needs gender: <code>{keywords.feminine} {keywords.singularOnly} l’Aquila</code>.</p>
          <p><strong>Verb:</strong> <code>{keywords.verb} infinitive io tu lui/lei noi voi loro auxiliary participle</code>.</p>
          <p><strong>Adjective:</strong> regular shorthand <code>{keywords.adjective} bello</code>, or full <code>{keywords.adjective} bello bella belli belle</code>.</p>
          <p><strong>Adverb:</strong> invariant form <code>{keywords.adverb} molto</code>.</p>
          <p>Separate fields with spaces. Wrap a multi-word field in double quotes.</p>
          {syntaxMode === "compact" && compactType && <p>In {compactLabel}, omit the <code>{answerKeyword(compactType, keywords)}</code> prefix.</p>}
        </div>
      </details>
      <button className="primary-button check-answer-button" type="submit">Check answer</button>
    </form>
  );
}

function AnswerKeywordSettings({ keywords, onChange }: { keywords: AnswerKeywords; onChange: (keywords: AnswerKeywords) => void }) {
  const [draft, setDraft] = useState(keywords);
  const [message, setMessage] = useState("");
  const fields: { key: keyof AnswerKeywords; label: string }[] = [
    { key: "noun", label: "Noun" },
    { key: "verb", label: "Verb" },
    { key: "adjective", label: "Adjective" },
    { key: "adverb", label: "Adverb" },
    { key: "masculine", label: "Masculine" },
    { key: "feminine", label: "Feminine" },
    { key: "singularOnly", label: "Singular-only" },
    { key: "pluralOnly", label: "Plural-only" },
  ];

  function applyKeywords() {
    const normalized = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim().toLocaleLowerCase("it-IT")])) as AnswerKeywords;
    const values = Object.values(normalized);
    if (values.some((value) => !value || /\s|[|:"]/u.test(value))) {
      setMessage("Each keyword must be one non-empty token without spaces or punctuation separators.");
      return;
    }
    if (new Set(values).size !== values.length) {
      setMessage("Each keyword must be different.");
      return;
    }
    onChange(normalized);
    setDraft(normalized);
    setMessage("Applied and saved on this device.");
  }

  function resetKeywords() {
    setDraft(defaultAnswerKeywords);
    onChange(defaultAnswerKeywords);
    setMessage("Defaults restored.");
  }

  return <details className="keyword-settings">
    <summary>Answer keywords</summary>
    <div className="keyword-settings-body">
      <p>Customize the short tokens used by type-to-verify. Changes apply to new answers immediately.</p>
      <div className="keyword-grid">
        {fields.map((field) => <label key={field.key}><span>{field.label}</span><input value={draft[field.key]} onChange={(event) => { setDraft((current) => ({ ...current, [field.key]: event.target.value })); setMessage(""); }} autoCapitalize="none" spellCheck={false} /></label>)}
      </div>
      {message && <p className="keyword-message" role="status">{message}</p>}
      <div className="keyword-actions"><button type="button" className="text-button" onClick={resetKeywords}>Restore defaults</button><button type="button" className="neutral-button" onClick={applyKeywords}>Apply keywords</button></div>
    </div>
  </details>;
}

function StudyOptions({
  promptMode,
  onPromptMode,
  typeToVerify,
  onTypeToVerify,
  oneDirectionPerWord,
  onOneDirectionPerWord,
  englishFirstWhenBoth,
  onEnglishFirstWhenBoth,
  homogeneousType,
  compactAnswers,
  onCompactAnswers,
  answerKeywords,
  onAnswerKeywords,
}: {
  promptMode: PromptMode;
  onPromptMode: (mode: PromptMode) => void;
  typeToVerify: boolean;
  onTypeToVerify: () => void;
  oneDirectionPerWord: boolean;
  onOneDirectionPerWord: () => void;
  englishFirstWhenBoth: boolean;
  onEnglishFirstWhenBoth: () => void;
  homogeneousType: CardType | null;
  compactAnswers: boolean;
  onCompactAnswers: () => void;
  answerKeywords: AnswerKeywords;
  onAnswerKeywords: (keywords: AnswerKeywords) => void;
}) {
  return (
    <section className="study-options" aria-label="Study options">
      <label className="study-option-select">
        <span>Prompt in</span>
        <select value={promptMode} onChange={(event) => onPromptMode(event.target.value as PromptMode)}>
          <option value="english">English</option>
          <option value="italian">Italian</option>
          <option value="both">Both languages</option>
        </select>
      </label>
      <label className="switch-option">
        <input type="checkbox" checked={typeToVerify} onChange={onTypeToVerify} />
        <span><strong>Type to verify</strong><small>Checks Italian answers automatically</small></span>
      </label>
      {promptMode === "both" && (
        <label className="study-option-select direction-choice">
          <span>For each word</span>
          <select value={oneDirectionPerWord ? "one" : "both"} onChange={onOneDirectionPerWord}>
            <option value="both">Prompt in both directions</option>
            <option value="one">Prompt in one mixed direction</option>
          </select>
        </label>
      )}
      {promptMode === "both" && !oneDirectionPerWord && <label className="switch-option">
        <input type="checkbox" checked={englishFirstWhenBoth} onChange={onEnglishFirstWhenBoth} />
        <span><strong>English first</strong><small>Show each word’s English prompt before its Italian prompt</small></span>
      </label>}
      {typeToVerify && promptMode !== "italian" && homogeneousType && <label className="switch-option compact-mode-option">
        <input type="checkbox" checked={compactAnswers} onChange={onCompactAnswers} />
        <span><strong>{typeLabels[homogeneousType]} mode</strong><small>All cards in this scope are {typeLabels[homogeneousType].toLowerCase()}s; omit the {answerKeyword(homogeneousType, answerKeywords)} prefix</small></span>
      </label>}
      {typeToVerify && promptMode !== "italian" && <AnswerKeywordSettings keywords={answerKeywords} onChange={onAnswerKeywords} />}
    </section>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  const label = state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Save failed";
  return <div className={`save-indicator ${state}`} role="status" aria-live="polite"><i />{label}</div>;
}

function SetField({
  knownSets,
  initialSet = "",
  value,
  onChange,
}: {
  knownSets: string[];
  initialSet?: string;
  value?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <label className="field set-field">
      <span>Lesson / unit set <em>optional</em></span>
      <input
        name="setName"
        list="known-card-sets"
        placeholder="e.g. Unit 2 · Food"
        autoComplete="off"
        {...(value === undefined ? { defaultValue: initialSet } : { value, onChange: (event) => onChange?.(event.target.value) })}
      />
      <datalist id="known-card-sets">
        {knownSets.map((name) => <option key={name} value={name} />)}
      </datalist>
    </label>
  );
}

function TagsField({
  initialTags = [],
  value,
  onChange,
}: {
  initialTags?: string[];
  value?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <label className="field tags-field">
      <span>Tags <em>comma separated</em></span>
      <input
        name="tags"
        placeholder="travel, review, food"
        {...(value === undefined ? { defaultValue: initialTags.join(", ") } : { value, onChange: (event) => onChange?.(event.target.value) })}
      />
    </label>
  );
}

function nounRowFromCard(card: Flashcard): BatchRow {
  const d = card.details;
  const singular = d.singular ?? card.italian;
  const plural = d.plural ?? "";
  return {
    id: String(card.id),
    english: card.english,
    gender: d.gender === "feminine" ? "feminine" : "masculine",
    singular,
    plural,
    definiteSingularArticle: singular ? (d.definiteSingularArticle ?? inferArticle(d.definiteSingular, singular, "")) : "",
    definitePluralArticle: plural ? (d.definitePluralArticle ?? inferArticle(d.definitePlural, plural, "")) : "",
    indefiniteArticle: singular ? (d.indefiniteArticle ?? inferArticle(d.indefinite, singular, "")) : "",
  };
}

function verbRowFromCard(card: Flashcard): VerbBatchRow {
  return { id: String(card.id), english: card.english, infinitive: card.italian, io: card.details.io ?? "", tu: card.details.tu ?? "", luiLei: card.details.luiLei ?? "", noi: card.details.noi ?? "", voi: card.details.voi ?? "", loro: card.details.loro ?? "", auxiliary: card.details.auxiliary === "essere" ? "essere" : "avere", participle: card.details.participle ?? "" };
}

function adjectiveRowFromCard(card: Flashcard): AdjectiveBatchRow {
  return { id: String(card.id), english: card.english, masculineSingular: card.details.masculineSingular ?? card.italian, feminineSingular: card.details.feminineSingular ?? "", masculinePlural: card.details.masculinePlural ?? "", femininePlural: card.details.femininePlural ?? "" };
}

function adverbRowFromCard(card: Flashcard): AdverbBatchRow {
  return { id: String(card.id), english: card.english, form: card.italian };
}

function normalizeNounRow(row: BatchRow): BatchRow {
  const singular = row.singular ?? "";
  const plural = row.plural ?? "";
  return {
    id: row.id,
    english: row.english ?? "",
    gender: row.gender === "feminine" ? "feminine" : "masculine",
    singular,
    plural,
    definiteSingularArticle: !singular.trim() ? "" : (row.definiteSingularArticle ?? ""),
    definitePluralArticle: !plural.trim() ? "" : (row.definitePluralArticle ?? ""),
    indefiniteArticle: !singular.trim() ? "" : (row.indefiniteArticle ?? ""),
  };
}

function suggestedNounArticles(gender: BatchRow["gender"], singular: string, plural: string) {
  const startsWithVowel = (word: string) => /^[aeiouàèéìòóù]/u.test(normalizeAnswer(word));
  const takesLoSet = (word: string) => {
    const normalized = normalizeAnswer(word);
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

function updateNounRow<K extends keyof BatchRow>(row: BatchRow, field: K, value: BatchRow[K]) {
  if (field === "singular" || field === "plural" || field === "gender") {
    const previous = suggestedNounArticles(row.gender, row.singular, row.plural);
    const nextRow = { ...row, [field]: value } as BatchRow;
    const next = suggestedNounArticles(nextRow.gender, nextRow.singular, nextRow.plural);
    const keepOrSuggest = (current: string, previousSuggestion: string, nextSuggestion: string) => !current || current === previousSuggestion ? nextSuggestion : current;
    return {
      ...nextRow,
      definiteSingularArticle: nextRow.singular.trim() ? keepOrSuggest(row.definiteSingularArticle, previous.definiteSingularArticle, next.definiteSingularArticle) : "",
      definitePluralArticle: nextRow.plural.trim() ? keepOrSuggest(row.definitePluralArticle, previous.definitePluralArticle, next.definitePluralArticle) : "",
      indefiniteArticle: nextRow.singular.trim() ? keepOrSuggest(row.indefiniteArticle, previous.indefiniteArticle, next.indefiniteArticle) : "",
    };
  }
  return { ...row, [field]: value } as BatchRow;
}

function NounRowCells({ row, index, onChange, onRemove, autoFocus = false }: { row: BatchRow; index: number; onChange: <K extends keyof BatchRow>(field: K, value: BatchRow[K]) => void; onRemove?: () => void; autoFocus?: boolean }) {
  const singularDisabled = !row.singular.trim();
  const pluralDisabled = !row.plural.trim();
  return <>
    <td><input aria-label={`Row ${index + 1} English`} value={row.english} onChange={(e) => onChange("english", e.target.value)} placeholder="the book" autoFocus={autoFocus} /></td>
    <td><select aria-label={`Row ${index + 1} gender`} value={row.gender} onChange={(e) => onChange("gender", e.target.value as BatchRow["gender"])}><option value="masculine">M</option><option value="feminine">F</option></select></td>
    <td><input aria-label={`Row ${index + 1} singular`} value={row.singular} onChange={(e) => onChange("singular", e.target.value)} placeholder="libro" /></td>
    <td><input aria-label={`Row ${index + 1} plural`} value={row.plural} onChange={(e) => onChange("plural", e.target.value)} placeholder="libri" /></td>
    <td><select aria-label={`Row ${index + 1} definite singular article`} value={row.definiteSingularArticle} onChange={(e) => onChange("definiteSingularArticle", e.target.value)} disabled={singularDisabled}><option value="">None</option><option>il</option><option>lo</option><option>la</option><option>l’</option></select></td>
    <td><select aria-label={`Row ${index + 1} definite plural article`} value={row.definitePluralArticle} onChange={(e) => onChange("definitePluralArticle", e.target.value)} disabled={pluralDisabled}><option value="">None</option><option>i</option><option>gli</option><option>le</option></select></td>
    <td><select aria-label={`Row ${index + 1} indefinite article`} value={row.indefiniteArticle} onChange={(e) => onChange("indefiniteArticle", e.target.value)} disabled={singularDisabled}><option value="">None</option><option>un</option><option>uno</option><option>una</option><option>un’</option></select></td>
    {onRemove && <td><button type="button" className="row-remove" tabIndex={-1} onClick={onRemove} aria-label={`Remove row ${index + 1}`}>×</button></td>}
  </>;
}

function VerbRowCells({ row, index, onChange, onRemove, autoFocus = false }: { row: VerbBatchRow; index: number; onChange: (field: keyof VerbBatchRow, value: string) => void; onRemove?: () => void; autoFocus?: boolean }) {
  return <>
    <td><input aria-label={`Row ${index + 1} English`} value={row.english} onChange={(e) => onChange("english", e.target.value)} placeholder="to understand" autoFocus={autoFocus} /></td>
    <td><input aria-label={`Row ${index + 1} infinitive`} value={row.infinitive} onChange={(e) => onChange("infinitive", e.target.value)} placeholder="capire" /></td>
    {(["io", "tu", "luiLei", "noi", "voi", "loro"] as const).map((field) => <td key={field}><input aria-label={`Row ${index + 1} ${field === "luiLei" ? "lui or lei" : field}`} value={row[field]} onChange={(e) => onChange(field, e.target.value)} /></td>)}
    <td><select aria-label={`Row ${index + 1} auxiliary`} value={row.auxiliary} onChange={(e) => onChange("auxiliary", e.target.value)}><option value="avere">avere</option><option value="essere">essere</option></select></td>
    <td><input aria-label={`Row ${index + 1} past participle`} value={row.participle} onChange={(e) => onChange("participle", e.target.value)} placeholder="capito" /></td>
    {onRemove && <td><button type="button" className="row-remove" tabIndex={-1} onClick={onRemove} aria-label={`Remove row ${index + 1}`}>×</button></td>}
  </>;
}

function AdjectiveRowCells({ row, index, onChange, onRemove, autoFocus = false }: { row: AdjectiveBatchRow; index: number; onChange: (field: keyof AdjectiveBatchRow, value: string) => void; onRemove?: () => void; autoFocus?: boolean }) {
  return <>
    <td><input aria-label={`Row ${index + 1} English`} value={row.english} onChange={(e) => onChange("english", e.target.value)} placeholder="beautiful" autoFocus={autoFocus} /></td>
    {(["masculineSingular", "feminineSingular", "masculinePlural", "femininePlural"] as const).map((field) => <td key={field}><input aria-label={`Row ${index + 1} ${field}`} value={row[field]} onChange={(e) => onChange(field, e.target.value)} /></td>)}
    {onRemove && <td><button type="button" className="row-remove" tabIndex={-1} onClick={onRemove} aria-label={`Remove row ${index + 1}`}>×</button></td>}
  </>;
}

function AdverbRowCells({ row, index, onChange, onRemove, autoFocus = false }: { row: AdverbBatchRow; index: number; onChange: (field: keyof AdverbBatchRow, value: string) => void; onRemove?: () => void; autoFocus?: boolean }) {
  return <>
    <td><input aria-label={`Row ${index + 1} English`} value={row.english} onChange={(event) => onChange("english", event.target.value)} placeholder="very; a lot" autoFocus={autoFocus} /></td>
    <td><input aria-label={`Row ${index + 1} adverb`} value={row.form} onChange={(event) => onChange("form", event.target.value)} placeholder="molto" /></td>
    {onRemove && <td><button type="button" className="row-remove" tabIndex={-1} onClick={onRemove} aria-label={`Remove row ${index + 1}`}>×</button></td>}
  </>;
}

function BatchNouns({
  knownSets,
  saving,
  error,
  onSave,
  onCancel,
}: {
  knownSets: string[];
  saving: boolean;
  error: string;
  onSave: (cards: Flashcard[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<BatchDraft<BatchRow>>(() => {
    const stored = readBatchDraft("noun", () => Array.from({ length: 3 }, (_, index) => emptyBatchRow(String(index + 1))));
    return { ...stored, rows: stored.rows.map(normalizeNounRow) };
  });
  const [localError, setLocalError] = useState("");
  const rows = draft.rows;

  useEffect(() => {
    writeBatchDraft("noun", draft);
  }, [draft]);

  function updateRow<K extends keyof BatchRow>(id: string, field: K, value: BatchRow[K]) {
    setDraft((currentDraft) => {
      const updated = currentDraft.rows.map((row) => row.id === id ? updateNounRow(row, field, value) : row);
      const last = updated.at(-1);
      const nextRows = last && (last.english.trim() || last.singular.trim() || last.plural.trim())
        ? [...updated, emptyBatchRow(newRowId())]
        : updated;
      return { ...currentDraft, rows: nextRows };
    });
  }

  function removeRow(id: string) {
    setDraft((currentDraft) => ({ ...currentDraft, rows: currentDraft.rows.length === 1 ? currentDraft.rows : currentDraft.rows.filter((row) => row.id !== id) }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const setName = draft.setName.trim() || null;
    const tags = parseTags(draft.tags);
    const used = rows.filter((row) => row.english.trim() || row.singular.trim() || row.plural.trim());
    if (!used.length) {
      setLocalError("Enter at least one noun.");
      return;
    }
    if (used.some((row) => !row.english.trim())) {
      setLocalError("Each used row needs an English prompt.");
      return;
    }
    const formsError = used.map(nounFormsError).find(Boolean);
    if (formsError) {
      setLocalError(formsError);
      return;
    }
    setLocalError("");
    await onSave(used.map((row, index) => nounCard({
      ...row,
      id: Date.now() + index,
      english: row.english.trim(),
      singular: row.singular.trim(),
      plural: row.plural.trim(),
      setName,
      tags,
    })));
  }

  return (
    <form onSubmit={submit}>
      <SetField knownSets={knownSets} value={draft.setName} onChange={(setName) => setDraft((currentDraft) => ({ ...currentDraft, setName }))} />
      <TagsField value={draft.tags} onChange={(tags) => setDraft((currentDraft) => ({ ...currentDraft, tags }))} />
      <p className="batch-help">One noun per row. Articles are suggested from gender and spelling—including lo / gli / uno forms—and remain editable. Choose None when a stored form takes no article. Progress saves automatically on this device.</p>
      <div className="batch-table-wrap">
        <table className="batch-table">
          <thead><tr><th>English</th><th>Gender</th><th>Singular</th><th>Plural</th><th>Def. sg.</th><th>Def. pl.</th><th>Indef.</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={row.id}>
              <NounRowCells row={row} index={index} autoFocus={index === 0} onChange={(field, value) => updateRow(row.id, field, value)} onRemove={() => removeRow(row.id)} />
            </tr>)}
          </tbody>
        </table>
      </div>
      {(localError || error) && <p className="form-error" role="alert">{localError || error}</p>}
      <footer className="modal-actions">
        <button type="button" className="text-button" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add batch"}</button>
      </footer>
    </form>
  );
}

function BatchVerbs({
  knownSets,
  saving,
  error,
  onSave,
  onCancel,
}: {
  knownSets: string[];
  saving: boolean;
  error: string;
  onSave: (cards: Flashcard[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<BatchDraft<VerbBatchRow>>(() => readBatchDraft("verb", () => Array.from({ length: 3 }, (_, index) => emptyVerbBatchRow(String(index + 1)))));
  const [localError, setLocalError] = useState("");
  const rows = draft.rows;

  useEffect(() => {
    writeBatchDraft("verb", draft);
  }, [draft]);

  function updateRow(id: string, field: keyof VerbBatchRow, value: string) {
    setDraft((currentDraft) => {
      const updated = currentDraft.rows.map((row) => row.id === id ? { ...row, [field]: value } as VerbBatchRow : row);
      const last = updated.at(-1);
      const hasText = last && [last.english, last.infinitive, last.io, last.tu, last.luiLei, last.noi, last.voi, last.loro, last.participle].some((item) => item.trim());
      return { ...currentDraft, rows: hasText ? [...updated, emptyVerbBatchRow(newRowId())] : updated };
    });
  }

  function removeRow(id: string) {
    setDraft((currentDraft) => ({ ...currentDraft, rows: currentDraft.rows.length === 1 ? currentDraft.rows : currentDraft.rows.filter((row) => row.id !== id) }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const setName = draft.setName.trim() || null;
    const tags = parseTags(draft.tags);
    const used = rows.filter((row) => [row.english, row.infinitive, row.io, row.tu, row.luiLei, row.noi, row.voi, row.loro, row.participle].some((item) => item.trim()));
    if (!used.length) {
      setLocalError("Enter at least one verb.");
      return;
    }
    if (used.some((row) => [row.english, row.infinitive, row.io, row.tu, row.luiLei, row.noi, row.voi, row.loro, row.participle].some((item) => !item.trim()))) {
      setLocalError("Every used verb row needs English, infinitive, all six present-tense forms, and the participle.");
      return;
    }
    setLocalError("");
    await onSave(used.map((row, index) => verbCard({
      ...row,
      id: Date.now() + index,
      english: row.english.trim(),
      infinitive: row.infinitive.trim(),
      io: row.io.trim(),
      tu: row.tu.trim(),
      luiLei: row.luiLei.trim(),
      noi: row.noi.trim(),
      voi: row.voi.trim(),
      loro: row.loro.trim(),
      participle: row.participle.trim(),
      setName,
      tags,
    })));
  }

  return (
    <form onSubmit={submit}>
      <SetField knownSets={knownSets} value={draft.setName} onChange={(setName) => setDraft((currentDraft) => ({ ...currentDraft, setName }))} />
      <TagsField value={draft.tags} onChange={(tags) => setDraft((currentDraft) => ({ ...currentDraft, tags }))} />
      <p className="batch-help">One verb per row. A fresh row appears automatically when you begin the last one. Progress saves automatically on this device.</p>
      <div className="batch-table-wrap">
        <table className="batch-table verb-batch-table">
          <thead><tr><th>English</th><th>Infinitive</th><th>io</th><th>tu</th><th>lui / lei</th><th>noi</th><th>voi</th><th>loro</th><th>Aux.</th><th>Participle</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={row.id}>
              <VerbRowCells row={row} index={index} autoFocus={index === 0} onChange={(field, value) => updateRow(row.id, field, value)} onRemove={() => removeRow(row.id)} />
            </tr>)}
          </tbody>
        </table>
      </div>
      {(localError || error) && <p className="form-error" role="alert">{localError || error}</p>}
      <footer className="modal-actions">
        <button type="button" className="text-button" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add verbs"}</button>
      </footer>
    </form>
  );
}

function BatchAdjectives({
  knownSets,
  saving,
  error,
  onSave,
  onCancel,
}: {
  knownSets: string[];
  saving: boolean;
  error: string;
  onSave: (cards: Flashcard[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<BatchDraft<AdjectiveBatchRow>>(() => readBatchDraft("adjective", () => Array.from({ length: 3 }, (_, index) => emptyAdjectiveBatchRow(String(index + 1)))));
  const [localError, setLocalError] = useState("");
  const rows = draft.rows;

  useEffect(() => {
    writeBatchDraft("adjective", draft);
  }, [draft]);

  function updateRow(id: string, field: keyof AdjectiveBatchRow, value: string) {
    setDraft((currentDraft) => {
      const updated = currentDraft.rows.map((row) => row.id === id ? { ...row, [field]: value } : row);
      const last = updated.at(-1);
      const nextRows = last && [last.english, last.masculineSingular, last.feminineSingular, last.masculinePlural, last.femininePlural].some((item) => item.trim())
        ? [...updated, emptyAdjectiveBatchRow(newRowId())]
        : updated;
      return { ...currentDraft, rows: nextRows };
    });
  }

  function removeRow(id: string) {
    setDraft((currentDraft) => ({ ...currentDraft, rows: currentDraft.rows.length === 1 ? currentDraft.rows : currentDraft.rows.filter((row) => row.id !== id) }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const setName = draft.setName.trim() || null;
    const tags = parseTags(draft.tags);
    const used = rows.filter((row) => [row.english, row.masculineSingular, row.feminineSingular, row.masculinePlural, row.femininePlural].some((item) => item.trim()));
    if (!used.length) {
      setLocalError("Enter at least one adjective.");
      return;
    }
    if (used.some((row) => [row.english, row.masculineSingular, row.feminineSingular, row.masculinePlural, row.femininePlural].some((item) => !item.trim()))) {
      setLocalError("Every used adjective row needs English and all four Italian forms.");
      return;
    }
    setLocalError("");
    await onSave(used.map((row, index) => adjectiveCard({
      ...row,
      id: Date.now() + index,
      english: row.english.trim(),
      masculineSingular: row.masculineSingular.trim(),
      feminineSingular: row.feminineSingular.trim(),
      masculinePlural: row.masculinePlural.trim(),
      femininePlural: row.femininePlural.trim(),
      setName,
      tags,
    })));
  }

  return (
    <form onSubmit={submit}>
      <SetField knownSets={knownSets} value={draft.setName} onChange={(setName) => setDraft((currentDraft) => ({ ...currentDraft, setName }))} />
      <TagsField value={draft.tags} onChange={(tags) => setDraft((currentDraft) => ({ ...currentDraft, tags }))} />
      <p className="batch-help">One adjective per row. A fresh row appears automatically when you begin the last one. Progress saves automatically on this device.</p>
      <div className="batch-table-wrap">
        <table className="batch-table adjective-batch-table">
          <thead><tr><th>English</th><th>Masculine singular</th><th>Feminine singular</th><th>Masculine plural</th><th>Feminine plural</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={row.id}>
              <AdjectiveRowCells row={row} index={index} autoFocus={index === 0} onChange={(field, value) => updateRow(row.id, field, value)} onRemove={() => removeRow(row.id)} />
            </tr>)}
          </tbody>
        </table>
      </div>
      {(localError || error) && <p className="form-error" role="alert">{localError || error}</p>}
      <footer className="modal-actions">
        <button type="button" className="text-button" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add adjectives"}</button>
      </footer>
    </form>
  );
}

function BatchAdverbs({ knownSets, saving, error, onSave, onCancel }: { knownSets: string[]; saving: boolean; error: string; onSave: (cards: Flashcard[]) => Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState<BatchDraft<AdverbBatchRow>>(() => readBatchDraft("adverb", () => Array.from({ length: 3 }, (_, index) => emptyAdverbBatchRow(String(index + 1)))));
  const [localError, setLocalError] = useState("");
  const rows = draft.rows;

  useEffect(() => { writeBatchDraft("adverb", draft); }, [draft]);

  function updateRow(id: string, field: keyof AdverbBatchRow, value: string) {
    setDraft((currentDraft) => {
      const updated = currentDraft.rows.map((row) => row.id === id ? { ...row, [field]: value } : row);
      const last = updated.at(-1);
      return { ...currentDraft, rows: last && (last.english.trim() || last.form.trim()) ? [...updated, emptyAdverbBatchRow(newRowId())] : updated };
    });
  }

  function removeRow(id: string) {
    setDraft((currentDraft) => ({ ...currentDraft, rows: currentDraft.rows.length === 1 ? currentDraft.rows : currentDraft.rows.filter((row) => row.id !== id) }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const used = rows.filter((row) => row.english.trim() || row.form.trim());
    if (!used.length) { setLocalError("Enter at least one adverb."); return; }
    if (used.some((row) => !row.english.trim() || !row.form.trim())) { setLocalError("Every used adverb row needs English and an Italian form."); return; }
    setLocalError("");
    const setName = draft.setName.trim() || null;
    const tags = parseTags(draft.tags);
    await onSave(used.map((row, index) => adverbCard({ id: Date.now() + index, english: row.english.trim(), form: row.form.trim(), setName, tags })));
  }

  return <form onSubmit={submit}>
    <SetField knownSets={knownSets} value={draft.setName} onChange={(setName) => setDraft((currentDraft) => ({ ...currentDraft, setName }))} />
    <TagsField value={draft.tags} onChange={(tags) => setDraft((currentDraft) => ({ ...currentDraft, tags }))} />
    <p className="batch-help">One invariant adverb per row. A fresh row appears automatically when you begin the last one. Progress saves automatically on this device.</p>
    <div className="batch-table-wrap"><table className="batch-table adverb-batch-table"><thead><tr><th>English</th><th>Italian adverb</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
      {rows.map((row, index) => <tr key={row.id}><AdverbRowCells row={row} index={index} autoFocus={index === 0} onChange={(field, value) => updateRow(row.id, field, value)} onRemove={() => removeRow(row.id)} /></tr>)}
    </tbody></table></div>
    {(localError || error) && <p className="form-error" role="alert">{localError || error}</p>}
    <footer className="modal-actions"><button type="button" className="text-button" onClick={onCancel} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add adverbs"}</button></footer>
  </form>;
}

function AddCardModal({
  knownSets,
  onClose,
  onBatch,
}: {
  knownSets: string[];
  onClose: () => void;
  onBatch: (cards: Flashcard[]) => Promise<void>;
}) {
  const [type, setType] = useState<CardType>(readCardAdderType);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    writeCardAdderType(type);
  }, [type]);

  async function saveBatch(cards: Flashcard[]) {
    try {
      setSaving(true);
      setError("");
      await onBatch(cards);
      if (cards[0]) clearBatchDraft(cards[0].type);
      onClose();
    } catch {
      setSaving(false);
      setError("The batch could not be saved. Try again.");
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal batch-modal" role="dialog" aria-modal="true" aria-labelledby="add-card-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <h2 id="add-card-title">Add cards</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="mode-tabs" aria-label="Card type">
          {cardTypes.map((item) => (
            <button key={item} className={type === item ? "active" : ""} onClick={() => { setType(item); setError(""); }}>{typeLabels[item]}s</button>
          ))}
        </div>

        {type === "noun" && <BatchNouns knownSets={knownSets} saving={saving} error={error} onSave={saveBatch} onCancel={onClose} />}
        {type === "verb" && <BatchVerbs knownSets={knownSets} saving={saving} error={error} onSave={saveBatch} onCancel={onClose} />}
        {type === "adjective" && <BatchAdjectives knownSets={knownSets} saving={saving} error={error} onSave={saveBatch} onCancel={onClose} />}
        {type === "adverb" && <BatchAdverbs knownSets={knownSets} saving={saving} error={error} onSave={saveBatch} onCancel={onClose} />}
      </section>
    </div>
  );
}

function EditCardModal({
  card,
  knownSets,
  onClose,
  onSave,
}: {
  card: Flashcard;
  knownSets: string[];
  onClose: () => void;
  onSave: (card: Flashcard) => void;
}) {
  const [formError, setFormError] = useState("");
  const [setName, setSetName] = useState(card.setName ?? "");
  const [tags, setTags] = useState(visibleTags(card.tags).join(", "));
  const [nounRow, setNounRow] = useState<BatchRow>(() => nounRowFromCard(card));
  const [verbRow, setVerbRow] = useState<VerbBatchRow>(() => verbRowFromCard(card));
  const [adjectiveRow, setAdjectiveRow] = useState<AdjectiveBatchRow>(() => adjectiveRowFromCard(card));
  const [adverbRow, setAdverbRow] = useState<AdverbBatchRow>(() => adverbRowFromCard(card));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const preservedDeckTags = card.tags.filter((tag) => tag.startsWith(deckTagPrefix));
    const common = {
      id: card.id,
      type: card.type,
      setName: setName.trim() || null,
      tags: Array.from(new Set([...preservedDeckTags, ...parseTags(tags)])),
    };
    let updated: Flashcard;
    if (card.type === "noun") {
      if (!nounRow.english.trim()) { setFormError("Enter an English prompt."); return; }
      const nounFields = { singular: nounRow.singular.trim(), plural: nounRow.plural.trim(), definiteSingularArticle: nounRow.definiteSingularArticle, definitePluralArticle: nounRow.definitePluralArticle, indefiniteArticle: nounRow.indefiniteArticle };
      const formsError = nounFormsError(nounFields);
      if (formsError) {
        setFormError(formsError);
        return;
      }
      updated = nounCard({
        ...common,
        english: nounRow.english.trim(),
        gender: nounRow.gender,
        ...nounFields,
      });
    } else if (card.type === "verb") {
      if ([verbRow.english, verbRow.infinitive, verbRow.io, verbRow.tu, verbRow.luiLei, verbRow.noi, verbRow.voi, verbRow.loro, verbRow.participle].some((value) => !value.trim())) { setFormError("English, infinitive, all six present-tense forms, and the participle are required."); return; }
      updated = { ...common, english: verbRow.english.trim(), italian: verbRow.infinitive.trim(), details: {
        io: verbRow.io.trim(), tu: verbRow.tu.trim(), luiLei: verbRow.luiLei.trim(), noi: verbRow.noi.trim(),
        voi: verbRow.voi.trim(), loro: verbRow.loro.trim(), auxiliary: verbRow.auxiliary, participle: verbRow.participle.trim(),
      }};
    } else if (card.type === "adjective") {
      if ([adjectiveRow.english, adjectiveRow.masculineSingular, adjectiveRow.feminineSingular, adjectiveRow.masculinePlural, adjectiveRow.femininePlural].some((value) => !value.trim())) { setFormError("English and all four Italian adjective forms are required."); return; }
      updated = { ...common, english: adjectiveRow.english.trim(), italian: adjectiveRow.masculineSingular.trim(), details: {
        masculineSingular: adjectiveRow.masculineSingular.trim(), feminineSingular: adjectiveRow.feminineSingular.trim(),
        masculinePlural: adjectiveRow.masculinePlural.trim(), femininePlural: adjectiveRow.femininePlural.trim(),
      }};
    } else {
      if (!adverbRow.english.trim() || !adverbRow.form.trim()) { setFormError("English and the Italian adverb are required."); return; }
      updated = { ...common, english: adverbRow.english.trim(), italian: adverbRow.form.trim(), details: {} };
    }
    setFormError("");
    onSave(updated);
    onClose();
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal batch-modal" role="dialog" aria-modal="true" aria-labelledby="edit-card-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div className="edit-title"><h2 id="edit-card-title">Edit card</h2><span className={`inline-type-tag ${card.type}`}>{typeLabels[card.type]}</span></div>
          <button className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </header>
        <form onSubmit={submit}>
          <div className="edit-fields-top">
            <SetField knownSets={knownSets} value={setName} onChange={setSetName} />
            <TagsField value={tags} onChange={setTags} />
          </div>
          <p className="batch-help">Edit the card in the same column layout used by bulk entry.</p>
          <div className="batch-table-wrap">
            {card.type === "noun" && <table className="batch-table"><thead><tr><th>English</th><th>Gender</th><th>Singular</th><th>Plural</th><th>Def. sg.</th><th>Def. pl.</th><th>Indef.</th><th /></tr></thead><tbody><tr><NounRowCells row={nounRow} index={0} autoFocus onChange={(field, value) => setNounRow((row) => updateNounRow(row, field, value))} /><td /></tr></tbody></table>}
            {card.type === "verb" && <table className="batch-table verb-batch-table"><thead><tr><th>English</th><th>Infinitive</th><th>io</th><th>tu</th><th>lui / lei</th><th>noi</th><th>voi</th><th>loro</th><th>Aux.</th><th>Participle</th><th /></tr></thead><tbody><tr><VerbRowCells row={verbRow} index={0} autoFocus onChange={(field, value) => setVerbRow((row) => ({ ...row, [field]: value } as VerbBatchRow))} /><td /></tr></tbody></table>}
            {card.type === "adjective" && <table className="batch-table adjective-batch-table"><thead><tr><th>English</th><th>Masculine singular</th><th>Feminine singular</th><th>Masculine plural</th><th>Feminine plural</th><th /></tr></thead><tbody><tr><AdjectiveRowCells row={adjectiveRow} index={0} autoFocus onChange={(field, value) => setAdjectiveRow((row) => ({ ...row, [field]: value }))} /><td /></tr></tbody></table>}
            {card.type === "adverb" && <table className="batch-table adverb-batch-table"><thead><tr><th>English</th><th>Italian adverb</th><th /></tr></thead><tbody><tr><AdverbRowCells row={adverbRow} index={0} autoFocus onChange={(field, value) => setAdverbRow((row) => ({ ...row, [field]: value }))} /><td /></tr></tbody></table>}
          </div>
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <footer className="modal-actions">
            <button type="button" className="text-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button">Save changes</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function BulkEditCardsModal({ cards, onClose, onSave }: { cards: Flashcard[]; onClose: () => void; onSave: (cards: Flashcard[]) => Promise<boolean> }) {
  const [nounRows, setNounRows] = useState(() => cards.filter((card) => card.type === "noun").map(nounRowFromCard));
  const [verbRows, setVerbRows] = useState(() => cards.filter((card) => card.type === "verb").map(verbRowFromCard));
  const [adjectiveRows, setAdjectiveRows] = useState(() => cards.filter((card) => card.type === "adjective").map(adjectiveRowFromCard));
  const [adverbRows, setAdverbRows] = useState(() => cards.filter((card) => card.type === "adverb").map(adverbRowFromCard));
  const firstType: CardType = nounRows.length ? "noun" : verbRows.length ? "verb" : adjectiveRows.length ? "adjective" : "adverb";
  const [type, setType] = useState<CardType>(firstType);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const counts = { noun: nounRows.length, verb: verbRows.length, adjective: adjectiveRows.length, adverb: adverbRows.length };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (nounRows.some((row) => !row.english.trim())) { setType("noun"); setError("Every noun needs an English prompt."); return; }
    const nounError = nounRows.map(nounFormsError).find(Boolean);
    if (nounError) { setType("noun"); setError(nounError); return; }
    if (verbRows.some((row) => [row.english, row.infinitive, row.io, row.tu, row.luiLei, row.noi, row.voi, row.loro, row.participle].some((value) => !value.trim()))) { setType("verb"); setError("Every verb needs English, infinitive, all six present-tense forms, and the participle."); return; }
    if (adjectiveRows.some((row) => [row.english, row.masculineSingular, row.feminineSingular, row.masculinePlural, row.femininePlural].some((value) => !value.trim()))) { setType("adjective"); setError("Every adjective needs English and all four Italian forms."); return; }
    if (adverbRows.some((row) => !row.english.trim() || !row.form.trim())) { setType("adverb"); setError("Every adverb needs English and an Italian form."); return; }

    const updated: Flashcard[] = [
      ...nounRows.map((row) => {
        const original = cardById.get(Number(row.id))!;
        return nounCard({ ...row, id: original.id, english: row.english.trim(), singular: row.singular.trim(), plural: row.plural.trim(), setName: original.setName, tags: original.tags });
      }),
      ...verbRows.map((row) => {
        const original = cardById.get(Number(row.id))!;
        return verbCard({ ...row, id: original.id, english: row.english.trim(), infinitive: row.infinitive.trim(), io: row.io.trim(), tu: row.tu.trim(), luiLei: row.luiLei.trim(), noi: row.noi.trim(), voi: row.voi.trim(), loro: row.loro.trim(), participle: row.participle.trim(), setName: original.setName, tags: original.tags });
      }),
      ...adjectiveRows.map((row) => {
        const original = cardById.get(Number(row.id))!;
        return adjectiveCard({ ...row, id: original.id, english: row.english.trim(), masculineSingular: row.masculineSingular.trim(), feminineSingular: row.feminineSingular.trim(), masculinePlural: row.masculinePlural.trim(), femininePlural: row.femininePlural.trim(), setName: original.setName, tags: original.tags });
      }),
      ...adverbRows.map((row) => {
        const original = cardById.get(Number(row.id))!;
        return adverbCard({ id: original.id, english: row.english.trim(), form: row.form.trim(), setName: original.setName, tags: original.tags });
      }),
    ];
    setError("");
    setSaving(true);
    if (await onSave(updated)) onClose();
    else { setSaving(false); setError("The changes could not be saved. The previous cards were restored."); }
  }

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="modal batch-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-edit-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="modal-header"><div><h2 id="bulk-edit-title">Edit cards</h2><p className="modal-subtitle">{cards.length} cards match the selected tags. Sets, decks, and tags are preserved.</p></div><button className="icon-button" onClick={onClose} aria-label="Close">×</button></header>
      <form onSubmit={submit}>
        <div className="mode-tabs" aria-label="Card type">
          {cardTypes.map((item) => <button type="button" key={item} className={type === item ? "active" : ""} disabled={counts[item] === 0} onClick={() => { setType(item); setError(""); }}>{typeLabels[item]}s <span className="tab-count">{counts[item]}</span></button>)}
        </div>
        <div className="batch-table-wrap bulk-edit-table-wrap">
          {type === "noun" && <table className="batch-table"><thead><tr><th>English</th><th>Gender</th><th>Singular</th><th>Plural</th><th>Def. sg.</th><th>Def. pl.</th><th>Indef.</th><th /></tr></thead><tbody>{nounRows.map((row, index) => <tr key={row.id}><NounRowCells row={row} index={index} autoFocus={index === 0} onChange={(field, value) => setNounRows((rows) => rows.map((item) => item.id === row.id ? updateNounRow(item, field, value) : item))} /><td /></tr>)}</tbody></table>}
          {type === "verb" && <table className="batch-table verb-batch-table"><thead><tr><th>English</th><th>Infinitive</th><th>io</th><th>tu</th><th>lui / lei</th><th>noi</th><th>voi</th><th>loro</th><th>Aux.</th><th>Participle</th><th /></tr></thead><tbody>{verbRows.map((row, index) => <tr key={row.id}><VerbRowCells row={row} index={index} autoFocus={index === 0} onChange={(field, value) => setVerbRows((rows) => rows.map((item) => item.id === row.id ? { ...item, [field]: value } as VerbBatchRow : item))} /><td /></tr>)}</tbody></table>}
          {type === "adjective" && <table className="batch-table adjective-batch-table"><thead><tr><th>English</th><th>Masculine singular</th><th>Feminine singular</th><th>Masculine plural</th><th>Feminine plural</th><th /></tr></thead><tbody>{adjectiveRows.map((row, index) => <tr key={row.id}><AdjectiveRowCells row={row} index={index} autoFocus={index === 0} onChange={(field, value) => setAdjectiveRows((rows) => rows.map((item) => item.id === row.id ? { ...item, [field]: value } : item))} /><td /></tr>)}</tbody></table>}
          {type === "adverb" && <table className="batch-table adverb-batch-table"><thead><tr><th>English</th><th>Italian adverb</th><th /></tr></thead><tbody>{adverbRows.map((row, index) => <tr key={row.id}><AdverbRowCells row={row} index={index} autoFocus={index === 0} onChange={(field, value) => setAdverbRows((rows) => rows.map((item) => item.id === row.id ? { ...item, [field]: value } : item))} /><td /></tr>)}</tbody></table>}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer className="modal-actions"><button type="button" className="text-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : `Save ${cards.length} cards`}</button></footer>
      </form>
    </section>
  </div>;
}

type InventoryMetadataDraft = Record<string, { setName: string; tags: string }>;

function InventoryCardsEditor({
  cards,
  knownSets,
  onSave,
  onOpen,
  onRemove,
}: {
  cards: Flashcard[];
  knownSets: string[];
  onSave: (updated: Flashcard[], original: Flashcard[]) => Promise<boolean>;
  onOpen: (card: Flashcard) => void;
  onRemove: (id: number) => void;
}) {
  const [nounRows, setNounRows] = useState(() => cards.filter((card) => card.type === "noun").map(nounRowFromCard));
  const [verbRows, setVerbRows] = useState(() => cards.filter((card) => card.type === "verb").map(verbRowFromCard));
  const [adjectiveRows, setAdjectiveRows] = useState(() => cards.filter((card) => card.type === "adjective").map(adjectiveRowFromCard));
  const [adverbRows, setAdverbRows] = useState(() => cards.filter((card) => card.type === "adverb").map(adverbRowFromCard));
  const [metadata, setMetadata] = useState<InventoryMetadataDraft>(() => Object.fromEntries(cards.map((card) => [String(card.id), { setName: card.setName ?? "", tags: visibleTags(card.tags).join(", ") }])));
  const firstType: CardType = nounRows.length ? "noun" : verbRows.length ? "verb" : adjectiveRows.length ? "adjective" : "adverb";
  const [type, setType] = useState<CardType>(firstType);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const counts = { noun: nounRows.length, verb: verbRows.length, adjective: adjectiveRows.length, adverb: adverbRows.length };

  function updateMetadata(id: string, field: "setName" | "tags", value: string) {
    setMetadata((items) => ({ ...items, [id]: { ...items[id], [field]: value } }));
  }

  function commonFor(rowId: string) {
    const original = cardById.get(Number(rowId))!;
    const rowMetadata = metadata[rowId] ?? { setName: original.setName ?? "", tags: visibleTags(original.tags).join(", ") };
    return {
      id: original.id,
      setName: rowMetadata.setName.trim() || null,
      tags: Array.from(new Set([...original.tags.filter((tag) => tag.startsWith(deckTagPrefix)), ...parseTags(rowMetadata.tags)])),
    };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (nounRows.some((row) => !row.english.trim())) { setType("noun"); setError("Every noun needs an English prompt."); return; }
    const nounError = nounRows.map(nounFormsError).find(Boolean);
    if (nounError) { setType("noun"); setError(nounError); return; }
    if (verbRows.some((row) => [row.english, row.infinitive, row.io, row.tu, row.luiLei, row.noi, row.voi, row.loro, row.participle].some((value) => !value.trim()))) { setType("verb"); setError("Every verb needs English, infinitive, all six present-tense forms, and the participle."); return; }
    if (adjectiveRows.some((row) => [row.english, row.masculineSingular, row.feminineSingular, row.masculinePlural, row.femininePlural].some((value) => !value.trim()))) { setType("adjective"); setError("Every adjective needs English and all four Italian forms."); return; }
    if (adverbRows.some((row) => !row.english.trim() || !row.form.trim())) { setType("adverb"); setError("Every adverb needs English and an Italian form."); return; }

    const updated: Flashcard[] = [
      ...nounRows.map((row) => nounCard({ ...row, ...commonFor(row.id), english: row.english.trim(), singular: row.singular.trim(), plural: row.plural.trim() })),
      ...verbRows.map((row) => verbCard({ ...row, ...commonFor(row.id), english: row.english.trim(), infinitive: row.infinitive.trim(), io: row.io.trim(), tu: row.tu.trim(), luiLei: row.luiLei.trim(), noi: row.noi.trim(), voi: row.voi.trim(), loro: row.loro.trim(), participle: row.participle.trim() })),
      ...adjectiveRows.map((row) => adjectiveCard({ ...row, ...commonFor(row.id), english: row.english.trim(), masculineSingular: row.masculineSingular.trim(), feminineSingular: row.feminineSingular.trim(), masculinePlural: row.masculinePlural.trim(), femininePlural: row.femininePlural.trim() })),
      ...adverbRows.map((row) => adverbCard({ ...commonFor(row.id), english: row.english.trim(), form: row.form.trim() })),
    ];
    setError("");
    setSaving(true);
    if (!(await onSave(updated, cards))) setError("The changes could not be saved. The previous cards were restored.");
    setSaving(false);
  }

  function metadataCells(rowId: string) {
    const rowMetadata = metadata[rowId];
    const original = cardById.get(Number(rowId))!;
    return <>
      <td><input aria-label={`Set for ${original.english}`} list="known-card-sets" value={rowMetadata?.setName ?? ""} onChange={(event) => updateMetadata(rowId, "setName", event.target.value)} placeholder="Optional" /></td>
      <td><input aria-label={`Tags for ${original.english}`} value={rowMetadata?.tags ?? ""} onChange={(event) => updateMetadata(rowId, "tags", event.target.value)} placeholder="tag, tag" /></td>
      <td><div className="inventory-row-actions"><button type="button" className="row-open" onClick={() => onOpen(original)} aria-label={`Open focused editor for ${original.english}`} title="Focused editor">↗</button><button type="button" className="row-remove" onClick={() => { if (window.confirm(`Remove ${original.english}?`)) onRemove(original.id); }} aria-label={`Remove ${original.english}`} title="Remove card">×</button></div></td>
    </>;
  }

  return <form className="inventory-editor" onSubmit={submit}>
    <div className="inventory-editor-heading">
      <div className="mode-tabs" aria-label="Inventory card type">
        {cardTypes.map((item) => <button type="button" key={item} className={type === item ? "active" : ""} disabled={counts[item] === 0} onClick={() => { setType(item); setError(""); }}>{typeLabels[item]}s <span className="tab-count">{counts[item]}</span></button>)}
      </div>
      <button type="submit" className="primary-button inventory-save" disabled={saving}>{saving ? "Saving…" : `Save visible cards (${cards.length})`}</button>
    </div>
    <datalist id="known-card-sets">{knownSets.map((name) => <option key={name} value={name} />)}</datalist>
    <p className="batch-help">Every visible field is editable. Filters use union matching; saving updates the cards currently shown.</p>
    <div className="batch-table-wrap inventory-table-wrap">
      {type === "noun" && <table className="batch-table inventory-edit-table noun-inventory-table"><thead><tr><th>English</th><th>Gender</th><th>Singular</th><th>Plural</th><th>Def. sg.</th><th>Def. pl.</th><th>Indef.</th><th>Set</th><th>Tags</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{nounRows.map((row, index) => <tr key={row.id}><NounRowCells row={row} index={index} onChange={(field, value) => setNounRows((rows) => rows.map((item) => item.id === row.id ? updateNounRow(item, field, value) : item))} />{metadataCells(row.id)}</tr>)}</tbody></table>}
      {type === "verb" && <table className="batch-table verb-batch-table inventory-edit-table"><thead><tr><th>English</th><th>Infinitive</th><th>io</th><th>tu</th><th>lui / lei</th><th>noi</th><th>voi</th><th>loro</th><th>Aux.</th><th>Participle</th><th>Set</th><th>Tags</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{verbRows.map((row, index) => <tr key={row.id}><VerbRowCells row={row} index={index} onChange={(field, value) => setVerbRows((rows) => rows.map((item) => item.id === row.id ? { ...item, [field]: value } as VerbBatchRow : item))} />{metadataCells(row.id)}</tr>)}</tbody></table>}
      {type === "adjective" && <table className="batch-table adjective-batch-table inventory-edit-table"><thead><tr><th>English</th><th>Masculine singular</th><th>Feminine singular</th><th>Masculine plural</th><th>Feminine plural</th><th>Set</th><th>Tags</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{adjectiveRows.map((row, index) => <tr key={row.id}><AdjectiveRowCells row={row} index={index} onChange={(field, value) => setAdjectiveRows((rows) => rows.map((item) => item.id === row.id ? { ...item, [field]: value } : item))} />{metadataCells(row.id)}</tr>)}</tbody></table>}
      {type === "adverb" && <table className="batch-table adverb-batch-table inventory-edit-table"><thead><tr><th>English</th><th>Italian adverb</th><th>Set</th><th>Tags</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{adverbRows.map((row, index) => <tr key={row.id}><AdverbRowCells row={row} index={index} onChange={(field, value) => setAdverbRows((rows) => rows.map((item) => item.id === row.id ? { ...item, [field]: value } : item))} />{metadataCells(row.id)}</tr>)}</tbody></table>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}

function StorageSettingsModal({
  mode,
  endpoint,
  onClose,
  onApply,
}: {
  mode: StorageMode;
  endpoint: string;
  onClose: () => void;
  onApply: (mode: StorageMode, endpoint: string) => Promise<void>;
}) {
  const [draftMode, setDraftMode] = useState<StorageMode>(mode);
  const [draftEndpoint, setDraftEndpoint] = useState(endpoint);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (draftMode === "remote" && !draftEndpoint.trim()) {
      setError("Enter a remote API endpoint before selecting remote storage.");
      return;
    }
    setSaving(true);
    try {
      await onApply(draftMode, draftEndpoint.trim());
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Storage could not be changed.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <form className="modal storage-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
      <header className="modal-header">
        <div><h2>Storage</h2><p className="modal-subtitle">Choose which saved storage location Parola uses.</p></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close storage settings">×</button>
      </header>
      <div className="storage-option-copy">
        <strong>The endpoint and active storage mode are saved separately.</strong>
        <p>You can keep the Azure endpoint saved here while continuing to use browser localStorage. Switching storage changes which inventory is shown; it does not copy cards between locations.</p>
      </div>
      <div className="storage-mode-options" role="radiogroup" aria-label="Active card storage">
        <label className={draftMode === "browser" ? "selected" : ""}>
          <input type="radio" name="storage-mode" checked={draftMode === "browser"} onChange={() => setDraftMode("browser")} />
          <span><strong>Browser</strong><small>Use this browser's localStorage.</small></span>
        </label>
        <label className={draftMode === "remote" ? "selected" : ""}>
          <input type="radio" name="storage-mode" checked={draftMode === "remote"} onChange={() => setDraftMode("remote")} />
          <span><strong>Remote</strong><small>Use the saved API endpoint.</small></span>
        </label>
      </div>
      <label className="field full-field">
        <span>Remote API endpoint</span>
        <input
          type="url"
          inputMode="url"
          value={draftEndpoint}
          onChange={(event) => setDraftEndpoint(event.target.value)}
          placeholder="https://example.com/api/cards"
          autoComplete="off"
        />
      </label>
      <div className="api-contract">
        <strong>Expected API</strong>
        <code>GET endpoint → {`{ cards: [...] }`}</code>
        <code>POST endpoint ← {`{ cards: [...] }`}</code>
        <code>PUT endpoint ← one card</code>
        <code>DELETE endpoint?id=123</code>
        <p>The endpoint must allow browser requests from the site where Parola is hosted (CORS).</p>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer className="modal-actions">
        <button type="button" className="text-button" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" className="primary-button" disabled={saving}>{saving ? "Checking…" : "Apply"}</button>
      </footer>
    </form>
  </div>;
}

function StudyScope({
  mode,
  onMode,
  options,
  selected,
  onToggle,
}: {
  mode: ScopeMode;
  onMode: (mode: ScopeMode) => void;
  options: StudyScopeOption[];
  selected: string[];
  onToggle: (key: string) => void;
}) {
  return (
    <section className="scope-panel" aria-label="Study scope">
      <label>
        <span>Study from</span>
        <select value={mode} onChange={(event) => onMode(event.target.value as ScopeMode)}>
          <option value="all">Entire inventory</option>
          <option value="only">Only selected types / decks / sets / tags</option>
          <option value="exclude">Everything except selected types / decks / sets / tags</option>
        </select>
      </label>
      {mode !== "all" && (
        <div className="set-picker">
          {options.length ? options.map((option) => (
            <button key={option.key} className={`${option.kind} ${selected.includes(option.key) ? "selected" : ""}`} aria-pressed={selected.includes(option.key)} onClick={() => onToggle(option.key)}>{option.kind === "type" ? "Type · " : option.kind === "deck" ? "Deck · " : option.kind === "tag" ? "Tag · " : "Set · "}{option.label}</button>
          )) : <span className="no-sets">No study scopes available.</span>}
        </div>
      )}
    </section>
  );
}

export default function Home() {
  const [view, setView] = useState<"study" | "library">("study");
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [loadingCards, setLoadingCards] = useState(true);
  const [storageMode, setStorageMode] = useState<StorageMode>(readStorageMode);
  const [storageEndpoint, setStorageEndpoint] = useState(readStorageEndpoint);
  const [storageSettingsOpen, setStorageSettingsOpen] = useState(false);
  const activeStorageEndpoint = storageMode === "remote" ? storageEndpoint : "";
  const storage = useMemo<CardStorage>(() => createCardStorage(activeStorageEndpoint), [activeStorageEndpoint]);
  const [adding, setAdding] = useState(false);
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const [bulkEditingCards, setBulkEditingCards] = useState<Flashcard[] | null>(null);
  const [current, setCurrent] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [verificationResult, setVerificationResult] = useState<"correct" | "wrong" | null>(null);
  const [submittedAnswer, setSubmittedAnswer] = useState("");
  const [scopeMode, setScopeMode] = useState<ScopeMode>("all");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [promptMode, setPromptMode] = useState<PromptMode>("english");
  const [typeToVerify, setTypeToVerify] = useState(false);
  const [answerKeywords, setAnswerKeywords] = useState<AnswerKeywords>(readAnswerKeywords);
  const [oneDirectionPerWord, setOneDirectionPerWord] = useState(false);
  const [englishFirstWhenBoth, setEnglishFirstWhenBoth] = useState(false);
  const [compactAnswers, setCompactAnswers] = useState(false);
  const [directionSeed, setDirectionSeed] = useState(0);
  const [shuffleSeed, setShuffleSeed] = useState(() => Date.now() >>> 0);
  const [selectedInventoryTags, setSelectedInventoryTags] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [syncWarning, setSyncWarning] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [session, setSession] = useState({ right: 0, wrong: 0, skipped: 0 });
  const [sessionComplete, setSessionComplete] = useState(false);
  const [mistakeKeys, setMistakeKeys] = useState<string[]>([]);
  const [mistakeOnlyKeys, setMistakeOnlyKeys] = useState<string[] | null>(null);
  const [problemDeckName, setProblemDeckName] = useState("");
  const [createdProblemDeckName, setCreatedProblemDeckName] = useState("");

  const setNames = useMemo(() => Array.from(new Set(cards.map((card) => card.setName).filter((name): name is string => Boolean(name)))).sort((a, b) => a.localeCompare(b)), [cards]);
  const problemDeckNames = useMemo(() => Array.from(new Set(cards.flatMap((card) => card.tags.map(deckName).filter((name): name is string => Boolean(name))))).sort((a, b) => a.localeCompare(b)), [cards]);
  const suggestedProblemDeckName = useMemo(() => {
    const prefix = `Trouble · ${localDateStamp()} · `;
    return `${prefix}${problemDeckNames.filter((name) => name.startsWith(prefix)).length + 1}`;
  }, [problemDeckNames]);
  const effectiveProblemDeckName = problemDeckName || suggestedProblemDeckName;
  const arbitraryTags = useMemo(() => Array.from(new Set(cards.flatMap((card) => visibleTags(card.tags)))).sort((a, b) => a.localeCompare(b)), [cards]);
  const studyScopeOptions = useMemo<StudyScopeOption[]>(() => [
    ...cardTypes.map((type) => ({ key: `type:${type}`, label: typeLabels[type], kind: "type" as const })),
    ...setNames.map((name) => ({ key: `set:${name}`, label: name, kind: "set" as const })),
    ...problemDeckNames.map((name) => ({ key: `deck:${name}`, label: name, kind: "deck" as const })),
    ...arbitraryTags.map((tag) => ({ key: `tag:${tag}`, label: tag, kind: "tag" as const })),
  ], [arbitraryTags, problemDeckNames, setNames]);
  const inventoryTagOptions = useMemo(() => [
    ...cardTypes.map((type) => ({ key: `type:${type}`, label: typeLabels[type], kind: "type" })),
    ...setNames.map((name) => ({ key: `set:${name}`, label: name, kind: "set" })),
    ...problemDeckNames.map((name) => ({ key: `deck:${name}`, label: name, kind: "deck" })),
    ...arbitraryTags.map((tag) => ({ key: `tag:${tag}`, label: tag, kind: "custom" })),
  ], [arbitraryTags, problemDeckNames, setNames]);
  const scopedCards = useMemo(() => cards.filter((card) => {
    if (scopeMode === "all") return true;
    const belongsToSelectedScope = selectedScopes.includes(`type:${card.type}`) || Boolean(card.setName && selectedScopes.includes(`set:${card.setName}`)) || card.tags.some((tag) => {
      const name = deckName(tag);
      return name ? selectedScopes.includes(`deck:${name}`) : selectedScopes.includes(`tag:${tag}`);
    });
    return scopeMode === "only" ? belongsToSelectedScope : !belongsToSelectedScope;
  }), [cards, scopeMode, selectedScopes]);
  const homogeneousStudyType = useMemo<CardType | null>(() => {
    const types = new Set(scopedCards.map((item) => item.type));
    return types.size === 1 ? Array.from(types)[0] ?? null : null;
  }, [scopedCards]);
  const answerSyntaxMode: AnswerSyntaxMode = compactAnswers && homogeneousStudyType && typeToVerify && promptMode !== "italian" ? "compact" : "universal";
  const allStudyItems = useMemo(() => scopedCards.flatMap((card): StudyItem[] => {
    if (promptMode === "english" || promptMode === "italian") {
      return [{ key: `${card.id}:${promptMode}`, card, promptLanguage: promptMode }];
    }
    if (oneDirectionPerWord) {
      const promptLanguage: PromptLanguage = Math.abs((card.id * 31) + directionSeed) % 2 === 0 ? "english" : "italian";
      return [{ key: `${card.id}:${promptLanguage}`, card, promptLanguage }];
    }
    return [
      { key: `${card.id}:english`, card, promptLanguage: "english" },
      { key: `${card.id}:italian`, card, promptLanguage: "italian" },
    ];
  }), [directionSeed, oneDirectionPerWord, promptMode, scopedCards]);
  const studyItems = useMemo(() => {
    const randomized = shuffled(mistakeOnlyKeys
      ? mistakeOnlyKeys.map((key) => allStudyItems.find((item) => item.key === key)).filter((item): item is StudyItem => Boolean(item))
      : allStudyItems, shuffleSeed);
    return englishFirstWhenBoth && promptMode === "both" && !oneDirectionPerWord
      ? withEnglishPromptFirst(randomized)
      : randomized;
  }, [allStudyItems, englishFirstWhenBoth, mistakeOnlyKeys, oneDirectionPerWord, promptMode, shuffleSeed]);
  const studyItem = !sessionComplete && studyItems.length && current < studyItems.length ? studyItems[current] : null;
  const card = studyItem?.card ?? null;
  const typingItalian = Boolean(typeToVerify && studyItem?.promptLanguage === "english");
  const tagMatchedCards = useMemo(() => cards.filter((item) => {
    const cardTagKeys = [`type:${item.type}`, ...(item.setName ? [`set:${item.setName}`] : []), ...item.tags.map((tag) => {
      const name = deckName(tag);
      return name ? `deck:${name}` : `tag:${tag}`;
    })];
    return selectedInventoryTags.length === 0 || selectedInventoryTags.some((tag) => cardTagKeys.includes(tag));
  }), [cards, selectedInventoryTags]);
  const filteredCards = useMemo(() => tagMatchedCards.filter((item) => {
    const haystack = `${item.english} ${item.italian} ${item.details.singular ?? ""} ${item.setName ?? ""} ${item.tags.join(" ")}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  }), [query, tagMatchedCards]);

  useEffect(() => {
    let active = true;
    setLoadingCards(true);
    setSyncWarning("");
    storage.listCards()
      .then((storedCards) => { if (active) setCards(storedCards); })
      .catch((error) => {
        if (!active) return;
        setSyncWarning(error instanceof Error ? `Storage unavailable: ${error.message}` : "Storage is temporarily unavailable.");
      })
      .finally(() => { if (active) setLoadingCards(false); });
    return () => { active = false; };
  }, [storage]);

  useEffect(() => {
    writeAnswerKeywords(answerKeywords);
  }, [answerKeywords]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && (adding || editingCard || bulkEditingCards)) {
        setAdding(false);
        setEditingCard(null);
        setBulkEditingCards(null);
        return;
      }
      if (view === "study" && typingItalian && verificationResult && event.key === "Enter") {
        event.preventDefault();
        advanceCard();
        return;
      }
      if (adding || editingCard || bulkEditingCards || view !== "study" || !studyItem || typingItalian) return;
      const target = event.target as HTMLElement;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.code === "Space" || (!revealed && event.key === "Enter")) {
        event.preventDefault();
        setRevealed((value) => !value);
      } else if (revealed && event.key === "2") {
        event.preventDefault();
        rate("wrong");
      } else if (revealed && (event.key === "1" || event.key === "Enter")) {
        event.preventDefault();
        rate("right");
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  function rate(result: "right" | "wrong" | "skipped") {
    if (!studyItems.length || !studyItem) return;
    setSession((value) => ({ ...value, [result]: value[result] + 1 }));
    if (result === "wrong") setMistakeKeys((items) => items.includes(studyItem.key) ? items : [...items, studyItem.key]);
    advanceCard();
  }

  function verifyItalian(correct: boolean, answer: string) {
    if (!studyItem || verificationResult) return;
    const result = correct ? "right" : "wrong";
    setSession((value) => ({ ...value, [result]: value[result] + 1 }));
    if (!correct) setMistakeKeys((items) => items.includes(studyItem.key) ? items : [...items, studyItem.key]);
    setSubmittedAnswer(answer.trim());
    setVerificationResult(correct ? "correct" : "wrong");
    setRevealed(true);
  }

  function advanceCard() {
    if (current + 1 >= studyItems.length) setSessionComplete(true);
    else setCurrent((value) => value + 1);
    setRevealed(false);
    setVerificationResult(null);
    setSubmittedAnswer("");
  }

  function toggleScope(key: string) {
    setSelectedScopes((items) => items.includes(key) ? items.filter((item) => item !== key) : [...items, key]);
    setCompactAnswers(false);
    resetStudyProgress();
  }

  function changeScopeMode(mode: ScopeMode) {
    setScopeMode(mode);
    setCompactAnswers(false);
    resetStudyProgress();
  }

  function changePromptMode(mode: PromptMode) {
    setPromptMode(mode);
    resetStudyProgress();
  }

  function toggleTypeToVerify() {
    setTypeToVerify((value) => !value);
    setRevealed(false);
    setVerificationResult(null);
    setSubmittedAnswer("");
  }

  function toggleOneDirectionPerWord() {
    setOneDirectionPerWord((value) => !value);
    setDirectionSeed((value) => value + 1);
    resetStudyProgress();
  }

  function toggleEnglishFirstWhenBoth() {
    setEnglishFirstWhenBoth((value) => !value);
    resetStudyProgress();
  }

  function toggleCompactAnswers() {
    setCompactAnswers((value) => !value);
    resetStudyProgress();
  }

  function resetStudyProgress() {
    setShuffleSeed((value) => value + 1);
    setCurrent(0);
    setRevealed(false);
    setVerificationResult(null);
    setSubmittedAnswer("");
    setSessionComplete(false);
    setMistakeKeys([]);
    setMistakeOnlyKeys(null);
    setProblemDeckName("");
    setCreatedProblemDeckName("");
    setSession({ right: 0, wrong: 0, skipped: 0 });
  }

  function toggleInventoryTag(key: string) {
    setSelectedInventoryTags((items) => items.includes(key) ? items.filter((item) => item !== key) : [...items, key]);
  }

  function removeUnavailableInventoryTags(nextCards: Flashcard[]) {
    const availableTagKeys = new Set([
      "type:noun",
      "type:verb",
      "type:adjective",
      "type:adverb",
      ...nextCards.flatMap((item) => [
        ...(item.setName ? [`set:${item.setName}`] : []),
        ...item.tags.map((tag) => {
          const name = deckName(tag);
          return name ? `deck:${name}` : `tag:${tag}`;
        }),
      ]),
    ]);
    setSelectedInventoryTags((items) => items.filter((key) => availableTagKeys.has(key)));
  }

  function restartCurrentStudy() {
    if (!mistakeOnlyKeys) setDirectionSeed((value) => value + 1);
    setShuffleSeed((value) => value + 1);
    setCurrent(0);
    setRevealed(false);
    setVerificationResult(null);
    setSubmittedAnswer("");
    setSessionComplete(false);
    setMistakeKeys([]);
    setProblemDeckName("");
    setCreatedProblemDeckName("");
    setSession({ right: 0, wrong: 0, skipped: 0 });
  }

  function returnToOriginalStudy() {
    setMistakeOnlyKeys(null);
    setDirectionSeed((value) => value + 1);
    restartCurrentStudy();
  }

  function studyMistakes() {
    if (!mistakeKeys.length) return;
    setMistakeOnlyKeys([...mistakeKeys]);
    setShuffleSeed((value) => value + 1);
    setCurrent(0);
    setRevealed(false);
    setVerificationResult(null);
    setSubmittedAnswer("");
    setSessionComplete(false);
    setMistakeKeys([]);
    setProblemDeckName("");
    setCreatedProblemDeckName("");
    setSession({ right: 0, wrong: 0, skipped: 0 });
  }

  async function persistManyCards(updatedCards: Flashcard[], originalCards: Flashcard[], failureMessage: string) {
    const updatedById = new Map(updatedCards.map((item) => [item.id, item]));
    const optimisticCards = cards.map((item) => updatedById.get(item.id) ?? item);
    setCards(optimisticCards);
    removeUnavailableInventoryTags(optimisticCards);
    setSyncWarning("");
    setSaveState("saving");
    try {
      const saved = await Promise.all(updatedCards.map((item) => storage.updateCard(item)));
      const savedById = new Map(saved.map((savedCard) => [savedCard.id, savedCard]));
      setCards((items) => items.map((item) => savedById.get(item.id) ?? item));
      setSaveState("saved");
      return true;
    } catch {
      await Promise.allSettled(originalCards.map((item) => storage.updateCard(item)));
      const originalById = new Map(originalCards.map((item) => [item.id, item]));
      setCards((items) => items.map((item) => originalById.get(item.id) ?? item));
      setSaveState("failed");
      setSyncWarning(failureMessage);
      return false;
    }
  }

  async function createProblemDeck() {
    const name = effectiveProblemDeckName.trim();
    if (!name || !mistakeKeys.length) return;
    setProblemDeckName(name);
    const cardIds = new Set(mistakeKeys.map((key) => Number(key.split(":", 1)[0])).filter(Number.isFinite));
    const originalCards = cards.filter((item) => cardIds.has(item.id));
    const tag = `${deckTagPrefix}${name}`;
    const updatedCards = originalCards.map((item) => ({ ...item, tags: item.tags.includes(tag) ? item.tags : [...item.tags, tag] }));
    const saved = await persistManyCards(updatedCards, originalCards, "That problem deck could not be created. No card memberships were changed.");
    if (saved) setCreatedProblemDeckName(name);
  }

  async function removeTagFromExistence(tag: string) {
    const originalCards = cards.filter((item) => item.tags.includes(tag));
    if (!originalCards.length || !window.confirm(`Remove #${tag} from ${originalCards.length} ${originalCards.length === 1 ? "card" : "cards"}?`)) return;
    const updatedCards = originalCards.map((item) => ({ ...item, tags: item.tags.filter((itemTag) => itemTag !== tag) }));
    await persistManyCards(updatedCards, originalCards, `#${tag} could not be removed. The tag has been restored.`);
  }

  async function addBatch(newCards: Flashcard[]) {
    const temporaryCards = newCards.map((card, index) => ({ ...card, id: -(Date.now() + index) }));
    const temporaryIds = new Set(temporaryCards.map((card) => card.id));
    setCards((items) => [...temporaryCards, ...items]);
    setSyncWarning("");
    setSaveState("saving");
    setView("library");
    try {
      const savedCards = await storage.createCards(newCards);
      setCards((items) => [...savedCards, ...items.filter((item) => !temporaryIds.has(item.id))]);
      setSaveState("saved");
    } catch (error) {
      setCards((items) => items.filter((item) => !temporaryIds.has(item.id)));
      setSaveState("failed");
      setSyncWarning("That batch could not be saved and was removed. Please try again.");
      throw error;
    }
  }

  function removeCard(id: number) {
    const removed = cards.find((item) => item.id === id);
    if (!removed) return;
    const remainingCards = cards.filter((item) => item.id !== id);
    setCards(remainingCards);
    removeUnavailableInventoryTags(remainingCards);
    setCurrent(0);
    setSaveState("saving");
    void (async () => {
      try {
        await storage.deleteCard(id);
        setSyncWarning("");
        setSaveState("saved");
      } catch {
        setCards((items) => items.some((item) => item.id === id) ? items : [removed, ...items]);
        setSaveState("failed");
        setSyncWarning("That card could not be removed. It has been restored.");
      }
    })();
  }

  function updateCard(updated: Flashcard) {
    const original = cards.find((item) => item.id === updated.id);
    if (!original) return;
    const updatedCards = cards.map((item) => item.id === updated.id ? updated : item);
    setCards(updatedCards);
    removeUnavailableInventoryTags(updatedCards);
    setSyncWarning("");
    setSaveState("saving");
    void (async () => {
      try {
        const savedCard = await storage.updateCard(updated);
        setCards((items) => items.map((item) => item.id === updated.id ? savedCard : item));
        setSaveState("saved");
      } catch {
        setCards((items) => items.map((item) => item.id === updated.id ? original : item));
        setSaveState("failed");
        setSyncWarning("That edit could not be saved. The previous card has been restored.");
      }
    })();
  }

  async function applyStorageSettings(mode: StorageMode, endpoint: string) {
    const normalizedEndpoint = endpoint.trim();
    if (mode === "remote" && !normalizedEndpoint) throw new Error("Enter a remote API endpoint before selecting remote storage.");
    const candidate = createCardStorage(mode === "remote" ? normalizedEndpoint : "");
    const nextCards = await candidate.listCards();
    saveStorageEndpoint(normalizedEndpoint);
    saveStorageMode(mode);
    setStorageEndpoint(normalizedEndpoint);
    setStorageMode(mode);
    setCards(nextCards);
    setSyncWarning("");
    setSaveState("idle");
    setCurrent(0);
    setSessionComplete(false);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="header-inner">
          <nav aria-label="Main navigation">
            <button className={view === "study" ? "active" : ""} onClick={() => setView("study")}>Study</button>
            <button className={view === "library" ? "active" : ""} onClick={() => setView("library")}>Inventory</button>
          </nav>
          <div className="header-actions">
            <button className="storage-button" onClick={() => setStorageSettingsOpen(true)} title={storageMode === "remote" ? `Remote storage: ${storage.label}` : storageEndpoint ? "Cards are stored in this browser; a remote endpoint is saved" : "Cards are stored in this browser"}>
              <span className={`storage-dot ${storageMode === "remote" ? "remote" : "local"}`} />
              {storageMode === "remote" ? "Remote" : "Browser"}
            </button>
            <SaveIndicator state={saveState} />
            <button className="primary-button" onClick={() => setAdding(true)}>＋ New cards</button>
          </div>
        </div>
      </header>

      <div className="content-frame">
        {view === "study" ? (
          <section className="study-view">
            <StudyScope mode={scopeMode} onMode={changeScopeMode} options={studyScopeOptions} selected={selectedScopes} onToggle={toggleScope} />
            <StudyOptions
              promptMode={promptMode}
              onPromptMode={changePromptMode}
              typeToVerify={typeToVerify}
              onTypeToVerify={toggleTypeToVerify}
              oneDirectionPerWord={oneDirectionPerWord}
              onOneDirectionPerWord={toggleOneDirectionPerWord}
              englishFirstWhenBoth={englishFirstWhenBoth}
              onEnglishFirstWhenBoth={toggleEnglishFirstWhenBoth}
              homogeneousType={homogeneousStudyType}
              compactAnswers={compactAnswers}
              onCompactAnswers={toggleCompactAnswers}
              answerKeywords={answerKeywords}
              onAnswerKeywords={setAnswerKeywords}
            />
            {syncWarning && <p className="sync-warning" role="status">{syncWarning}</p>}
            {loadingCards ? (
              <div className="empty-study" role="status"><p>Loading cards…</p></div>
            ) : sessionComplete ? (
              <div className="session-complete">
                <span className="answer-label">{mistakeOnlyKeys ? "Mistake review complete" : "Study complete"}</span>
                <h2>{mistakeOnlyKeys ? "Mistakes finished" : "Deck finished"}</h2>
                <p>{session.right} right · {session.wrong} wrong · {session.skipped} skipped</p>
                <div className="completion-actions">
                  {mistakeOnlyKeys ? <>
                    <button className="primary-button" onClick={restartCurrentStudy}>Study these mistakes again</button>
                    <button className="neutral-button" onClick={returnToOriginalStudy}>Study original deck</button>
                  </> : <>
                    <button className="primary-button" onClick={restartCurrentStudy}>Study again</button>
                    {mistakeKeys.length > 0 && <button className="wrong-button" onClick={studyMistakes}>Study mistakes ({mistakeKeys.length})</button>}
                  </>}
                </div>
                {!mistakeOnlyKeys && mistakeKeys.length > 0 && <div className="problem-deck-creator">
                  {createdProblemDeckName ? <p className="deck-created" role="status">Created deck <strong>{createdProblemDeckName}</strong></p> : <>
                    <label><span>Problem deck name</span><input value={effectiveProblemDeckName} onChange={(event) => setProblemDeckName(event.target.value)} /></label>
                    <button className="neutral-button" onClick={() => void createProblemDeck()} disabled={!effectiveProblemDeckName.trim() || saveState === "saving"}>Create problem deck</button>
                  </>}
                </div>}
              </div>
            ) : card && studyItem ? <>
              <div className="session-meta">
                <span>{answerSyntaxMode === "compact" && homogeneousStudyType && <><i className={`type-indicator ${homogeneousStudyType}`} />{typeLabels[homogeneousStudyType]} mode · </>}{studyItem.promptLanguage} prompt{card.setName && <b>{card.setName}</b>}</span>
                <span>{current + 1} / {studyItems.length}</span>
              </div>
              {typingItalian ? (
                <div className={`flashcard verification-card ${verificationResult ?? ""}`}>
                  {!verificationResult ? <>
                    <div className="verification-prompt"><span className="answer-label">English prompt</span><h2>{card.english}</h2></div>
                    <ItalianVerificationForm key={`${studyItem.key}:${answerSyntaxMode}`} card={card} syntaxMode={answerSyntaxMode} compactType={homogeneousStudyType} keywords={answerKeywords} onResult={verifyItalian} />
                  </> : <>
                    <div className={`verification-result ${verificationResult}`} role="status">
                      <strong>{verificationResult === "correct" ? "Correct" : "Not quite"}</strong>
                      <span>{verificationResult === "correct" ? "Your Italian matched every stored field." : "Compare your response with the stored answer below."}</span>
                    </div>
                    <div className="submitted-answer"><span>Your answer</span><strong>{submittedAnswer}</strong></div>
                    <div className="verified-answer-stack"><EnglishAnswer card={card} /><CardAnswer card={card} /></div>
                  </>}
                </div>
              ) : (
                <button className="flashcard" onClick={() => setRevealed((value) => !value)} aria-label={revealed ? `Show ${studyItem.promptLanguage} prompt` : `Show ${studyItem.promptLanguage === "english" ? "Italian" : "English"} answer`}>
                  {!revealed
                    ? studyItem.promptLanguage === "english" ? <div className="question-content"><span className="answer-label">English</span><h2>{card.english}</h2></div> : <ItalianPrompt card={card} />
                    : studyItem.promptLanguage === "english" ? <CardAnswer card={card} /> : <EnglishAnswer card={card} showType />}
                </button>
              )}
              {typingItalian ? (
                verificationResult ? (
                  <div className="study-actions verification-actions"><button className="primary-button" onClick={advanceCard}>Continue · Enter</button></div>
                ) : (
                  <div className="study-actions verification-actions"><button className="neutral-button" onClick={() => rate("skipped")}>Skip</button></div>
                )
              ) : !revealed ? (
                <div className="study-actions before-reveal">
                  <button className="neutral-button" onClick={() => rate("skipped")}>Skip</button>
                  <button className="primary-button" onClick={() => setRevealed(true)}>Reveal answer</button>
                </div>
              ) : (
                <div className="study-actions rating-actions">
                  <button className="wrong-button" onClick={() => rate("wrong")}><span>2</span> Wrong</button>
                  <button className="right-button" onClick={() => rate("right")}><span>1</span> Right · Enter</button>
                </div>
              )}
              {!typingItalian && <p className="keyboard-hint">{revealed ? "Space or click flips · 1 or Enter right · 2 wrong" : "Space, Enter, or click flips"}</p>}
              {(session.right + session.wrong + session.skipped) > 0 && <p className="session-counts">This session: {session.right} right · {session.wrong} wrong · {session.skipped} skipped</p>}
            </> : (
              <div className="empty-study">
                <h2>No cards in this study scope</h2>
                <p>{scopeMode === "only" && !selectedScopes.length ? "Select one or more parts of speech, decks, or sets above." : "Change the scope or add cards."}</p>
              </div>
            )}
          </section>
        ) : (
          <section className="library-view">
            <h1>Inventory</h1>
            <div className="inventory-sticky">
              <div className="inventory-control-row">
                <input className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search words, sets, or tags…" aria-label="Search inventory" />
                <div className="inventory-actions">
                  <button className="edit-filtered-button" onClick={() => setBulkEditingCards(tagMatchedCards)} disabled={!selectedInventoryTags.length || !tagMatchedCards.length} title={!selectedInventoryTags.length ? "Select one or more tags first" : undefined}>Focused edit{selectedInventoryTags.length ? ` (${tagMatchedCards.length})` : ""}</button>
                </div>
              </div>
              <div className="tag-filter-row" aria-label="Filter by tags">
                {inventoryTagOptions.map((tag) => tag.kind === "custom" ? <span className="filter-tag-group" key={tag.key}>
                  <button className={`filter-tag custom ${selectedInventoryTags.includes(tag.key) ? "selected" : ""}`} aria-pressed={selectedInventoryTags.includes(tag.key)} onClick={() => toggleInventoryTag(tag.key)}>{tag.label}</button>
                  <button className="delete-filter-tag" onClick={() => void removeTagFromExistence(tag.label)} aria-label={`Remove tag ${tag.label} from all cards`} title="Remove tag from all cards">×</button>
                </span> : <button key={tag.key} className={`filter-tag ${tag.kind} ${selectedInventoryTags.includes(tag.key) ? "selected" : ""}`} aria-pressed={selectedInventoryTags.includes(tag.key)} onClick={() => toggleInventoryTag(tag.key)}>{tag.label}</button>)}
              </div>
            </div>
            {syncWarning && <p className="sync-warning" role="status">{syncWarning}</p>}
            {loadingCards ? <div className="empty-state" role="status"><strong>Loading cards…</strong></div> : filteredCards.length ? <InventoryCardsEditor
              key={`${selectedInventoryTags.join("|")}:${query}:${filteredCards.map((item) => item.id).join(",")}`}
              cards={filteredCards}
              knownSets={setNames}
              onOpen={setEditingCard}
              onRemove={removeCard}
              onSave={(updatedCards, originalCards) => persistManyCards(updatedCards, originalCards, "Those inventory edits could not be saved. The previous cards were restored.")}
            /> : <div className="empty-state"><strong>No cards found</strong></div>}
          </section>
        )}
      </div>

      {adding && <AddCardModal knownSets={setNames} onClose={() => setAdding(false)} onBatch={addBatch} />}
      {editingCard && <EditCardModal card={editingCard} knownSets={setNames} onClose={() => setEditingCard(null)} onSave={updateCard} />}
      {bulkEditingCards && <BulkEditCardsModal cards={bulkEditingCards} onClose={() => setBulkEditingCards(null)} onSave={(updatedCards) => persistManyCards(updatedCards, bulkEditingCards, "Those card edits could not be saved. The previous cards were restored.")} />}
      {storageSettingsOpen && <StorageSettingsModal mode={storageMode} endpoint={storageEndpoint} onClose={() => setStorageSettingsOpen(false)} onApply={applyStorageSettings} />}
    </main>
  );
}
