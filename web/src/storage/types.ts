import type { Flashcard } from "../cards/types";

export interface CardStorage {
  readonly label: string;
  listCards(): Promise<Flashcard[]>;
  createCards(cards: Flashcard[]): Promise<Flashcard[]>;
  updateCard(card: Flashcard): Promise<Flashcard>;
  deleteCard(id: number): Promise<void>;
  replaceCards(cards: Flashcard[]): Promise<Flashcard[]>;
  syncNow?(): Promise<Flashcard[]>;
}
