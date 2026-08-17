const endpointKey = "parola:storage-endpoint";
const storageModeKey = "parola:storage-mode";

export type StorageMode = "browser" | "remote";

export function readStorageEndpoint() {
  try {
    return window.localStorage.getItem(endpointKey)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function readStorageMode(): StorageMode {
  try {
    const storedMode = window.localStorage.getItem(storageModeKey);
    if (storedMode === "browser") return "browser";
    if (storedMode === "remote" && window.localStorage.getItem(endpointKey)?.trim()) return "remote";
    return "browser";
  } catch {
    return "browser";
  }
}

export function saveStorageMode(mode: StorageMode) {
  window.localStorage.setItem(storageModeKey, mode);
}

export function saveStorageEndpoint(endpoint: string) {
  const value = endpoint.trim();
  if (value) new URL(value);
  window.localStorage.setItem(endpointKey, value);
}
