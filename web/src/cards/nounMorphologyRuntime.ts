import {
  cloneNounMorphology,
  defaultNounMorphology,
  type NounMorphology,
} from "./nounMorphology";

let activeNounMorphology = cloneNounMorphology(defaultNounMorphology);

export function getActiveNounMorphology() {
  return cloneNounMorphology(activeNounMorphology);
}

export function setActiveNounMorphology(morphology: NounMorphology) {
  activeNounMorphology = cloneNounMorphology(morphology);
}
