const endpointKey = "parola:storage-endpoint";
const legacyStorageModeKey = "parola:storage-mode";
const persistLocalKey = "parola:sync-persist-local";
const conflictPolicyKey = "parola:sync-conflict-policy";

export type StorageMode = "browser" | "remote";
export type SyncConflictPolicy = "newest" | "ask";

export function readStorageEndpoint() {
  try {
    return window.localStorage.getItem(endpointKey)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function readStorageMode(): StorageMode {
  return readStorageEndpoint() ? "remote" : "browser";
}

export function saveStorageMode(_mode: StorageMode) {
  window.localStorage.removeItem(legacyStorageModeKey);
}

export function saveStorageEndpoint(endpoint: string) {
  const value = endpoint.trim();
  if (value) new URL(value);
  if (value) window.localStorage.setItem(endpointKey, value);
  else window.localStorage.removeItem(endpointKey);
}

export function readSyncPersistLocal() {
  try {
    return window.localStorage.getItem(persistLocalKey) !== "false";
  } catch {
    return true;
  }
}

export function saveSyncPersistLocal(value: boolean) {
  window.localStorage.setItem(persistLocalKey, value ? "true" : "false");
}

export function readSyncConflictPolicy(): SyncConflictPolicy {
  try {
    return window.localStorage.getItem(conflictPolicyKey) === "newest" ? "newest" : "ask";
  } catch {
    return "ask";
  }
}

export function saveSyncConflictPolicy(value: SyncConflictPolicy) {
  window.localStorage.setItem(conflictPolicyKey, value);
}
