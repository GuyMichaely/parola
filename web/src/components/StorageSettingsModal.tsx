import { type FormEvent, useState } from "react";
import type { StorageMode } from "../storage";

export function StorageSettingsModal({
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

