export type CardType = "noun" | "verb" | "adjective" | "adverb";

export type Flashcard = {
  id: number;
  type: CardType;
  english: string;
  italian: string;
  setName: string | null;
  tags: string[];
  details: Record<string, string>;
};
