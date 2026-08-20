import {
  cloneNounPatterns,
  defaultNounPatterns,
  type NounPattern,
} from "./nounPatterns";

let activeNounPatterns = cloneNounPatterns(defaultNounPatterns);

export function getActiveNounPatterns() {
  return cloneNounPatterns(activeNounPatterns);
}

export function setActiveNounPatterns(patterns: NounPattern[]) {
  activeNounPatterns = cloneNounPatterns(patterns);
}
