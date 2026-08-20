const endpointKey = "parola:sync-endpoint";
const persistLocalKey = "parola:sync-persist-local";
const loadPolicyKey = "parola:sync-load-policy";

export type SyncLoadPolicy = "automatic" | "ask";

export function readStorageEndpoint() {
  try {
    return window.localStorage.getItem(endpointKey)?.trim() ?? "";
  } catch {
    return "";
  }
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

export function readSyncLoadPolicy(): SyncLoadPolicy {
  try {
    return window.localStorage.getItem(loadPolicyKey) === "ask" ? "ask" : "automatic";
  } catch {
    return "automatic";
  }
}

export function saveSyncLoadPolicy(value: SyncLoadPolicy) {
  window.localStorage.setItem(loadPolicyKey, value);
}
