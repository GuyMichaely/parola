from pathlib import Path
import re

APP = Path("web/src/App.tsx")
STORAGE = Path("web/src/storage.ts")
STYLES = Path("web/src/styles.css")

# --- storage.ts -----------------------------------------------------------
storage = STORAGE.read_text()

storage = storage.replace(
    'const cardsKey = "parola:cards:v1";\nconst endpointKey = "parola:storage-endpoint:v1";',
    'const cardsKey = "parola:cards:v1";\nconst endpointKey = "parola:storage-endpoint:v1";\nconst storageModeKey = "parola:storage-mode:v1";\nconst defaultRemoteEndpoint = "https://parola-api-12706-4372.azurewebsites.net/cards";\n\nexport type StorageMode = "browser" | "remote";'
)

old_read_endpoint = '''export function readStorageEndpoint() {
  try {
    return window.localStorage.getItem(endpointKey)?.trim() ?? "";
  } catch {
    return "";
  }
}
'''
new_read_endpoint = '''export function readStorageEndpoint() {
  try {
    const stored = window.localStorage.getItem(endpointKey);
    return stored === null ? defaultRemoteEndpoint : stored.trim();
  } catch {
    return defaultRemoteEndpoint;
  }
}

export function readStorageMode(): StorageMode {
  try {
    const storedMode = window.localStorage.getItem(storageModeKey);
    if (storedMode === "browser" || storedMode === "remote") return storedMode;
    // Preserve the old behavior for devices that had explicitly saved an endpoint
    // before storage mode became a separate setting. New devices stay local.
    return window.localStorage.getItem(endpointKey)?.trim() ? "remote" : "browser";
  } catch {
    return "browser";
  }
}

export function saveStorageMode(mode: StorageMode) {
  window.localStorage.setItem(storageModeKey, mode);
}
'''
if old_read_endpoint not in storage:
    raise SystemExit("readStorageEndpoint block not found")
storage = storage.replace(old_read_endpoint, new_read_endpoint)
STORAGE.write_text(storage)

# --- App.tsx --------------------------------------------------------------
app = APP.read_text()

old_import = 'import { createCardStorage, readStorageEndpoint, saveStorageEndpoint, type CardStorage, type CardType, type Flashcard } from "./storage";'
new_import = 'import { createCardStorage, readStorageEndpoint, readStorageMode, saveStorageEndpoint, saveStorageMode, type CardStorage, type CardType, type Flashcard, type StorageMode } from "./storage";'
if old_import not in app:
    raise SystemExit("storage import not found")
app = app.replace(old_import, new_import)

new_modal = r'''function StorageSettingsModal({
  mode,
  endpoint,
  onClose,
  onApply,
}: {
  mode: StorageMode;
  endpoint: string;
  onClose: () => void;
  onApply: (mode: StorageMode, endpoint: string) => Promise<void>;
}) {
  const [draftMode, setDraftMode] = useState<StorageMode>(mode);
  const [draftEndpoint, setDraftEndpoint] = useState(endpoint);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (draftMode === "remote" && !draftEndpoint.trim()) {
      setError("Enter a remote API endpoint before selecting remote storage.");
      return;
    }
    setSaving(true);
    try {
      await onApply(draftMode, draftEndpoint.trim());
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Storage could not be changed.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <form className="modal storage-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
      <header className="modal-header">
        <div><h2>Storage</h2><p className="modal-subtitle">Choose which saved storage location Parola uses.</p></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close storage settings">×</button>
      </header>
      <div className="storage-option-copy">
        <strong>The endpoint and active storage mode are saved separately.</strong>
        <p>You can keep the Azure endpoint saved here while continuing to use browser localStorage. Switching storage changes which inventory is shown; it does not copy cards between locations.</p>
      </div>
      <div className="storage-mode-options" role="radiogroup" aria-label="Active card storage">
        <label className={draftMode === "browser" ? "selected" : ""}>
          <input type="radio" name="storage-mode" checked={draftMode === "browser"} onChange={() => setDraftMode("browser")} />
          <span><strong>Browser</strong><small>Use this browser's localStorage.</small></span>
        </label>
        <label className={draftMode === "remote" ? "selected" : ""}>
          <input type="radio" name="storage-mode" checked={draftMode === "remote"} onChange={() => setDraftMode("remote")} />
          <span><strong>Remote</strong><small>Use the saved API endpoint.</small></span>
        </label>
      </div>
      <label className="field full-field">
        <span>Remote API endpoint</span>
        <input
          type="url"
          inputMode="url"
          value={draftEndpoint}
          onChange={(event) => setDraftEndpoint(event.target.value)}
          placeholder="https://example.com/api/cards"
          autoComplete="off"
        />
      </label>
      <div className="api-contract">
        <strong>Expected API</strong>
        <code>GET endpoint → {`{ cards: [...] }`}</code>
        <code>POST endpoint ← {`{ cards: [...] }`}</code>
        <code>PUT endpoint ← one card</code>
        <code>DELETE endpoint?id=123</code>
        <p>The endpoint must allow browser requests from the site where Parola is hosted (CORS).</p>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer className="modal-actions">
        <button type="button" className="text-button" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" className="primary-button" disabled={saving}>{saving ? "Checking…" : "Apply"}</button>
      </footer>
    </form>
  </div>;
}

function StudyScope('''

