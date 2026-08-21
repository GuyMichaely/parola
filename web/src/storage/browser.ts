import type { Flashcard } from "../cards/types";
import {
  cloneNounMorphology,
  defaultNounMorphology,
  normalizeNounMorphology,
  type NounMorphology,
} from "../cards/nounMorphology";
import { assertNoDuplicateCards, cloneCards, normalizeCard } from "./cardCodec";
import { assertInventoryState } from "./inventoryState";
import type { CardStorage, InventoryState } from "./types";

const inventoryKey = "parola:inventory";

export interface InventorySnapshot extends InventoryState {
  updatedAt: string | null;
}

export function readLocalSnapshot(): InventorySnapshot {
  const stored = window.localStorage.getItem(inventoryKey);
  if (!stored) {
    return {
      cards: [],
      nounMorphology: cloneNounMorphology(defaultNounMorphology),
      updatedAt: null,
    };
  }

  const parsed = JSON.parse(stored) as {
    cards?: unknown;
    nounMorphology?: unknown;
    updatedAt?: unknown;
  };
  if (!Array.isArray(parsed.cards)) throw new Error("Local inventory cards are invalid.");
  if (!parsed.nounMorphology) throw new Error("Local inventory does not contain nounMorphology.");

  const snapshot: InventorySnapshot = {
    cards: parsed.cards.map(normalizeCard),
    nounMorphology: normalizeNounMorphology(parsed.nounMorphology),
    updatedAt: typeof parsed.updatedAt === "string" && parsed.updatedAt.trim() ? parsed.updatedAt : null,
  };
  assertInventoryState(snapshot);
  return snapshot;
}

export function writeLocalSnapshot(snapshot: InventorySnapshot) {
  assertInventoryState(snapshot);
  window.localStorage.setItem(inventoryKey, JSON.stringify({
    cards: snapshot.cards,
    nounMorphology: snapshot.nounMorphology,
    updatedAt: snapshot.updatedAt,
  }));
}

export function clearLocalSnapshot() {
  window.localStorage.removeItem(inventoryKey);
}

function timestamped(cards: Flashcard[], nounMorphology: NounMorphology): InventorySnapshot {
  return {
    cards: cloneCards(cards),
    nounMorphology: cloneNounMorphology(nounMorphology),
    updatedAt: new Date().toISOString(),
  };
}

function cloneState(state: InventoryState): InventoryState {
  return {
    cards: cloneCards(state.cards),
    nounMorphology: cloneNounMorphology(state.nounMorphology),
  };
}

export class BrowserStorage implements CardStorage {
  readonly label = "This browser";

  async readInventory() {
    return cloneState(readLocalSnapshot());
  }

  async createCards(cards: Flashcard[]) {
    const snapshot = readLocalSnapshot();
    const existing = snapshot.cards;
    assertNoDuplicateCards(existing, cards);
    let nextId = existing.reduce((max, card) => Math.max(max, card.id), 0) + 1;
    const inserted = cards.map((card) => ({ ...card, id: nextId++ }));
    writeLocalSnapshot(timestamped([...inserted, ...existing], snapshot.nounMorphology));
    return cloneCards(inserted);
  }

  async updateCard(card: Flashcard) {
    const snapshot = readLocalSnapshot();
    const index = snapshot.cards.findIndex((item) => item.id === card.id);
    if (index < 0) throw new Error("Card not found in local storage.");
    const updated = [...snapshot.cards];
    updated[index] = cloneCards([card])[0];
    writeLocalSnapshot(timestamped(updated, snapshot.nounMorphology));
    return cloneCards([card])[0];
  }

  async deleteCard(id: number) {
    const snapshot = readLocalSnapshot();
    const updated = snapshot.cards.filter((card) => card.id !== id);
    if (updated.length === snapshot.cards.length) throw new Error("Card not found in local storage.");
    writeLocalSnapshot(timestamped(updated, snapshot.nounMorphology));
  }

  async replaceInventory(state: InventoryState) {
    const replacement = assertInventoryState({
      cards: cloneCards(state.cards),
      nounMorphology: normalizeNounMorphology(state.nounMorphology),
    });
    writeLocalSnapshot(timestamped(replacement.cards, replacement.nounMorphology));
    return cloneState(replacement);
  }
}
