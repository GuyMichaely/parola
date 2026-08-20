import type { Flashcard } from "../cards/types";
import { cloneCards } from "./cardCodec";
import {
  clearLocalSnapshot,
  readLocalSnapshot,
  writeLocalSnapshot,
  type InventorySnapshot,
} from "./browser";
import { RemoteConflictError, RemoteSyncClient, type RemoteSnapshot } from "./remote";
import type { SyncLoadPolicy } from "./settings";
import type { CardStorage } from "./types";

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

function cardsEqual(left: InventorySnapshot | RemoteSnapshot, right: InventorySnapshot | RemoteSnapshot) {
  return JSON.stringify(left.cards) === JSON.stringify(right.cards);
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

  private adoptRemote(remote: RemoteSnapshot) {
    this.latestRemoteUpdatedAt = remote.updatedAt;
    this.snapshot = { cards: cloneCards(remote.cards), updatedAt: remote.updatedAt };
    this.persistSnapshot();
    setSyncStatus({ status: "synced", message: "Synced" });
  }

  private async pushLocal() {
    if (!this.snapshot?.updatedAt) return;
    setSyncStatus({ status: "syncing", message: "Syncing…" });
    try {
      const saved = await this.remote.writeState({
        cards: cloneCards(this.snapshot.cards),
        updatedAt: this.snapshot.updatedAt,
      });
      this.latestRemoteUpdatedAt = saved.updatedAt;
      this.snapshot = { cards: cloneCards(saved.cards), updatedAt: saved.updatedAt };
      this.persistSnapshot();
      setSyncStatus({ status: "synced", message: "Synced" });
    } catch (error) {
      if (error instanceof RemoteConflictError) {
        this.latestRemoteUpdatedAt = error.state.updatedAt;
        if (this.loadPolicy === "automatic") this.adoptRemote(error.state);
        else setSyncStatus({ status: "pending", message: "Sync available" });
        return;
      }
      setSyncStatus({ status: "offline", message: "Not synced" });
    }
  }

  private async reconcile(local: InventorySnapshot, remote: RemoteSnapshot, force: boolean) {
    this.latestRemoteUpdatedAt = remote.updatedAt;

    if (cardsEqual(local, remote)) {
      this.snapshot = {
        cards: cloneCards(local.cards),
        updatedAt: newerSide(local, remote) === "remote" ? remote.updatedAt : local.updatedAt,
      };
      this.persistSnapshot();
      setSyncStatus({ status: "synced", message: "Synced" });
      return;
    }

    const side = newerSide(local, remote);
    if (!force && this.loadPolicy === "ask" && local.cards.length) {
      this.snapshot = { cards: cloneCards(local.cards), updatedAt: local.updatedAt };
      this.persistSnapshot();
      setSyncStatus({ status: "pending", message: "Sync available" });
      return;
    }

    if (side === "remote") {
      this.adoptRemote(remote);
      return;
    }

    this.snapshot = {
      cards: cloneCards(local.cards),
      updatedAt: local.updatedAt ?? nextTimestamp(remote.updatedAt),
    };
    this.persistSnapshot();
    await this.pushLocal();
  }

  private async initialize() {
    if (this.initialization) return this.initialization;
    this.initialization = (async () => {
      const local = this.persistLocal ? readLocalSnapshot() : { cards: [], updatedAt: null };
      this.snapshot = { cards: cloneCards(local.cards), updatedAt: local.updatedAt };
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

  private async mutate(operation: (cards: Flashcard[]) => Flashcard[]) {
    await this.initialize();
    const current = this.snapshot ?? { cards: [], updatedAt: null };
    this.snapshot = {
      cards: cloneCards(operation(cloneCards(current.cards))),
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
      const local = this.snapshot ?? { cards: [], updatedAt: null };
      await this.reconcile(local, remote, true);
    } catch {
      setSyncStatus({ status: "offline", message: "Not synced" });
    }
    return cloneCards(this.snapshot?.cards ?? []);
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
      throw new Error("Card not found in local inventory.");
    }
    await this.mutate((cards) => cards.map((item) => item.id === card.id ? cloneCards([card])[0] : item));
    return cloneCards([card])[0];
  }

  async deleteCard(id: number) {
    await this.initialize();
    if (!(this.snapshot?.cards ?? []).some((item) => item.id === id)) {
      throw new Error("Card not found in local inventory.");
    }
    await this.mutate((cards) => cards.filter((card) => card.id !== id));
  }

  async replaceCards(cards: Flashcard[]) {
    const replacement = cloneCards(cards);
    await this.mutate(() => replacement);
    return cloneCards(replacement);
  }
}
