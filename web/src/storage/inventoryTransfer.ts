import type { CardType, Flashcard } from "../cards/types";
import {
  cloneNounPatterns,
  normalizeNounPatterns,
  type NounPattern,
} from "../cards/nounPatterns";
import { cloneCards, normalizeCard } from "./cardCodec";
import type { CardStorage } from "./types";

const validTypes = new Set<CardType>(["noun", "verb", "adjective", "adverb"]);

export type InventoryTransferState = {
  cards: Flashcard[];
  nounPatterns: NounPattern[];
};

export function serializeInventory(cards: Flashcard[], nounPatterns: NounPattern[]) {
  return JSON.stringify({
    cards: cloneCards(cards),
    nounPatterns: cloneNounPatterns(nounPatterns),
  }, null, 2);
}

export function parseInventory(text: string): InventoryTransferState {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("That inventory is not valid JSON.");
  }

  const payload = value && typeof value === "object" && !Array.isArray(value)
    ? value as { cards?: unknown; nounPatterns?: unknown }
    : null;
  if (!payload || !Array.isArray(payload.cards) || !Array.isArray(payload.nounPatterns)) {
    throw new Error("The inventory JSON must contain cards and nounPatterns arrays.");
  }

  const cards = payload.cards.map((rawCard, index) => {
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

  let nounPatterns: NounPattern[];
  try {
    nounPatterns = normalizeNounPatterns(payload.nounPatterns);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid noun patterns.";
    throw new Error(`Noun patterns are invalid: ${message}`);
  }
  return { cards, nounPatterns };
}

export async function replaceInventory(
  storage: CardStorage,
  current: InventoryTransferState,
  imported: InventoryTransferState,
) {
  try {
    await storage.replaceNounPatterns(imported.nounPatterns);
    const cards = await storage.replaceCards(imported.cards);
    return { cards, nounPatterns: await storage.listNounPatterns() };
  } catch (error) {
    try {
      await storage.replaceNounPatterns(current.nounPatterns);
      await storage.replaceCards(current.cards);
    } catch {
      // Best-effort rollback; preserve the original error for the caller.
    }
    throw error;
  }
}
