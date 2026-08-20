import type { Flashcard } from "../cards/types";
import type { NounPattern } from "../cards/nounPatterns";

export interface CardStorage {
  readonly label: string;
  listCards(): Promise<Flashcard[]>;
  createCards(cards: Flashcard[]): Promise<Flashcard[]>;
  updateCard(card: Flashcard): Promise<Flashcard>;
  deleteCard(id: number): Promise<void>;
  replaceCards(cards: Flashcard[]): Promise<Flashcard[]>;
  listNounPatterns(): Promise<NounPattern[]>;
  replaceNounPatterns(patterns: NounPattern[]): Promise<NounPattern[]>;
  syncNow?(): Promise<Flashcard[]>;
}
