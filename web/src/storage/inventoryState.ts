import { resolvedNounForms } from "../cards/nounMorphology";
import type { InventoryState } from "./types";

function normalizeItalian(value: string) {
  return value.normalize("NFC").trim().toLocaleLowerCase("it-IT").replace(/[’`]/g, "'").replace(/\s+/g, " ");
}

export function assertInventoryState(state: InventoryState) {
  for (const card of state.cards) {
    if (card.type !== "noun") continue;
    const forms = resolvedNounForms(card, state.nounMorphology);
    const primaryForm = forms.singular || forms.plural;
    if (normalizeItalian(card.italian) !== normalizeItalian(primaryForm)) {
      throw new Error(`Noun card ${card.id} has Italian form ${card.italian} but its canonical morphology produces ${primaryForm}.`);
    }
  }
  return state;
}
