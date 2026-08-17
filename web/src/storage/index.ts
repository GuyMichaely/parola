import { BrowserStorage } from "./browser";
import { RemoteStorage } from "./remote";

export type { CardType, Flashcard } from "../cards/types";
export type { CardStorage } from "./types";
export type { StorageMode } from "./settings";
export { readStorageEndpoint, readStorageMode, saveStorageEndpoint, saveStorageMode } from "./settings";

export function createCardStorage(endpoint: string) {
  const normalizedEndpoint = endpoint.trim();
  return normalizedEndpoint ? new RemoteStorage(normalizedEndpoint) : new BrowserStorage();
}
