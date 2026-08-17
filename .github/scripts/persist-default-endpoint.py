from pathlib import Path

storage_path = Path("web/src/storage.ts")
storage = storage_path.read_text()

old = '''export function readStorageEndpoint() {
  try {
    const stored = window.localStorage.getItem(endpointKey);
    return stored === null ? defaultRemoteEndpoint : stored.trim();
  } catch {
    return defaultRemoteEndpoint;
  }
}
'''
new = '''export function readStorageEndpoint() {
  try {
    const stored = window.localStorage.getItem(endpointKey);
    if (stored !== null) return stored.trim();
    window.localStorage.setItem(endpointKey, defaultRemoteEndpoint);
    return defaultRemoteEndpoint;
  } catch {
    return defaultRemoteEndpoint;
  }
}
'''
if old not in storage:
    raise SystemExit("readStorageEndpoint block not found")
storage_path.write_text(storage.replace(old, new))

app_path = Path("web/src/App.tsx")
app = app_path.read_text()
old_state = '''  const [storageEndpoint, setStorageEndpoint] = useState(readStorageEndpoint);
  const [storageMode, setStorageMode] = useState<StorageMode>(readStorageMode);'''
new_state = '''  const [storageMode, setStorageMode] = useState<StorageMode>(readStorageMode);
  const [storageEndpoint, setStorageEndpoint] = useState(readStorageEndpoint);'''
if old_state not in app:
    raise SystemExit("storage state ordering block not found")
app_path.write_text(app.replace(old_state, new_state))

print("Persisted the default remote endpoint independently from storage mode.")
