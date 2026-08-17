import type { Flashcard } from "../cards/types";
import { cloneCards, normalizeCard } from "./cardCodec";
import type { CardStorage } from "./types";

const cardsKey = "parola:cards";

function readLocalCards(): Flashcard[] {
  const stored = window.localStorage.getItem(cardsKey);
  if (!stored) return [];
  const parsed = JSON.parse(stored) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Local card storage is invalid.");
  return parsed.map(normalizeCard);
}

function writeLocalCards(cards: Flashcard[]) {
  window.localStorage.setItem(cardsKey, JSON.stringify(cards));
}

export class BrowserStorage implements CardStorage {
  readonly label = "This browser";

  async listCards() {
    return cloneCards(readLocalCards());
  }

  async createCards(cards: Flashcard[]) {
    const existing = readLocalCards();
    let nextId = existing.reduce((max, card) => Math.max(max, card.id), 0) + 1;
    const inserted = cards.map((card) => ({ ...card, id: nextId++ }));
    writeLocalCards([...inserted, ...existing]);
    return cloneCards(inserted);
  }

  async updateCard(card: Flashcard) {
    const existing = readLocalCards();
    const index = existing.findIndex((item) => item.id === card.id);
    if (index < 0) throw new Error("Card not found in local storage.");
    const updated = [...existing];
    updated[index] = cloneCards([card])[0];
    writeLocalCards(updated);
    return cloneCards([card])[0];
  }

  async deleteCard(id: number) {
    const existing = readLocalCards();
    const updated = existing.filter((card) => card.id !== id);
    if (updated.length === existing.length) throw new Error("Card not found in local storage.");
    writeLocalCards(updated);
  }
}
