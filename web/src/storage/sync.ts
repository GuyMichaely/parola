import type { Flashcard } from "../cards/types";
import { cloneCards } from "./cardCodec";
import {
  clearLocalSnapshot,
  readLocalSnapshot,
  writeLocalSnapshot,
  type InventorySnapshot,
} from "./browser";
import { RemoteConflictError, RemoteSyncClient, type RemoteSnapshot } from "./remote";
import { readSyncConflictPolicy, readSyncPersistLocal } from "./settings";
import type { CardStorage } from "./types";

export type SyncStatus = "local" | "checking" | "syncing" | "synced" | "conflict" | "offline";

export interface SyncStatusState {
  status: SyncStatus;
  message: string;
}

let currentSyncStatus: SyncStatusState = { status: "local", message: "Local only" };
const syncListeners = new Set<(state: SyncStatusState) => void>();

export function readSyncStatus() {
  return currentSyncStatus;
}

export function subscribeSyncStatus(listener: (state: SyncStatusState) => void) {
  syncListeners.add(listener);
  listener(currentSyncStatus);
  return () => syncListeners.delete(listener);
}

export function setLocalSyncStatus() {
  setSyncStatus({ status: "local", message: "Local only" });
}

function setSyncStatus(state: SyncStatusState) {
  currentSyncStatus = state;
  for (const listener of syncListeners) listener(state);
}

function snapshotEquals(left: InventorySnapshot, right: InventorySnapshot) {
  return JSON.stringify(left.cards) === JSON.stringify(right.cards);
}

