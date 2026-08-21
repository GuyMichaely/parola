import type { Flashcard } from "../cards/types";
import { cardTypes } from "../cardTypes";

export function cloneCards(cards: Flashcard[]) {
  return cards.map((card) => ({ ...card, tags: [...card.tags], details: { ...card.details } }));
}

function normalizeIdentityText(value: string) {
  return value.normalize("NFC").trim().toLocaleLowerCase("it-IT").replace(/\s+/g, " ");
}

export function cardDuplicateKey(card: Pick<Flashcard, "type" | "english" | "italian">) {
  return `${card.type}\u0000${normalizeIdentityText(card.english)}\u0000${normalizeIdentityText(card.italian)}`;
}

export function assertNoDuplicateCards(existing: Flashcard[], incoming: Flashcard[]) {
  const keys = new Set(existing.map(cardDuplicateKey));
  for (const card of incoming) {
    const key = cardDuplicateKey(card);
    if (keys.has(key)) throw new Error(`A ${card.type} card for “${card.italian}” / “${card.english}” already exists.`);
    keys.add(key);
  }
}

export function normalizeCard(value: unknown): Flashcard {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid card returned by storage.");
  const card = value as Partial<Flashcard>;
  if (!Number.isFinite(card.id) || !card.type || !cardTypes.includes(card.type) || !card.english || !card.italian) {
    throw new Error("Storage returned an incomplete or invalid card.");
  }
  const details = card.details && typeof card.details === "object" && !Array.isArray(card.details)
    ? Object.fromEntries(Object.entries(card.details).map(([key, item]) => [key, String(item)]))
    : {};
  if (card.type === "noun") {
    const nounKeys = Object.keys(details).sort();
    const expectedKeys = ["articleProfile", "base", "gender", "rule"];
    if (
      nounKeys.length !== expectedKeys.length
      || nounKeys.some((key, index) => key !== expectedKeys[index])
      || !details.rule
      || details.base === undefined
      || !["masculine", "feminine"].includes(details.gender)
      || !["111", "100", "010", "000"].includes(details.articleProfile)
    ) {
      throw new Error(`Noun card ${card.id} does not use the current rule/base/gender/article-profile schema.`);
    }
  }
  return {
    id: Number(card.id),
    type: card.type,
    english: String(card.english),
    italian: String(card.italian),
    setName: typeof card.setName === "string" && card.setName ? card.setName : null,
    tags: Array.isArray(card.tags) ? card.tags.map(String) : [],
    details,
  };
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
