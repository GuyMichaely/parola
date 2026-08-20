import type { Flashcard } from "../cards/types";
import {
  cloneNounMorphology,
  defaultNounMorphology,
  normalizeNounMorphology,
  type NounMorphology,
} from "../cards/nounMorphology";
import { assertNoDuplicateCards, cloneCards } from "./cardCodec";
import {
  clearLocalSnapshot,
  readLocalSnapshot,
  writeLocalSnapshot,
  type InventorySnapshot,
} from "./browser";
import { RemoteConflictError, RemoteSyncClient, type RemoteSnapshot } from "./remote";
import type { SyncLoadPolicy } from "./settings";
import type { CardStorage, InventoryState } from "./types";

export type SyncStatus = "local" | "checking" | "syncing" | "synced" | "pending" | "offline";

export interface SyncStatusState {
  status: SyncStatus;
  message: string;
}

export interface SyncStorageOptions {
  persistLocal: boolean;
  loadPolicy: SyncLoadPolicy;
}

let currentSyncStatus: SyncStatusState = { status: "local", message: "Local only" };
const syncListeners = new Set<(state: SyncStatusState) => void>();

export function readSyncStatus() {
  return currentSyncStatus;
}

export function subscribeSyncStatus(listener: (state: SyncStatusState) => void) {
  syncListeners.add(listener);
  listener(currentSyncStatus);
  return () => {
    syncListeners.delete(listener);
  };
}

export function setLocalSyncStatus() {
  setSyncStatus({ status: "local", message: "Local only" });
}

function setSyncStatus(state: SyncStatusState) {
  currentSyncStatus = state;
  for (const listener of syncListeners) listener(state);
}

function snapshotsEqual(left: InventorySnapshot | RemoteSnapshot, right: InventorySnapshot | RemoteSnapshot) {
  return JSON.stringify(left.cards) === JSON.stringify(right.cards)
    && JSON.stringify(left.nounMorphology) === JSON.stringify(right.nounMorphology);
}