function timestampValue(value: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function newerSide(local: InventorySnapshot, remote: RemoteSnapshot): "local" | "remote" | null {
  const localTime = timestampValue(local.updatedAt);
  const remoteTime = timestampValue(remote.updatedAt);
  if (localTime === null || remoteTime === null || localTime === remoteTime) return null;
  return localTime > remoteTime ? "local" : "remote";
}

function nextLocalTimestamp() {
  return new Date().toISOString();
}

export class SyncStorage implements CardStorage {
  readonly label: string;
  private readonly remote: RemoteSyncClient;
  private readonly persistLocal = readSyncPersistLocal();
  private readonly conflictPolicy = readSyncConflictPolicy();
  private snapshot: InventorySnapshot | null = null;
  private remoteUpdatedAt: string | null = null;
  private initialization: Promise<void> | null = null;
  private unresolvedConflict = false;

  constructor(endpoint: string) {
    this.remote = new RemoteSyncClient(endpoint);
    this.label = this.remote.label;
    setSyncStatus({ status: "checking", message: "Checking sync…" });
  }

  private persistSnapshot() {
    if (!this.snapshot) return;
    if (this.persistLocal) writeLocalSnapshot(this.snapshot);
    else clearLocalSnapshot();
  }

  private adoptRemote(remote: RemoteSnapshot) {
    this.snapshot = { cards: cloneCards(remote.cards), updatedAt: remote.updatedAt };
    this.remoteUpdatedAt = remote.updatedAt;
    this.unresolvedConflict = false;
    this.persistSnapshot();
    setSyncStatus({ status: "synced", message: "Synced" });
  }

  private async pushLocal() {
    if (!this.snapshot) return;
    setSyncStatus({ status: "syncing", message: "Syncing…" });
    try {
      const saved = await this.remote.writeState(this.snapshot.cards, this.remoteUpdatedAt);
      this.snapshot = { cards: cloneCards(saved.cards), updatedAt: saved.updatedAt };
      this.remoteUpdatedAt = saved.updatedAt;
      this.unresolvedConflict = false;
      this.persistSnapshot();
      setSyncStatus({ status: "synced", message: "Synced" });
    } catch (error) {
      if (error instanceof RemoteConflictError) {
        await this.handleRemoteConflict(error.state);
        return;
      }
      this.persistSnapshot();
      setSyncStatus({ status: "offline", message: "Not synced" });
    }
  }

  private async handleRemoteConflict(remote: RemoteSnapshot) {
    if (!this.snapshot) return;
    this.remoteUpdatedAt = remote.updatedAt;
    const side = newerSide(this.snapshot, remote);

    if (this.conflictPolicy === "newest" && side) {
      if (side === "remote") {
        this.adoptRemote(remote);
        return;
      }
      try {
        const saved = await this.remote.writeState(this.snapshot.cards, this.remoteUpdatedAt);
        this.snapshot = { cards: cloneCards(saved.cards), updatedAt: saved.updatedAt };
        this.remoteUpdatedAt = saved.updatedAt;
        this.unresolvedConflict = false;
        this.persistSnapshot();
        setSyncStatus({ status: "synced", message: "Synced" });
        return;
      } catch {
        // A second concurrent change should remain visible as an unresolved conflict.
      }
    }

    this.unresolvedConflict = true;
    this.persistSnapshot();
    setSyncStatus({ status: "conflict", message: "Sync conflict" });
  }

  private async reconcile(local: InventorySnapshot, remote: RemoteSnapshot) {
    this.remoteUpdatedAt = remote.updatedAt;

    if (snapshotEquals(local, remote)) {
      this.snapshot = { cards: cloneCards(remote.cards), updatedAt: remote.updatedAt ?? local.updatedAt };
      this.persistSnapshot();
      setSyncStatus({ status: "synced", message: "Synced" });
      return;
    }

    if (!local.cards.length && remote.cards.length) {
      this.adoptRemote(remote);
      return;
    }
    if (local.cards.length && !remote.cards.length && remote.updatedAt === null) {
      this.snapshot = { cards: cloneCards(local.cards), updatedAt: local.updatedAt ?? nextLocalTimestamp() };
      await this.pushLocal();
      return;
    }

    const side = newerSide(local, remote);
    if (this.conflictPolicy === "newest" && side) {
      if (side === "remote") this.adoptRemote(remote);
      else {
        this.snapshot = { cards: cloneCards(local.cards), updatedAt: local.updatedAt };
        await this.pushLocal();
      }
      return;
    }

    if (this.conflictPolicy === "ask" && side) {
      const sideLabel = side === "remote" ? "remote server" : "this device";
      const confirmed = window.confirm(
        `Parola is not synced. The newer inventory is on ${sideLabel}.\n\nLocal updated: ${local.updatedAt ?? "unknown"}\nRemote updated: ${remote.updatedAt ?? "unknown"}\n\nSync now using the newer inventory?`,
      );
      if (confirmed) {
        if (side === "remote") this.adoptRemote(remote);
        else {
          this.snapshot = { cards: cloneCards(local.cards), updatedAt: local.updatedAt };
          await this.pushLocal();
        }
        return;
      }
    }

    this.snapshot = { cards: cloneCards(local.cards), updatedAt: local.updatedAt };
    this.unresolvedConflict = true;
    this.persistSnapshot();
    setSyncStatus({ status: "conflict", message: "Sync conflict" });
  }

  private async initialize() {
    if (this.initialization) return this.initialization;
    this.initialization = (async () => {
      const local = readLocalSnapshot();
      setSyncStatus({ status: "checking", message: "Checking sync…" });
      try {
        const remote = await this.remote.readState();
        await this.reconcile(local, remote);
      } catch {
        if (local.cards.length || this.persistLocal) {
          this.snapshot = { cards: cloneCards(local.cards), updatedAt: local.updatedAt };
          setSyncStatus({ status: "offline", message: "Not synced" });
          return;
        }
        this.snapshot = { cards: [], updatedAt: null };
        setSyncStatus({ status: "offline", message: "Remote unavailable" });
      }
    })();
    return this.initialization;
  }

  private async mutate(operation: (cards: Flashcard[]) => Flashcard[]) {
    await this.initialize();
    const current = this.snapshot ?? { cards: [], updatedAt: null };
    this.snapshot = {
      cards: cloneCards(operation(cloneCards(current.cards))),
      updatedAt: nextLocalTimestamp(),
    };
    this.persistSnapshot();
    if (this.unresolvedConflict && this.conflictPolicy === "ask") {
      setSyncStatus({ status: "conflict", message: "Sync conflict" });
      return;
    }
    await this.pushLocal();
  }

  async listCards() {
    await this.initialize();
    return cloneCards(this.snapshot?.cards ?? []);
  }

  async createCards(cards: Flashcard[]) {
    await this.initialize();
    const existing = this.snapshot?.cards ?? [];
    let nextId = existing.reduce((max, card) => Math.max(max, card.id), 0) + 1;
    const inserted = cloneCards(cards).map((card) => ({ ...card, id: nextId++ }));
    await this.mutate((current) => [...inserted, ...current]);
    return cloneCards(inserted);
  }

  async updateCard(card: Flashcard) {
    await this.initialize();
    if (!(this.snapshot?.cards ?? []).some((item) => item.id === card.id)) {
      throw new Error("Card not found in synced storage.");
    }
    await this.mutate((cards) => cards.map((item) => item.id === card.id ? cloneCards([card])[0] : item));
    return cloneCards([card])[0];
  }

  async deleteCard(id: number) {
    await this.initialize();
    if (!(this.snapshot?.cards ?? []).some((item) => item.id === id)) {
      throw new Error("Card not found in synced storage.");
    }
    await this.mutate((cards) => cards.filter((card) => card.id !== id));
  }

  async replaceCards(cards: Flashcard[]) {
    await this.initialize();
    const replacement = cloneCards(cards);
    await this.mutate(() => replacement);
    return cloneCards(replacement);
  }
}
