import type { CardType, Flashcard } from "./types";
import { cardTypes } from "../cardTypes";
import {
  deriveNounPatternForms,
  suggestedNounArticles,
  type NounPattern,
} from "./nounPatterns";
import {
  inferArticle,
  normalizeAnswer,
  standardAdjectivePattern,
} from "../study/logic";

export type BatchRow = {
  id: string;
  english: string;
  patternId: string;
  gender: "masculine" | "feminine";
  singular: string;
  plural: string;
  definiteSingularArticle: string;
  definitePluralArticle: string;
  indefiniteArticle: string;
};

export type VerbBatchRow = {
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

export type AdjectiveBatchRow = {
  id: string;
  english: string;
  masculineSingular: string;
  feminineSingular: string;
  masculinePlural: string;
  femininePlural: string;
};

export type AdverbBatchRow = {
  id: string;
  english: string;
  form: string;
};

export type BatchDraft<Row> = {
  setName: string;
  tags: string;
  rows: Row[];
};

const cardAdderTypeKey = "parola:card-adder:type";

export function cardAdderDraftKey(type: CardType) {
  return `parola:card-adder:${type}`;
}

export function readCardAdderType(): CardType {
  if (typeof window === "undefined") return "noun";
  try {
    const stored = window.localStorage.getItem(cardAdderTypeKey);
    return cardTypes.includes(stored as CardType) ? stored as CardType : "noun";
  } catch {
    return "noun";
  }
}

export function readBatchDraft<Row>(type: CardType, createRows: () => Row[]): BatchDraft<Row> {
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

export function clearBatchDraft(type: CardType) {
  try {
    window.localStorage.removeItem(cardAdderDraftKey(type));
  } catch {
    // Draft persistence is a convenience; saving cards must still work if storage is unavailable.
  }
}

export function writeBatchDraft<Row>(type: CardType, draft: BatchDraft<Row>) {
  try {
    window.localStorage.setItem(cardAdderDraftKey(type), JSON.stringify(draft));
  } catch {
    // Keep the editor usable when the browser blocks or exhausts local storage.
  }
}

export function writeCardAdderType(type: CardType) {
  try {
    window.localStorage.setItem(cardAdderTypeKey, type);
  } catch {
    // Keep the editor usable when the browser blocks local storage.
  }
}

let nextRowId = 0;

export function newRowId() {
  nextRowId += 1;
  return `${Date.now()}-${nextRowId}`;
}

export function joinArticle(article: string, noun: string) {
  const cleanArticle = article.trim();
  const cleanNoun = noun.trim();
  if (!cleanArticle) return cleanNoun;
  return cleanArticle.endsWith("’") || cleanArticle.endsWith("'")
    ? `${cleanArticle}${cleanNoun}`
    : `${cleanArticle} ${cleanNoun}`;
}

export function parseTags(value: string) {
  return Array.from(new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean)));
}

export function localDateStamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function emptyBatchRow(id: string): BatchRow {
  return {
    id,
    english: "",
    patternId: "manual",
    gender: "masculine",
    singular: "",
    plural: "",
    definiteSingularArticle: "",
    definitePluralArticle: "",
    indefiniteArticle: "",
  };
}

