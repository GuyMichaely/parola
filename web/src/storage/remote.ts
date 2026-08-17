import type { Flashcard } from "../cards/types";
import { parseCardResponse, parseCardsResponse } from "./cardCodec";
import type { CardStorage } from "./types";

export class RemoteStorage implements CardStorage {
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
