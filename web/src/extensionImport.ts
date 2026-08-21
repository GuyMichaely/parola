import type { Flashcard } from "./cards/types";
import type { NounMorphology } from "./cards/nounMorphology";
import { normalizeCard } from "./storage/cardCodec";
import { assertInventoryState } from "./storage/inventoryState";

export const extensionImportRequestType = "parola-extension-import";
export const extensionImportResultType = "parola-extension-import-result";

export type ExtensionImportRequest = {
  source: "parola-capture-extension";
  type: typeof extensionImportRequestType;
  requestId: string;
  candidates: unknown[];
};

export type ExtensionImportResult = {
  source: "parola-web";
  type: typeof extensionImportResultType;
  requestId: string;
  ok: boolean;
  importedCount?: number;
  storage?: "browser" | "sync";
  error?: string;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFC").trim();
}

export function parseExtensionImportRequest(value: unknown): ExtensionImportRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Partial<ExtensionImportRequest>;
  if (request.source !== "parola-capture-extension" || request.type !== extensionImportRequestType) return null;
  const requestId = text(request.requestId);
  if (!requestId || !Array.isArray(request.candidates) || !request.candidates.length) {
    throw new Error("Extension import request is incomplete.");
  }
  return { source: "parola-capture-extension", type: extensionImportRequestType, requestId, candidates: request.candidates };
}

export function extensionCandidatesToCards(values: unknown[], morphology: NounMorphology): Flashcard[] {
  const cards = values.map(normalizeCard);
  assertInventoryState({ cards, nounMorphology: morphology });
  return cards;
}
