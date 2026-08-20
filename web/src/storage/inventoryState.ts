import { resolvedNounForms } from "../cards/nounMorphology";
import type { InventoryState } from "./types";

function normalizeItalian(value: string) {
  return value.normalize("NFC").trim().toLocaleLowerCase("it-IT").replace(/[’`]/g, "'").replace(/\s+/g, " ");
}

function assertSyntaxSemantics(state: InventoryState) {
  for (const syntax of state.nounMorphology.syntaxRules) {
    const tantum = syntax.markers.find((marker) => marker.kind === "tantum");
    if (tantum && (syntax.numberMode === "both" || tantum.value !== syntax.numberMode)) {
      throw new Error(`Noun syntax ${syntax.name} has a ${tantum.value}-only marker that conflicts with its ${syntax.numberMode} number mode.`);
    }

    if (syntax.numberMode !== "both") {
      const conflictingField = syntax.fields.find((field) => field.number !== syntax.numberMode);
      if (conflictingField) {
        throw new Error(`Noun syntax ${syntax.name} is ${syntax.numberMode}-only but contains a ${conflictingField.number} field.`);
      }
    }
  }
}

export function assertInventoryState(state: InventoryState) {
  assertSyntaxSemantics(state);
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
