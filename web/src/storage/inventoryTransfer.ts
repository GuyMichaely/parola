import type { CardType, Flashcard } from "../cards/types";
import { cloneCards, normalizeCard } from "./cardCodec";
import type { CardStorage } from "./types";

const validTypes = new Set<CardType>(["noun", "verb", "adjective", "adverb"]);

export function serializeInventory(cards: Flashcard[]) {
  return JSON.stringify({ cards: cloneCards(cards) }, null, 2);
}

export function parseInventory(text: string) {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("That inventory is not valid JSON.");
  }

  const payload = value && typeof value === "object" && !Array.isArray(value)
    ? value as { cards?: unknown }
    : null;
  if (!payload || !Array.isArray(payload.cards)) {
    throw new Error("The inventory JSON must contain a cards array.");
  }

  return payload.cards.map((rawCard, index) => {
    let card: Flashcard;
    try {
      card = normalizeCard(rawCard);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid card.";
      throw new Error(`Card ${index + 1} is invalid: ${message}`);
    }
    if (!validTypes.has(card.type)) throw new Error(`Card ${index + 1} has an unsupported type: ${String(card.type)}.`);
    return card;
  });
}

export async function replaceInventory(storage: CardStorage, currentCards: Flashcard[], importedCards: Flashcard[]) {
  try {
    return await storage.replaceCards(importedCards);
  } catch (error) {
    try {
      await storage.replaceCards(currentCards);
    } catch {
      // Best-effort rollback; preserve the original error for the caller.
    }
    throw error;
  }
}
