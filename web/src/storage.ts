export type CardType = "noun" | "verb" | "adjective" | "adverb";

export type Flashcard = {
  id: number;
  type: CardType;
  english: string;
  italian: string;
  setName: string | null;
  tags: string[];
  details: Record<string, string>;
};

export interface CardStorage {
  readonly label: string;
  listCards(): Promise<Flashcard[]>;
  createCards(cards: Flashcard[]): Promise<Flashcard[]>;
  updateCard(card: Flashcard): Promise<Flashcard>;
  deleteCard(id: number): Promise<void>;
}

const cardsKey = "parola:cards:v1";
const endpointKey = "parola:storage-endpoint:v2";
const storageModeKey = "parola:storage-mode:v1";

export type StorageMode = "browser" | "remote";

function cloneCards(cards: Flashcard[]) {
  return cards.map((card) => ({ ...card, tags: [...card.tags], details: { ...card.details } }));
}

function normalizeCard(value: unknown): Flashcard {
  if (!value || typeof value !== "object") throw new Error("Invalid card returned by storage.");
  const card = value as Partial<Flashcard>;
  if (!Number.isFinite(card.id) || !card.type || !card.english || !card.italian) {
    throw new Error("Storage returned an incomplete card.");
  }
  return {
    id: Number(card.id),
    type: card.type,
    english: String(card.english),
    italian: String(card.italian),
    setName: typeof card.setName === "string" && card.setName ? card.setName : null,
    tags: Array.isArray(card.tags) ? card.tags.map(String) : [],
    details: card.details && typeof card.details === "object" ? Object.fromEntries(Object.entries(card.details).map(([key, item]) => [key, String(item)])) : {},
  };
}

function readLocalCards(): Flashcard[] {
  const stored = window.localStorage.getItem(cardsKey);
  if (!stored) return [];
  const parsed = JSON.parse(stored) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Local card storage is invalid.");
  return parsed.map(normalizeCard);
}

function writeLocalCards(cards: Flashcard[]) {
  window.localStorage.setItem(cardsKey, JSON.stringify(cards));
}

class BrowserStorage implements CardStorage {
  readonly label = "This browser";

  async listCards() {
    return cloneCards(readLocalCards());
  }

  async createCards(cards: Flashcard[]) {
    const existing = readLocalCards();
    let nextId = existing.reduce((max, card) => Math.max(max, card.id), 0) + 1;
    const inserted = cards.map((card) => ({ ...card, id: nextId++ }));
    writeLocalCards([...inserted, ...existing]);
    return cloneCards(inserted);
  }

  async updateCard(card: Flashcard) {
    const existing = readLocalCards();
    const index = existing.findIndex((item) => item.id === card.id);
    if (index < 0) throw new Error("Card not found in local storage.");
    const updated = [...existing];
    updated[index] = cloneCards([card])[0];
    writeLocalCards(updated);
    return cloneCards([card])[0];
  }

  async deleteCard(id: number) {
    const existing = readLocalCards();
    const updated = existing.filter((card) => card.id !== id);
    if (updated.length === existing.length) throw new Error("Card not found in local storage.");
    writeLocalCards(updated);
  }
}

function parseCardsResponse(value: unknown): Flashcard[] {
  const payload = value as { cards?: unknown };
  const cards = Array.isArray(value) ? value : payload && Array.isArray(payload.cards) ? payload.cards : null;
  if (!cards) throw new Error("Remote API did not return a cards array.");
  return cards.map(normalizeCard);
}

function parseCardResponse(value: unknown): Flashcard {
  const payload = value as { card?: unknown };
  return normalizeCard(payload && payload.card ? payload.card : value);
}

class RemoteStorage implements CardStorage {
  readonly label: string;
  private readonly endpoint: string;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
    this.label = new URL(endpoint).host;
  }

  private async request(init?: RequestInit, query = "") {
    const response = await fetch(`${this.endpoint}${query}`, {
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    if (!response.ok) {
      let message = `Remote storage returned HTTP ${response.status}.`;
      try {
        const body = await response.json() as { error?: string };
        if (body.error) message = body.error;
      } catch {
        // Preserve the HTTP status message when the body is not JSON.
      }
      throw new Error(message);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) as unknown : null;
  }

  async listCards() {
    return parseCardsResponse(await this.request());
  }

  async createCards(cards: Flashcard[]) {
    return parseCardsResponse(await this.request({ method: "POST", body: JSON.stringify({ cards }) }));
  }

  async updateCard(card: Flashcard) {
    return parseCardResponse(await this.request({ method: "PUT", body: JSON.stringify(card) }));
  }

  async deleteCard(id: number) {
    await this.request({ method: "DELETE" }, `?id=${encodeURIComponent(id)}`);
  }
}

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

export function createCardStorage(endpoint: string): CardStorage {
  return endpoint.trim() ? new RemoteStorage(endpoint.trim()) : new BrowserStorage();
}
