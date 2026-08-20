import type { CardType, Flashcard } from "../cards/types";
import {
  cloneNounMorphology,
  normalizeNounMorphology,
  type NounMorphology,
} from "../cards/nounMorphology";
import { cloneCards, normalizeCard } from "./cardCodec";
import type { CardStorage, InventoryState } from "./types";

const validTypes = new Set<CardType>(["noun", "verb", "adjective", "adverb"]);

export type InventoryTransferState = InventoryState;

export function serializeInventory(cards: Flashcard[], nounMorphology: NounMorphology) {
  return JSON.stringify({
    cards: cloneCards(cards),
    nounMorphology: cloneNounMorphology(nounMorphology),
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
    ? value as { cards?: unknown; nounMorphology?: unknown }
    : null;
  if (!payload || !Array.isArray(payload.cards) || !payload.nounMorphology) {
    throw new Error("The inventory JSON must contain cards and nounMorphology.");
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

  let nounMorphology: NounMorphology;
  try {
    nounMorphology = normalizeNounMorphology(payload.nounMorphology);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid noun morphology.";
    throw new Error(`Noun morphology is invalid: ${message}`);
  }
  return { cards, nounMorphology };
}

export async function replaceInventory(
  storage: CardStorage,
  imported: InventoryTransferState,
) {
  return storage.replaceInventory(imported);
}
