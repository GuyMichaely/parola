import type { Flashcard } from "../cards/types";
import { setActiveNounPatterns } from "../cards/nounPatternRuntime";
import {
  cloneNounPatterns,
  defaultNounPatterns,
  normalizeNounPatterns,
  type NounPattern,
} from "../cards/nounPatterns";
import { assertNoDuplicateCards, cloneCards, normalizeCard } from "./cardCodec";
import type { CardStorage } from "./types";

const cardsKey = "parola:cards";
const nounPatternsKey = "parola:noun-patterns";
const updatedAtKey = "parola:cards-updated-at";

export interface InventorySnapshot {
  cards: Flashcard[];
  nounPatterns: NounPattern[];
  updatedAt: string | null;
}

export function readLocalSnapshot(): InventorySnapshot {
  const storedCards = window.localStorage.getItem(cardsKey);
  const storedPatterns = window.localStorage.getItem(nounPatternsKey);
  const updatedAt = window.localStorage.getItem(updatedAtKey)?.trim() || null;
  const parsedCards = storedCards ? JSON.parse(storedCards) as unknown : [];
  if (!Array.isArray(parsedCards)) throw new Error("Local card storage is invalid.");
  const nounPatterns = storedPatterns
    ? normalizeNounPatterns(JSON.parse(storedPatterns) as unknown)
    : cloneNounPatterns(defaultNounPatterns);
  setActiveNounPatterns(nounPatterns);
  return { cards: parsedCards.map(normalizeCard), nounPatterns, updatedAt };
}

export function writeLocalSnapshot(snapshot: InventorySnapshot) {
  setActiveNounPatterns(snapshot.nounPatterns);
  window.localStorage.setItem(cardsKey, JSON.stringify(snapshot.cards));
  window.localStorage.setItem(nounPatternsKey, JSON.stringify(snapshot.nounPatterns));
  if (snapshot.updatedAt) window.localStorage.setItem(updatedAtKey, snapshot.updatedAt);
  else window.localStorage.removeItem(updatedAtKey);
}

export function clearLocalSnapshot() {
  window.localStorage.removeItem(cardsKey);
  window.localStorage.removeItem(nounPatternsKey);
  window.localStorage.removeItem(updatedAtKey);
}

function timestamped(cards: Flashcard[], nounPatterns: NounPattern[]): InventorySnapshot {
  return {
    cards: cloneCards(cards),
    nounPatterns: cloneNounPatterns(nounPatterns),
    updatedAt: new Date().toISOString(),
  };
}

export class BrowserStorage implements CardStorage {
  readonly label = "This browser";

  async listCards() {
    return cloneCards(readLocalSnapshot().cards);
  }

  async createCards(cards: Flashcard[]) {
    const snapshot = readLocalSnapshot();
    const existing = snapshot.cards;
    assertNoDuplicateCards(existing, cards);
    let nextId = existing.reduce((max, card) => Math.max(max, card.id), 0) + 1;
    const inserted = cards.map((card) => ({ ...card, id: nextId++ }));
    writeLocalSnapshot(timestamped([...inserted, ...existing], snapshot.nounPatterns));
    return cloneCards(inserted);
  }

  async updateCard(card: Flashcard) {
    const snapshot = readLocalSnapshot();
    const index = snapshot.cards.findIndex((item) => item.id === card.id);
    if (index < 0) throw new Error("Card not found in local storage.");
    const updated = [...snapshot.cards];
    updated[index] = cloneCards([card])[0];
    writeLocalSnapshot(timestamped(updated, snapshot.nounPatterns));
    return cloneCards([card])[0];
  }

  async deleteCard(id: number) {
    const snapshot = readLocalSnapshot();
    const updated = snapshot.cards.filter((card) => card.id !== id);
    if (updated.length === snapshot.cards.length) throw new Error("Card not found in local storage.");
    writeLocalSnapshot(timestamped(updated, snapshot.nounPatterns));
  }

  async replaceCards(cards: Flashcard[]) {
    const snapshot = readLocalSnapshot();
    const replacement = cloneCards(cards);
    writeLocalSnapshot(timestamped(replacement, snapshot.nounPatterns));
    return cloneCards(replacement);
  }

  async listNounPatterns() {
    return cloneNounPatterns(readLocalSnapshot().nounPatterns);
  }

  async replaceNounPatterns(patterns: NounPattern[]) {
    const snapshot = readLocalSnapshot();
    const replacement = normalizeNounPatterns(patterns);
    writeLocalSnapshot(timestamped(snapshot.cards, replacement));
    return cloneNounPatterns(replacement);
  }
}