app, count = re.subn(
    r'function StorageSettingsModal\(\{.*?\n\}\n\nfunction StudyScope\(',
    new_modal,
    app,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("StorageSettingsModal block not found")

old_state = '''  const [storageEndpoint, setStorageEndpoint] = useState(readStorageEndpoint);
  const [storageSettingsOpen, setStorageSettingsOpen] = useState(false);
  const storage = useMemo<CardStorage>(() => createCardStorage(storageEndpoint), [storageEndpoint]);'''
new_state = '''  const [storageEndpoint, setStorageEndpoint] = useState(readStorageEndpoint);
  const [storageMode, setStorageMode] = useState<StorageMode>(readStorageMode);
  const [storageSettingsOpen, setStorageSettingsOpen] = useState(false);
  const activeStorageEndpoint = storageMode === "remote" ? storageEndpoint : "";
  const storage = useMemo<CardStorage>(() => createCardStorage(activeStorageEndpoint), [activeStorageEndpoint]);'''
if old_state not in app:
    raise SystemExit("storage state block not found")
app = app.replace(old_state, new_state)

old_apply = '''  async function applyStorageEndpoint(endpoint: string) {
    const candidate = createCardStorage(endpoint);
    const nextCards = await candidate.listCards();
    saveStorageEndpoint(endpoint);
    setStorageEndpoint(endpoint.trim());
    setCards(nextCards);
    setSyncWarning("");
    setSaveState("idle");
    setCurrent(0);
    setSessionComplete(false);
  }'''
new_apply = '''  async function applyStorageSettings(mode: StorageMode, endpoint: string) {
    const normalizedEndpoint = endpoint.trim();
    if (mode === "remote" && !normalizedEndpoint) throw new Error("Enter a remote API endpoint before selecting remote storage.");
    const candidate = createCardStorage(mode === "remote" ? normalizedEndpoint : "");
    const nextCards = await candidate.listCards();
    saveStorageEndpoint(normalizedEndpoint);
    saveStorageMode(mode);
    setStorageEndpoint(normalizedEndpoint);
    setStorageMode(mode);
    setCards(nextCards);
    setSyncWarning("");
    setSaveState("idle");
    setCurrent(0);
    setSessionComplete(false);
  }'''
if old_apply not in app:
    raise SystemExit("applyStorageEndpoint block not found")
app = app.replace(old_apply, new_apply)

old_button = '''            <button className="storage-button" onClick={() => setStorageSettingsOpen(true)} title={storageEndpoint ? `Remote storage: ${storage.label}` : "Cards are stored in this browser"}>
              <span className={`storage-dot ${storageEndpoint ? "remote" : "local"}`} />
              {storageEndpoint ? "Remote" : "Browser"}
            </button>'''
new_button = '''            <button className="storage-button" onClick={() => setStorageSettingsOpen(true)} title={storageMode === "remote" ? `Remote storage: ${storage.label}` : storageEndpoint ? "Cards are stored in this browser; a remote endpoint is saved" : "Cards are stored in this browser"}>
              <span className={`storage-dot ${storageMode === "remote" ? "remote" : "local"}`} />
              {storageMode === "remote" ? "Remote" : "Browser"}
            </button>'''
if old_button not in app:
    raise SystemExit("storage header button not found")
app = app.replace(old_button, new_button)

old_invocation = '{storageSettingsOpen && <StorageSettingsModal endpoint={storageEndpoint} onClose={() => setStorageSettingsOpen(false)} onApply={applyStorageEndpoint} />}'
new_invocation = '{storageSettingsOpen && <StorageSettingsModal mode={storageMode} endpoint={storageEndpoint} onClose={() => setStorageSettingsOpen(false)} onApply={applyStorageSettings} />}'
if old_invocation not in app:
    raise SystemExit("storage modal invocation not found")
app = app.replace(old_invocation, new_invocation)

APP.write_text(app)

# --- styles.css -----------------------------------------------------------
styles = STYLES.read_text()
marker = '.storage-option-copy strong { font-size: 12px; }\n'
addition = '''.storage-mode-options { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin: 0 0 16px; }
.storage-mode-options label { display: flex; align-items: center; gap: 10px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface); padding: 11px 12px; cursor: pointer; }
.storage-mode-options label.selected { border-color: #4576b9; background: #172b45; }
.storage-mode-options input { margin: 0; accent-color: var(--accent); }
.storage-mode-options span { display: flex; flex-direction: column; gap: 2px; }
.storage-mode-options strong { font-size: 11px; }
.storage-mode-options small { color: var(--muted); font-size: 9px; }
'''
if marker not in styles:
    raise SystemExit("storage CSS marker not found")
styles = styles.replace(marker, marker + addition)
STYLES.write_text(styles)

print("Applied saved-endpoint/active-storage-mode separation.")
