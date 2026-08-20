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

const cardsKey = "parola:cards";
const nounMorphologyKey = "parola:noun-morphology";
const updatedAtKey = "parola:cards-updated-at";

export interface InventorySnapshot extends InventoryState {
  updatedAt: string | null;
}

export function readLocalSnapshot(): InventorySnapshot {
  const storedCards = window.localStorage.getItem(cardsKey);
  const storedMorphology = window.localStorage.getItem(nounMorphologyKey);
  const updatedAt = window.localStorage.getItem(updatedAtKey)?.trim() || null;
  const parsedCards = storedCards ? JSON.parse(storedCards) as unknown : [];
  if (!Array.isArray(parsedCards)) throw new Error("Local card storage is invalid.");
  const nounMorphology = storedMorphology
    ? normalizeNounMorphology(JSON.parse(storedMorphology) as unknown)
    : cloneNounMorphology(defaultNounMorphology);
  const snapshot = { cards: parsedCards.map(normalizeCard), nounMorphology, updatedAt };
  assertInventoryState(snapshot);
  return snapshot;
}

export function writeLocalSnapshot(snapshot: InventorySnapshot) {
  assertInventoryState(snapshot);
  window.localStorage.setItem(cardsKey, JSON.stringify(snapshot.cards));
  window.localStorage.setItem(nounMorphologyKey, JSON.stringify(snapshot.nounMorphology));
  if (snapshot.updatedAt) window.localStorage.setItem(updatedAtKey, snapshot.updatedAt);
  else window.localStorage.removeItem(updatedAtKey);
}

export function clearLocalSnapshot() {
  window.localStorage.removeItem(cardsKey);
  window.localStorage.removeItem(nounMorphologyKey);
  window.localStorage.removeItem(updatedAtKey);
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

  async listCards() {
    return cloneCards(readLocalSnapshot().cards);
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
