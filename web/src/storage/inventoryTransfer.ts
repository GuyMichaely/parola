import type { CardType, Flashcard } from "../cards/types";
import { cloneCards, normalizeCard } from "./cardCodec";
import type { CardStorage } from "./types";

const inventoryFormat = "parola-inventory";
const inventoryVersion = 1;
const validTypes = new Set<CardType>(["noun", "verb", "adjective", "adverb"]);

export function serializeInventory(cards: Flashcard[]) {
  return JSON.stringify({
    format: inventoryFormat,
    version: inventoryVersion,
    exportedAt: new Date().toISOString(),
    cards: cloneCards(cards),
  }, null, 2);
}

export function parseInventory(text: string) {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("That file is not valid JSON.");
  }

  const payload = value && typeof value === "object" ? value as { format?: unknown; version?: unknown; cards?: unknown } : null;
  if (payload?.format !== undefined && payload.format !== inventoryFormat) {
    throw new Error("That JSON file is not a Parola inventory export.");
  }
  if (payload?.version !== undefined && payload.version !== inventoryVersion) {
    throw new Error(`Unsupported Parola inventory version: ${String(payload.version)}.`);
  }

  const rawCards = Array.isArray(value) ? value : payload && Array.isArray(payload.cards) ? payload.cards : null;
  if (!rawCards) throw new Error("The inventory file must contain a cards array.");

  return rawCards.map((rawCard, index) => {
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

async function clearInventory(storage: CardStorage, cards: Flashcard[]) {
  for (const card of cards) await storage.deleteCard(card.id);
}

export async function replaceInventory(storage: CardStorage, currentCards: Flashcard[], importedCards: Flashcard[]) {
  try {
    await clearInventory(storage, currentCards);
    return importedCards.length ? await storage.createCards(importedCards) : [];
  } catch (error) {
    try {
      const remaining = await storage.listCards();
      await clearInventory(storage, remaining);
      if (currentCards.length) await storage.createCards(currentCards);
    } catch {
      // Best-effort rollback; preserve the original error for the caller.
    }
    throw error;
  }
}
