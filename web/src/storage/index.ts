import { BrowserStorage } from "./browser";
import { RemoteStorage } from "./remote";

export type { CardStorage } from "./types";
export type { StorageMode } from "./settings";
export { readStorageEndpoint, readStorageMode, saveStorageEndpoint, saveStorageMode } from "./settings";
export { parseInventory, replaceInventory, serializeInventory } from "./inventoryTransfer";

export function createCardStorage(endpoint: string) {
  const normalizedEndpoint = endpoint.trim();
  return normalizedEndpoint ? new RemoteStorage(normalizedEndpoint) : new BrowserStorage();
}
