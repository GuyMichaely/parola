import type { CardType, Flashcard } from "../cards/types";
import { normalizeNounArticleProfile } from "../cards/nounMorphology";
import { cardTypes } from "../cardTypes";

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

function stringField(value: unknown) {
  return String(value ?? "");
}

export function cloneCards(cards: Flashcard[]): Flashcard[] {
  return cards.map((card) => {
    if (card.type === "noun") {
      return {
        ...card,
        tags: [...card.tags],
        details: {
          ...card.details,
          articleProfile: { ...card.details.articleProfile },
        },
      };
    }
    return { ...card, tags: [...card.tags], details: { ...card.details } } as Flashcard;
  });
}

function normalizeIdentityText(value: string) {
  return value.normalize("NFC").trim().toLocaleLowerCase("it-IT").replace(/\s+/g, " ");
}

function nounIdentity(card: Extract<Flashcard, { type: "noun" }>) {
  return `${normalizeIdentityText(card.details.rule)}\u0000${normalizeIdentityText(card.details.base)}`;
}

export function cardDuplicateKey(card: Flashcard) {
  const italianIdentity = card.type === "noun" ? nounIdentity(card) : normalizeIdentityText(card.italian);
  return `${card.type}\u0000${normalizeIdentityText(card.english)}\u0000${italianIdentity}`;
}

function cardIdentityLabel(card: Flashcard) {
  return card.type === "noun" ? `${card.details.rule} / base ${card.details.base || "∅"}` : card.italian;
}

export function assertNoDuplicateCards(existing: Flashcard[], incoming: Flashcard[]) {
  const keys = new Set(existing.map(cardDuplicateKey));
  for (const card of incoming) {
    const key = cardDuplicateKey(card);
    if (keys.has(key)) throw new Error(`A ${card.type} card for “${cardIdentityLabel(card)}” / “${card.english}” already exists.`);
    keys.add(key);
  }
}

export function normalizeCard(value: unknown): Flashcard {
  const raw = objectValue(value, "Card");
  const id = Number(raw.id);
  const type = raw.type;
  const english = String(raw.english ?? "");
  if (!Number.isFinite(id) || typeof type !== "string" || !cardTypes.includes(type as CardType) || !english) {
    throw new Error("Storage returned an incomplete or invalid card.");
  }

  const common = {
    id,
    english,
    setName: typeof raw.setName === "string" && raw.setName ? raw.setName : null,
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
  };
  const details = objectValue(raw.details, `${type} card ${id} details`);

  if (type === "noun") {
    if (Object.prototype.hasOwnProperty.call(raw, "italian")) {
      throw new Error(`Noun card ${id} must not store a derived italian field.`);
    }
    assertExactKeys(details, `Noun card ${id} details`, ["articleProfile", "base", "gender", "rule"]);
    const rule = String(details.rule ?? "").trim();
    const gender = details.gender;
    if (!rule || (gender !== "masculine" && gender !== "feminine")) {
      throw new Error(`Noun card ${id} does not use the current rule/base/gender/article-profile schema.`);
    }
    return {
      ...common,
      type: "noun",
      details: {
        rule,
        base: String(details.base ?? "").normalize("NFC"),
        gender,
        articleProfile: normalizeNounArticleProfile(details.articleProfile, `Noun card ${id} article profile`),
      },
    };
  }

  const italian = String(raw.italian ?? "");
  if (!italian) throw new Error(`Storage returned a ${type} card without an Italian form.`);

  if (type === "verb") {
    assertExactKeys(details, `Verb card ${id} details`, ["io", "tu", "luiLei", "noi", "voi", "loro", "auxiliary", "participle"]);
    const auxiliary = details.auxiliary;
    if (auxiliary !== "avere" && auxiliary !== "essere") throw new Error(`Verb card ${id} has an invalid auxiliary.`);
    return {
      ...common,
      type: "verb",
      italian,
      details: {
        io: stringField(details.io),
        tu: stringField(details.tu),
        luiLei: stringField(details.luiLei),
        noi: stringField(details.noi),
        voi: stringField(details.voi),
        loro: stringField(details.loro),
        auxiliary,
        participle: stringField(details.participle),
      },
    };
  }

  if (type === "adjective") {
    assertExactKeys(details, `Adjective card ${id} details`, ["masculineSingular", "feminineSingular", "masculinePlural", "femininePlural"]);
    return {
      ...common,
      type: "adjective",
      italian,
      details: {
        masculineSingular: stringField(details.masculineSingular),
        feminineSingular: stringField(details.feminineSingular),
        masculinePlural: stringField(details.masculinePlural),
        femininePlural: stringField(details.femininePlural),
      },
    };
  }

  assertExactKeys(details, `Adverb card ${id} details`, []);
  return { ...common, type: "adverb", italian, details: {} };
}

export function parseCardsResponse(value: unknown): Flashcard[] {
  const payload = value as { cards?: unknown };
  const cards = Array.isArray(value) ? value : payload && Array.isArray(payload.cards) ? payload.cards : null;
  if (!cards) throw new Error("Remote API did not return a cards array.");
  return cards.map(normalizeCard);
}

export function parseCardResponse(value: unknown): Flashcard {
  const payload = value as { card?: unknown };
  return normalizeCard(payload && payload.card ? payload.card : value);
}
