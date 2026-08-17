import type { Flashcard } from "../cards/types";
import type { PromptLanguage } from "../components/StudyOptions";

export type StudyItem = {
  key: string;
  card: Flashcard;
  promptLanguage: PromptLanguage;
};

export function shuffled<T>(items: T[], seed: number) {
  const result = [...items];
  let state = seed >>> 0 || 1;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const swapIndex = state % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function withEnglishPromptFirst(items: StudyItem[]) {
  const result = [...items];
  const positions = new Map<number, Partial<Record<PromptLanguage, number>>>();
  result.forEach((item, index) => {
    positions.set(item.card.id, { ...positions.get(item.card.id), [item.promptLanguage]: index });
  });
  positions.forEach(({ english, italian }) => {
    if (english !== undefined && italian !== undefined && english > italian) {
      [result[english], result[italian]] = [result[italian], result[english]];
    }
  });
  return result;
}
