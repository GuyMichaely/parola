import type { CardType } from "./cards/types";

export const typeLabels: Record<CardType, string> = {
  noun: "Noun",
  verb: "Verb",
  adjective: "Adjective",
  adverb: "Adverb",
};

export const cardTypes: CardType[] = ["noun", "verb", "adjective", "adverb"];