export function nounFormsError(input: Pick<BatchRow, "singular" | "plural" | "definiteSingularArticle" | "definitePluralArticle" | "indefiniteArticle">) {
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

export function nounPatternError(row: BatchRow, patterns: NounPattern[]) {
  if (row.patternId === "manual") return "";
  const pattern = patterns.find((item) => item.id === row.patternId);
  if (!pattern) return "The selected noun pattern no longer exists.";
  if (!deriveNounPatternForms(pattern, row.singular)) {
    return `${pattern.name} requires a singular base ending in “${pattern.singularSuffix}”.`;
  }
  return "";
}

export function emptyVerbBatchRow(id: string): VerbBatchRow {
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

export function emptyAdjectiveBatchRow(id: string): AdjectiveBatchRow {
  return {
    id,
    english: "",
    masculineSingular: "",
    feminineSingular: "",
    masculinePlural: "",
    femininePlural: "",
  };
}

export function emptyAdverbBatchRow(id: string): AdverbBatchRow {
  return { id, english: "", form: "" };
}

export function nounCard(input: {
  id: number;
  english: string;
  setName: string | null;
  tags: string[];
  patternId: string;
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
      patternId: input.patternId,
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

export function verbCard(input: Omit<VerbBatchRow, "id"> & { id: number; setName: string | null; tags: string[] }): Flashcard {
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

export function adjectiveCard(input: Omit<AdjectiveBatchRow, "id"> & { id: number; setName: string | null; tags: string[] }): Flashcard {
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

export function adverbCard(input: Omit<AdverbBatchRow, "id"> & { id: number; setName: string | null; tags: string[] }): Flashcard {
  return { id: input.id, type: "adverb", english: input.english, italian: input.form, setName: input.setName, tags: input.tags, details: {} };
}

export function nounRowFromCard(card: Flashcard): BatchRow {
  const d = card.details;
  const singular = d.singular ?? card.italian;
  const plural = d.plural ?? "";
  return {
    id: String(card.id),
    english: card.english,
    patternId: d.patternId || "manual",
    gender: d.gender === "feminine" ? "feminine" : "masculine",
    singular,
    plural,
    definiteSingularArticle: singular ? (d.definiteSingularArticle ?? inferArticle(d.definiteSingular, singular, "")) : "",
    definitePluralArticle: plural ? (d.definitePluralArticle ?? inferArticle(d.definitePlural, plural, "")) : "",
    indefiniteArticle: singular ? (d.indefiniteArticle ?? inferArticle(d.indefinite, singular, "")) : "",
  };
}

export function verbRowFromCard(card: Flashcard): VerbBatchRow {
  return { id: String(card.id), english: card.english, infinitive: card.italian, io: card.details.io ?? "", tu: card.details.tu ?? "", luiLei: card.details.luiLei ?? "", noi: card.details.noi ?? "", voi: card.details.voi ?? "", loro: card.details.loro ?? "", auxiliary: card.details.auxiliary === "essere" ? "essere" : "avere", participle: card.details.participle ?? "" };
}

export function adjectiveRowFromCard(card: Flashcard): AdjectiveBatchRow {
  return { id: String(card.id), english: card.english, masculineSingular: card.details.masculineSingular ?? card.italian, feminineSingular: card.details.feminineSingular ?? "", masculinePlural: card.details.masculinePlural ?? "", femininePlural: card.details.femininePlural ?? "" };
}

export function adverbRowFromCard(card: Flashcard): AdverbBatchRow {
  return { id: String(card.id), english: card.english, form: card.italian };
}

export function normalizeNounRow(row: BatchRow): BatchRow {
  const singular = row.singular ?? "";
  const plural = row.plural ?? "";
  return {
    id: row.id,
    english: row.english ?? "",
    patternId: typeof row.patternId === "string" && row.patternId ? row.patternId : "manual",
    gender: row.gender === "feminine" ? "feminine" : "masculine",
    singular,
    plural,
    definiteSingularArticle: !singular.trim() ? "" : (row.definiteSingularArticle ?? ""),
    definitePluralArticle: !plural.trim() ? "" : (row.definitePluralArticle ?? ""),
    indefiniteArticle: !singular.trim() ? "" : (row.indefiniteArticle ?? ""),
  };
}

function applyPattern(row: BatchRow, patterns: NounPattern[]) {
  const pattern = patterns.find((item) => item.id === row.patternId);
  if (!pattern) return row;
  const derived = deriveNounPatternForms(pattern, row.singular);
  if (!derived) {
    return {
      ...row,
      gender: pattern.gender,
      plural: "",
      definiteSingularArticle: "",
      definitePluralArticle: "",
      indefiniteArticle: "",
    };
  }
  return {
    ...row,
    gender: derived.gender,
    plural: derived.plural,
    definiteSingularArticle: derived.definiteSingularArticle,
    definitePluralArticle: derived.definitePluralArticle,
    indefiniteArticle: derived.indefiniteArticle,
  };
}

export function updateNounRow<K extends keyof BatchRow>(row: BatchRow, field: K, value: BatchRow[K], patterns: NounPattern[] = []) {
  const nextRow = { ...row, [field]: value } as BatchRow;

  if (field === "patternId") {
    return nextRow.patternId === "manual" ? nextRow : applyPattern(nextRow, patterns);
  }

  if (row.patternId !== "manual") {
    if (field === "singular") return applyPattern(nextRow, patterns);
    return nextRow;
  }

  if (field === "singular" || field === "plural" || field === "gender") {
    const previous = suggestedNounArticles(row.gender, row.singular, row.plural);
    const next = suggestedNounArticles(nextRow.gender, nextRow.singular, nextRow.plural);
    const keepOrSuggest = (current: string, previousSuggestion: string, nextSuggestion: string) => !current || current === previousSuggestion ? nextSuggestion : current;
    return {
      ...nextRow,
      definiteSingularArticle: nextRow.singular.trim() ? keepOrSuggest(row.definiteSingularArticle, previous.definiteSingularArticle, next.definiteSingularArticle) : "",
      definitePluralArticle: nextRow.plural.trim() ? keepOrSuggest(row.definitePluralArticle, previous.definitePluralArticle, next.definitePluralArticle) : "",
      indefiniteArticle: nextRow.singular.trim() ? keepOrSuggest(row.indefiniteArticle, previous.indefiniteArticle, next.indefiniteArticle) : "",
    };
  }
  return nextRow;
}

export { suggestedNounArticles };