function timestamp(value: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function newerSide(local: InventorySnapshot, remote: RemoteSnapshot): "local" | "remote" {
  const localTime = timestamp(local.updatedAt);
  const remoteTime = timestamp(remote.updatedAt);
  if (localTime !== null && remoteTime !== null) return localTime >= remoteTime ? "local" : "remote";
  if (localTime !== null) return "local";
  if (remoteTime !== null) return "remote";
  if (!local.cards.length && remote.cards.length) return "remote";
  return "local";
}

function nextTimestamp(...values: Array<string | null | undefined>) {
  const floor = values.reduce((max, value) => {
    const parsed = timestamp(value ?? null);
    return parsed === null ? max : Math.max(max, parsed);
  }, Number.NEGATIVE_INFINITY);
  return new Date(Math.max(Date.now(), Number.isFinite(floor) ? floor + 1 : Date.now())).toISOString();
}

function emptySnapshot(): InventorySnapshot {
  return {
    cards: [],
    nounMorphology: cloneNounMorphology(defaultNounMorphology),
    updatedAt: null,
  };
}

function cloneSnapshot(snapshot: InventorySnapshot | RemoteSnapshot): InventorySnapshot {
  return {
    cards: cloneCards(snapshot.cards),
    nounMorphology: cloneNounMorphology(snapshot.nounMorphology),
    updatedAt: snapshot.updatedAt,
  };
}

function cloneInventoryState(snapshot: InventoryState): InventoryState {
  return {
    cards: cloneCards(snapshot.cards),
    nounMorphology: cloneNounMorphology(snapshot.nounMorphology),
  };
}

export class SyncStorage implements CardStorage {
  readonly label: string;
  private readonly remote: RemoteSyncClient;
  private readonly persistLocal: boolean;
  private readonly loadPolicy: SyncLoadPolicy;
  private snapshot: InventorySnapshot | null = null;
  private initialization: Promise<void> | null = null;
  private latestRemoteUpdatedAt: string | null = null;

  constructor(endpoint: string, options: SyncStorageOptions) {
    this.remote = new RemoteSyncClient(endpoint);
    this.label = this.remote.label;
    this.persistLocal = options.persistLocal;
    this.loadPolicy = options.loadPolicy;
    setSyncStatus({ status: "checking", message: "Checking sync…" });
  }

  private persistSnapshot() {
    if (!this.snapshot) return;
    if (this.persistLocal) writeLocalSnapshot(this.snapshot);
    else clearLocalSnapshot();
  }

  private acceptSavedState(saved: RemoteSnapshot) {
    this.latestRemoteUpdatedAt = saved.updatedAt;
    this.snapshot = cloneSnapshot(saved);
    this.persistSnapshot();
    setSyncStatus({ status: "synced", message: "Synced" });
  }

  private async pushLocal() {
    if (!this.snapshot?.updatedAt) return;
    setSyncStatus({ status: "syncing", message: "Syncing…" });
    try {
      const saved = await this.remote.writeState({
        cards: cloneCards(this.snapshot.cards),
        nounMorphology: cloneNounMorphology(this.snapshot.nounMorphology),
        updatedAt: this.snapshot.updatedAt,
      });
      this.acceptSavedState(saved);
    } catch (error) {
      if (error instanceof RemoteConflictError) {
        this.latestRemoteUpdatedAt = error.state.updatedAt;
        if (this.loadPolicy === "ask") {
          setSyncStatus({ status: "pending", message: "Sync available" });
          return;
        }
        this.snapshot = {
          cards: cloneCards(this.snapshot.cards),
          nounMorphology: cloneNounMorphology(this.snapshot.nounMorphology),
          updatedAt: nextTimestamp(this.snapshot.updatedAt, error.state.updatedAt),
        };
        this.persistSnapshot();
        try {
          const saved = await this.remote.writeState({
            cards: cloneCards(this.snapshot.cards),
            nounMorphology: cloneNounMorphology(this.snapshot.nounMorphology),
            updatedAt: this.snapshot.updatedAt,
          });
          this.acceptSavedState(saved);
        } catch (retryError) {
          if (retryError instanceof RemoteConflictError) {
            this.latestRemoteUpdatedAt = retryError.state.updatedAt;
            setSyncStatus({ status: "pending", message: "Sync changed again" });
          } else {
            setSyncStatus({ status: "offline", message: "Not synced" });
          }
        }
        return;
      }
      setSyncStatus({ status: "offline", message: "Not synced" });
    }
  }

  private async reconcile(local: InventorySnapshot, remote: RemoteSnapshot, force: boolean) {
    this.latestRemoteUpdatedAt = remote.updatedAt;
    if (snapshotsEqual(local, remote)) {
      this.snapshot = cloneSnapshot(newerSide(local, remote) === "remote" ? remote : local);
      this.persistSnapshot();
      setSyncStatus({ status: "synced", message: "Synced" });
      return;
    }

    const side = newerSide(local, remote);
    if (!force && this.loadPolicy === "ask" && local.cards.length) {
      this.snapshot = cloneSnapshot(local);
      this.persistSnapshot();
      setSyncStatus({ status: "pending", message: "Sync available" });
      return;
    }

    if (side === "remote") {
      this.acceptSavedState(remote);
      return;
    }

    this.snapshot = {
      cards: cloneCards(local.cards),
      nounMorphology: cloneNounMorphology(local.nounMorphology),
      updatedAt: local.updatedAt ?? nextTimestamp(remote.updatedAt),
    };
    this.persistSnapshot();
    await this.pushLocal();
  }

  private async initialize() {
    if (this.initialization) return this.initialization;
    this.initialization = (async () => {
      const local = this.persistLocal ? readLocalSnapshot() : emptySnapshot();
      this.snapshot = cloneSnapshot(local);
      setSyncStatus({ status: "checking", message: "Checking sync…" });
      try {
        const remote = await this.remote.readState();
        await this.reconcile(local, remote, false);
      } catch {
        this.persistSnapshot();
        setSyncStatus({ status: "offline", message: "Not synced" });
      }
    })();
    return this.initialization;
  }

  private async mutateCards(operation: (cards: Flashcard[]) => Flashcard[]) {
    await this.initialize();
    const current = this.snapshot ?? emptySnapshot();
    this.snapshot = {
      cards: cloneCards(operation(cloneCards(current.cards))),
      nounMorphology: cloneNounMorphology(current.nounMorphology),
      updatedAt: nextTimestamp(current.updatedAt, this.latestRemoteUpdatedAt),
    };
    this.persistSnapshot();
    await this.pushLocal();
  }

  async syncNow() {
    await this.initialize();
    setSyncStatus({ status: "checking", message: "Checking sync…" });
    try {
      const remote = await this.remote.readState();
      await this.reconcile(this.snapshot ?? emptySnapshot(), remote, true);
    } catch {
      setSyncStatus({ status: "offline", message: "Not synced" });
    }
    const snapshot = this.snapshot ?? emptySnapshot();
    return cloneInventoryState(snapshot);
  }

  async listCards() {
    await this.initialize();
    return cloneCards(this.snapshot?.cards ?? []);
  }

  async createCards(cards: Flashcard[]) {
    await this.initialize();
    const existing = this.snapshot?.cards ?? [];
    assertNoDuplicateCards(existing, cards);
    let nextId = existing.reduce((max, card) => Math.max(max, card.id), 0) + 1;
    const inserted = cloneCards(cards).map((card) => ({ ...card, id: nextId++ }));
    await this.mutateCards((current) => [...inserted, ...current]);
    return cloneCards(inserted);
  }

  async updateCard(card: Flashcard) {
    await this.initialize();
    if (!(this.snapshot?.cards ?? []).some((item) => item.id === card.id)) throw new Error("Card not found in local inventory.");
    await this.mutateCards((cards) => cards.map((item) => item.id === card.id ? cloneCards([card])[0] : item));
    return cloneCards([card])[0];
  }

  async deleteCard(id: number) {
    await this.initialize();
    if (!(this.snapshot?.cards ?? []).some((item) => item.id === id)) throw new Error("Card not found in local inventory.");
    await this.mutateCards((cards) => cards.filter((card) => card.id !== id));
  }

  async replaceCards(cards: Flashcard[]) {
    const replacement = cloneCards(cards);
    await this.mutateCards(() => replacement);
    return cloneCards(replacement);
  }

  async listNounMorphology() {
    await this.initialize();
    return cloneNounMorphology(this.snapshot?.nounMorphology ?? defaultNounMorphology);
  }

  async replaceNounMorphology(morphology: NounMorphology) {
    await this.initialize();
    const replacement = normalizeNounMorphology(morphology);
    const current = this.snapshot ?? emptySnapshot();
    this.snapshot = {
      cards: cloneCards(current.cards),
      nounMorphology: cloneNounMorphology(replacement),
      updatedAt: nextTimestamp(current.updatedAt, this.latestRemoteUpdatedAt),
    };
    this.persistSnapshot();
    await this.pushLocal();
    return cloneNounMorphology(replacement);
  }

  async replaceInventory(state: InventoryState) {
    await this.initialize();
    const replacement: InventoryState = {
      cards: cloneCards(state.cards),
      nounMorphology: normalizeNounMorphology(state.nounMorphology),
    };
    const current = this.snapshot ?? emptySnapshot();
    this.snapshot = {
      ...cloneInventoryState(replacement),
      updatedAt: nextTimestamp(current.updatedAt, this.latestRemoteUpdatedAt),
    };
    this.persistSnapshot();
    await this.pushLocal();
    return cloneInventoryState(replacement);
  }
}
