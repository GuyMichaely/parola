import type { Flashcard } from "../cards/types";
import { cloneCards, normalizeCard } from "./cardCodec";
import type { CardStorage } from "./types";

const cardsKey = "parola:cards";
const updatedAtKey = "parola:cards-updated-at";

export interface InventorySnapshot {
  cards: Flashcard[];
  updatedAt: string | null;
}

export function readLocalSnapshot(): InventorySnapshot {
  const stored = window.localStorage.getItem(cardsKey);
  const updatedAt = window.localStorage.getItem(updatedAtKey)?.trim() || null;
  if (!stored) return { cards: [], updatedAt };
  const parsed = JSON.parse(stored) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Local card storage is invalid.");
  return { cards: parsed.map(normalizeCard), updatedAt };
}

export function writeLocalSnapshot(snapshot: InventorySnapshot) {
  window.localStorage.setItem(cardsKey, JSON.stringify(snapshot.cards));
  if (snapshot.updatedAt) window.localStorage.setItem(updatedAtKey, snapshot.updatedAt);
  else window.localStorage.removeItem(updatedAtKey);
}

export function clearLocalSnapshot() {
  window.localStorage.removeItem(cardsKey);
  window.localStorage.removeItem(updatedAtKey);
}

function timestamped(cards: Flashcard[]): InventorySnapshot {
  return { cards: cloneCards(cards), updatedAt: new Date().toISOString() };
}

export class BrowserStorage implements CardStorage {
  readonly label = "This browser";

  async listCards() {
    return cloneCards(readLocalSnapshot().cards);
  }

  async createCards(cards: Flashcard[]) {
    const existing = readLocalSnapshot().cards;
    let nextId = existing.reduce((max, card) => Math.max(max, card.id), 0) + 1;
    const inserted = cards.map((card) => ({ ...card, id: nextId++ }));
    writeLocalSnapshot(timestamped([...inserted, ...existing]));
    return cloneCards(inserted);
  }

  async updateCard(card: Flashcard) {
    const existing = readLocalSnapshot().cards;
    const index = existing.findIndex((item) => item.id === card.id);
    if (index < 0) throw new Error("Card not found in local storage.");
    const updated = [...existing];
    updated[index] = cloneCards([card])[0];
    writeLocalSnapshot(timestamped(updated));
    return cloneCards([card])[0];
  }

  async deleteCard(id: number) {
    const existing = readLocalSnapshot().cards;
    const updated = existing.filter((card) => card.id !== id);
    if (updated.length === existing.length) throw new Error("Card not found in local storage.");
    writeLocalSnapshot(timestamped(updated));
  }

  async replaceCards(cards: Flashcard[]) {
    const replacement = cloneCards(cards);
    writeLocalSnapshot(timestamped(replacement));
    return cloneCards(replacement);
  }
}
