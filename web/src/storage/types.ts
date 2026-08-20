import type { Flashcard } from "../cards/types";
import type { NounMorphology } from "../cards/nounMorphology";

export type InventoryState = {
  cards: Flashcard[];
  nounMorphology: NounMorphology;
};

export interface CardStorage {
  readonly label: string;
  readInventory(): Promise<InventoryState>;
  createCards(cards: Flashcard[]): Promise<Flashcard[]>;
  updateCard(card: Flashcard): Promise<Flashcard>;
  deleteCard(id: number): Promise<void>;
  replaceInventory(state: InventoryState): Promise<InventoryState>;
  syncNow?(): Promise<InventoryState>;
}
