import { BrowserStorage } from "./browser";
import { SyncStorage, setLocalSyncStatus, type SyncStorageOptions } from "./sync";
import { readSyncLoadPolicy, readSyncPersistLocal } from "./settings";

export type { CardStorage } from "./types";
export type { SyncLoadPolicy } from "./settings";
export type { SyncStatusState } from "./sync";
export {
  readStorageEndpoint,
  readSyncLoadPolicy,
  readSyncPersistLocal,
  saveStorageEndpoint,
  saveSyncLoadPolicy,
  saveSyncPersistLocal,
} from "./settings";
export { readSyncStatus, subscribeSyncStatus } from "./sync";
export { parseInventory, replaceInventory, serializeInventory } from "./inventoryTransfer";

export function createCardStorage(endpoint: string, options?: SyncStorageOptions) {
  const normalizedEndpoint = endpoint.trim();
  if (!normalizedEndpoint) {
    setLocalSyncStatus();
    return new BrowserStorage();
  }
  return new SyncStorage(normalizedEndpoint, options ?? {
    persistLocal: readSyncPersistLocal(),
    loadPolicy: readSyncLoadPolicy(),
  });
}
