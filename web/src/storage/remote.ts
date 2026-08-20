import {
  normalizeNounMorphology,
  type NounMorphology,
} from "../cards/nounMorphology";
import { parseCardsResponse } from "./cardCodec";
import { assertInventoryState } from "./inventoryState";

export interface RemoteSnapshot {
  cards: ReturnType<typeof parseCardsResponse>;
  nounMorphology: NounMorphology;
  updatedAt: string | null;
}

export class RemoteConflictError extends Error {
  readonly state: RemoteSnapshot;

  constructor(state: RemoteSnapshot) {
    super("Remote inventory is newer than the local inventory.");
    this.state = state;
  }
}

function stateUrl(endpoint: string) {
  const normalized = endpoint.trim().replace(/\/$/, "");
  if (normalized.endsWith("/state")) return normalized;
  if (normalized.endsWith("/cards")) return `${normalized.slice(0, -6)}/state`;
  return `${normalized}/state`;
}

function parseSnapshot(value: unknown): RemoteSnapshot {
  const payload = value as { cards?: unknown; nounMorphology?: unknown; updatedAt?: unknown };
  if (!payload?.nounMorphology) throw new Error("Remote state does not contain nounMorphology.");
  const state = {
    cards: parseCardsResponse(payload),
    nounMorphology: normalizeNounMorphology(payload.nounMorphology),
  };
  assertInventoryState(state);
  return {
    ...state,
    updatedAt: typeof payload?.updatedAt === "string" && payload.updatedAt ? payload.updatedAt : null,
  };
}

export class RemoteSyncClient {
  readonly label: string;
  private readonly endpoint: string;

  constructor(endpoint: string) {
    this.endpoint = stateUrl(endpoint);
    this.label = new URL(endpoint).host;
  }

  private async request(init?: RequestInit) {
    const response = await fetch(this.endpoint, {
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });

    const text = response.status === 204 ? "" : await response.text();
    const body = text ? JSON.parse(text) as unknown : null;

    if (response.status === 409) {
      const payload = body as { state?: unknown };
      throw new RemoteConflictError(parseSnapshot(payload?.state));
    }
    if (!response.ok) {
      const payload = body as { error?: unknown } | null;
      const detail = payload && typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
      throw new Error(`Remote sync failed: ${detail}`);
    }
    return body;
  }

  async readState() {
    return parseSnapshot(await this.request());
  }

  async writeState(state: RemoteSnapshot) {
    return parseSnapshot(await this.request({
      method: "PUT",
      body: JSON.stringify(state),
    }));
  }
}
