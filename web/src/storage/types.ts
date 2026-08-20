import type { Flashcard } from "../cards/types";
import type { NounMorphology } from "../cards/nounMorphology";

export interface CardStorage {
  readonly label: string;
  listCards(): Promise<Flashcard[]>;
  createCards(cards: Flashcard[]): Promise<Flashcard[]>;
  updateCard(card: Flashcard): Promise<Flashcard>;
  deleteCard(id: number): Promise<void>;
  replaceCards(cards: Flashcard[]): Promise<Flashcard[]>;
  listNounMorphology(): Promise<NounMorphology>;
  replaceNounMorphology(morphology: NounMorphology): Promise<NounMorphology>;
  syncNow?(): Promise<Flashcard[]>;
}
