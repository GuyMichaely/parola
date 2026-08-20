import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  parseInventory,
  readSyncStatus,
  replaceInventory,
  serializeInventory,
  subscribeSyncStatus,
  type CardStorage,
  type SyncLoadPolicy,
} from "../storage";

export function StorageSettingsModal({
  storage,
  endpoint,
  persistLocal,
  loadPolicy,
  onClose,
  onApply,
  onSyncNow,
}: {
  storage: CardStorage;
  endpoint: string;
  persistLocal: boolean;
  loadPolicy: SyncLoadPolicy;
  onClose: () => void;
  onApply: (endpoint: string, persistLocal: boolean, loadPolicy: SyncLoadPolicy) => Promise<void>;
  onSyncNow: () => Promise<void>;
}) {
  const [draftEndpoint, setDraftEndpoint] = useState(endpoint);
  const [draftPersistLocal, setDraftPersistLocal] = useState(persistLocal);
  const [draftLoadPolicy, setDraftLoadPolicy] = useState<SyncLoadPolicy>(loadPolicy);
  const [syncStatus, setSyncStatus] = useState(readSyncStatus);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferMessage, setTransferMessage] = useState("");
  const [transferError, setTransferError] = useState("");
  const [importText, setImportText] = useState("");
  const importInput = useRef<HTMLInputElement>(null);
  const syncConfigured = Boolean(endpoint.trim());
  const draftSyncConfigured = Boolean(draftEndpoint.trim());

  useEffect(() => subscribeSyncStatus(setSyncStatus), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const normalizedEndpoint = draftEndpoint.trim();
      await onApply(normalizedEndpoint, normalizedEndpoint ? draftPersistLocal : true, draftLoadPolicy);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sync settings could not be changed.");
    } finally {
      setSaving(false);
    }
  }

  async function exportInventory() {
    setTransferError("");
    setTransferMessage("");
    setTransferBusy(true);
    try {
      const cards = await storage.listCards();
      const blob = new Blob([serializeInventory(cards)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `parola-inventory-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setTransferMessage(`Exported ${cards.length} ${cards.length === 1 ? "card" : "cards"}.`);
    } catch (caught) {
      setTransferError(caught instanceof Error ? caught.message : "Inventory could not be exported.");
    } finally {
      setTransferBusy(false);
    }
  }

  async function copyInventory() {
    setTransferError("");
    setTransferMessage("");
    setTransferBusy(true);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is not available in this browser context.");
      const cards = await storage.listCards();
      await navigator.clipboard.writeText(serializeInventory(cards));
      setTransferMessage(`Copied ${cards.length} ${cards.length === 1 ? "card" : "cards"} to the clipboard.`);
    } catch (caught) {
      setTransferError(caught instanceof Error ? caught.message : "Inventory could not be copied.");
    } finally {
      setTransferBusy(false);
    }
  }

  async function replaceWithImportedInventory(importedCards: ReturnType<typeof parseInventory>, sourceDescription: string) {
    const currentCards = await storage.listCards();
    const confirmed = window.confirm(
      `Replace the current ${currentCards.length}-card inventory with the ${importedCards.length}-card inventory ${sourceDescription}?\n\nThis replaces the whole inventory and will sync remotely when sync is configured.`,
    );
    if (!confirmed) {
      setTransferMessage("Import canceled; the current inventory was not changed.");
      return;
    }
    const savedCards = await replaceInventory(storage, currentCards, importedCards);
    setTransferMessage(`Imported ${savedCards.length} ${savedCards.length === 1 ? "card" : "cards"}. Reloading Parola…`);
    window.location.reload();
  }

  async function importInventory(file: File) {
    setTransferError("");
    setTransferMessage("");
    setTransferBusy(true);
    try {
      await replaceWithImportedInventory(parseInventory(await file.text()), `from ${file.name}`);
    } catch (caught) {
      setTransferError(caught instanceof Error ? caught.message : "Inventory could not be imported.");
    } finally {
      setTransferBusy(false);
      if (importInput.current) importInput.current.value = "";
    }
  }

  async function importInventoryText() {
    setTransferError("");
    setTransferMessage("");
    const text = importText.trim();
    if (!text) {
      setTransferError("Paste inventory JSON before importing.");
      return;
    }
    setTransferBusy(true);
    try {
      await replaceWithImportedInventory(parseInventory(text), "from the pasted JSON");
    } catch (caught) {
      setTransferError(caught instanceof Error ? caught.message : "Inventory could not be imported.");
    } finally {
      setTransferBusy(false);
    }
  }

  async function syncNow() {
    setTransferError("");
    setTransferMessage("");
    setTransferBusy(true);
    try {
      await onSyncNow();
      setTransferMessage("Sync completed using the newer timestamp.");
    } catch (caught) {
      setTransferError(caught instanceof Error ? caught.message : "Inventory could not be synced.");
    } finally {
      setTransferBusy(false);
    }
  }

  return <div className="modal-backdrop" onMouseDown={() => { if (!transferBusy) onClose(); }}>
    <form className="modal storage-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
      <header className="modal-header">
        <div><h2>Storage & sync</h2><p className="modal-subtitle">Keep a local inventory and optionally synchronize it through your API server.</p></div>
        <button type="button" className="icon-button" onClick={onClose} disabled={transferBusy} aria-label="Close storage settings">×</button>
      </header>

      <label className="field full-field">
        <span>Sync API endpoint</span>
        <input
          type="url"
          inputMode="url"
          value={draftEndpoint}
          onChange={(event) => setDraftEndpoint(event.target.value)}
          placeholder="https://example.com/cards"
          autoComplete="off"
        />
      </label>
      <div className="storage-option-copy">
        <strong>{syncConfigured ? `Current status: ${syncStatus.message}` : "Local only"}</strong>
        <p>{syncConfigured
          ? "Local and remote are copies of the same inventory snapshot. The copy with the later timestamp wins."
          : "With no API endpoint configured, Parola stores the inventory locally in this browser."}</p>
        {syncConfigured && <div className="inventory-transfer-actions">
          <button type="button" className="neutral-button" onClick={() => void syncNow()} disabled={saving || transferBusy}>Sync now</button>
        </div>}
      </div>

      <label className="switch-option">
        <input
          type="checkbox"
          checked={draftSyncConfigured ? draftPersistLocal : true}
          disabled={!draftSyncConfigured}
          onChange={(event) => setDraftPersistLocal(event.target.checked)}
        />
        <span>
          <strong>Keep a persistent local copy</strong>
          <small>{draftSyncConfigured ? "Store the synchronized inventory in this browser between sessions." : "Required when no sync server is configured."}</small>
        </span>
      </label>

      <div className="storage-option-copy">
        <strong>When local and remote timestamps differ</strong>
        <p>The later timestamp is always authoritative. This only controls whether Parola reconciles immediately when it opens.</p>
      </div>
      <div className="storage-mode-options" role="radiogroup" aria-label="Sync on load behavior">
        <label className={draftLoadPolicy === "automatic" ? "selected" : ""}>
          <input type="radio" name="sync-load-policy" checked={draftLoadPolicy === "automatic"} onChange={() => setDraftLoadPolicy("automatic")} />
          <span><strong>Automatically sync</strong><small>Immediately copy the newer state over the older state.</small></span>
        </label>
        <label className={draftLoadPolicy === "ask" ? "selected" : ""}>
          <input type="radio" name="sync-load-policy" checked={draftLoadPolicy === "ask"} onChange={() => setDraftLoadPolicy("ask")} />
          <span><strong>Ask first</strong><small>Show that sync is available and wait for Sync now.</small></span>
        </label>
      </div>

      <section className="inventory-transfer-panel" aria-label="Inventory import and export">
        <div>
          <strong>Inventory backup & restore</strong>
          <p>Export or copy the current inventory, or replace it from Parola inventory JSON.</p>
        </div>
        <div className="inventory-transfer-actions">
          <button type="button" className="neutral-button" onClick={() => void exportInventory()} disabled={saving || transferBusy}>Export inventory</button>
          <button type="button" className="neutral-button" onClick={() => void copyInventory()} disabled={saving || transferBusy}>Copy inventory</button>
          <button type="button" className="neutral-button" onClick={() => importInput.current?.click()} disabled={saving || transferBusy}>Import file</button>
          <input ref={importInput} type="file" accept=".json,application/json" hidden onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importInventory(file);
          }} />
        </div>
        <label className="field full-field">
          <span>Import inventory JSON</span>
          <textarea
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder={'{\n  "cards": [...]\n}'}
            rows={8}
            disabled={saving || transferBusy}
            spellCheck={false}
            style={{
              width: "100%",
              resize: "vertical",
              border: "1px solid var(--line)",
              borderRadius: "6px",
              background: "#0e1115",
              color: "var(--text)",
              padding: "10px 11px",
              font: "inherit",
              lineHeight: 1.45,
            }}
          />
        </label>
        <div className="inventory-transfer-actions">
          <button type="button" className="neutral-button" onClick={() => void importInventoryText()} disabled={saving || transferBusy || !importText.trim()}>Import pasted JSON</button>
        </div>
        <p className="inventory-transfer-note">Import replaces the whole inventory. Export or copy first if you want a backup.</p>
        {transferMessage && <p className="inventory-transfer-message" role="status">{transferMessage}</p>}
        {transferError && <p className="form-error" role="alert">{transferError}</p>}
      </section>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer className="modal-actions">
        <button type="button" className="text-button" onClick={onClose} disabled={saving || transferBusy}>Cancel</button>
        <button type="submit" className="primary-button" disabled={saving || transferBusy}>{saving ? "Applying…" : "Apply"}</button>
      </footer>
    </form>
  </div>;
}
