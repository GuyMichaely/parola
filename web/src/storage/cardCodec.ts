import type { Flashcard } from "../cards/types";

export function cloneCards(cards: Flashcard[]) {
  return cards.map((card) => ({ ...card, tags: [...card.tags], details: { ...card.details } }));
}

export function normalizeCard(value: unknown): Flashcard {
  if (!value || typeof value !== "object") throw new Error("Invalid card returned by storage.");
  const card = value as Partial<Flashcard>;
  if (!Number.isFinite(card.id) || !card.type || !card.english || !card.italian) {
    throw new Error("Storage returned an incomplete card.");
  }
  return {
    id: Number(card.id),
    type: card.type,
    english: String(card.english),
    italian: String(card.italian),
    setName: typeof card.setName === "string" && card.setName ? card.setName : null,
    tags: Array.isArray(card.tags) ? card.tags.map(String) : [],
    details: card.details && typeof card.details === "object"
      ? Object.fromEntries(Object.entries(card.details).map(([key, item]) => [key, String(item)]))
      : {},
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
