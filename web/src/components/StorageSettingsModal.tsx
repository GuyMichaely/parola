import { type FormEvent, useRef, useState } from "react";
import {
  createCardStorage,
  parseInventory,
  replaceInventory,
  serializeInventory,
  type StorageMode,
} from "../storage";

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
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferMessage, setTransferMessage] = useState("");
  const [transferError, setTransferError] = useState("");
  const importInput = useRef<HTMLInputElement>(null);

  function currentStorage() {
    if (mode === "remote" && !endpoint.trim()) throw new Error("The active remote storage endpoint is empty.");
    return createCardStorage(mode === "remote" ? endpoint : "");
  }

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

  async function exportInventory() {
    setTransferError("");
    setTransferMessage("");
    setTransferBusy(true);
    try {
      const cards = await currentStorage().listCards();
      const blob = new Blob([serializeInventory(cards)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `parola-inventory-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setTransferMessage(`Exported ${cards.length} ${cards.length === 1 ? "card" : "cards"} from ${mode === "remote" ? "remote" : "browser"} storage.`);
    } catch (caught) {
      setTransferError(caught instanceof Error ? caught.message : "Inventory could not be exported.");
    } finally {
      setTransferBusy(false);
    }
  }

  async function importInventory(file: File) {
    setTransferError("");
    setTransferMessage("");
    setTransferBusy(true);
    try {
      const importedCards = parseInventory(await file.text());
      const storage = currentStorage();
      const currentCards = await storage.listCards();
      const confirmed = window.confirm(
        `Replace the current ${currentCards.length}-card ${mode === "remote" ? "remote" : "browser"} inventory with the ${importedCards.length}-card inventory from ${file.name}?\n\nThis replaces the whole active inventory.`,
      );
      if (!confirmed) {
        setTransferMessage("Import canceled; the current inventory was not changed.");
        return;
      }
      const savedCards = await replaceInventory(storage, currentCards, importedCards);
      setTransferMessage(`Imported ${savedCards.length} ${savedCards.length === 1 ? "card" : "cards"}. Reloading Parola…`);
      window.location.reload();
    } catch (caught) {
      setTransferError(caught instanceof Error ? caught.message : "Inventory could not be imported.");
    } finally {
      setTransferBusy(false);
      if (importInput.current) importInput.current.value = "";
    }
  }

  return <div className="modal-backdrop" onMouseDown={() => { if (!transferBusy) onClose(); }}>
    <form className="modal storage-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
      <header className="modal-header">
        <div><h2>Storage</h2><p className="modal-subtitle">Choose which saved storage location Parola uses.</p></div>
        <button type="button" className="icon-button" onClick={onClose} disabled={transferBusy} aria-label="Close storage settings">×</button>
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
      <section className="inventory-transfer-panel" aria-label="Inventory import and export">
        <div>
          <strong>Inventory backup & restore</strong>
          <p>Export the complete inventory from the currently active <b>{mode === "remote" ? "remote" : "browser"}</b> storage, or replace it from a Parola JSON export. Draft storage changes above do not apply until you click Apply.</p>
        </div>
        <div className="inventory-transfer-actions">
          <button type="button" className="neutral-button" onClick={() => void exportInventory()} disabled={saving || transferBusy}>Export inventory</button>
          <button type="button" className="neutral-button" onClick={() => importInput.current?.click()} disabled={saving || transferBusy}>Import inventory</button>
          <input ref={importInput} type="file" accept=".json,application/json" hidden onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importInventory(file);
          }} />
        </div>
        <p className="inventory-transfer-note">Import replaces the whole active inventory. Export first if you want a backup.</p>
        {transferMessage && <p className="inventory-transfer-message" role="status">{transferMessage}</p>}
        {transferError && <p className="form-error" role="alert">{transferError}</p>}
      </section>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer className="modal-actions">
        <button type="button" className="text-button" onClick={onClose} disabled={saving || transferBusy}>Cancel</button>
        <button type="submit" className="primary-button" disabled={saving || transferBusy}>{saving ? "Checking…" : "Apply"}</button>
      </footer>
    </form>
  </div>;
}
