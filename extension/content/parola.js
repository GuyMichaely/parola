(() => {
  const cardsKey = "parola:cards";
  const endpointKey = "parola:storage-endpoint";
  const storageModeKey = "parola:storage-mode";

  function normalizeCard(value) {
    const type = String(value?.type || "");
    if (!["noun", "verb", "adjective", "adverb"].includes(type)) {
      throw new Error("Invalid Parola card type.");
    }
    const english = String(value?.english || "").trim();
    const italian = String(value?.italian || "").normalize("NFC").trim();
    if (!english || !italian) throw new Error("Imported cards need English and Italian text.");
    return {
      id: Number(value?.id) || 0,
      type,
      english,
      italian,
      setName: typeof value?.setName === "string" && value.setName.trim() ? value.setName.trim() : null,
      tags: Array.isArray(value?.tags)
        ? [...new Set(value.tags.map(String).map((tag) => tag.trim()).filter(Boolean))]
        : [],
      details: value?.details && typeof value.details === "object" && !Array.isArray(value.details)
        ? Object.fromEntries(Object.entries(value.details).map(([key, item]) => [key, String(item)]))
        : {},
    };
  }

  function readStorageMode() {
    const endpoint = localStorage.getItem(endpointKey)?.trim() || "";
    const mode = localStorage.getItem(storageModeKey);
    return mode === "remote" && endpoint ? { mode: "remote", endpoint } : { mode: "browser", endpoint: "" };
  }

  function importIntoBrowser(cards) {
    const stored = localStorage.getItem(cardsKey);
    const existing = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(existing)) throw new Error("Parola browser card storage is invalid.");
    let nextId = existing.reduce((max, card) => Math.max(max, Number(card?.id) || 0), 0) + 1;
    const inserted = cards.map((card) => ({ ...card, id: nextId++ }));
    localStorage.setItem(cardsKey, JSON.stringify([...inserted, ...existing]));
    return inserted;
  }

  async function importIntoRemote(endpoint, cards) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cards }),
    });
    if (!response.ok) {
      let message = `Remote Parola storage returned HTTP ${response.status}.`;
      try {
        const body = await response.json();
        if (body?.error) message = body.error;
      } catch {
        // Keep the HTTP status message when the response body is not JSON.
      }
      throw new Error(message);
    }
    const body = await response.json();
    return Array.isArray(body?.cards) ? body.cards : [];
  }

  async function importCards(values) {
    if (!Array.isArray(values) || !values.length) throw new Error("No cards were supplied for import.");
    const cards = values.map(normalizeCard);
    const storage = readStorageMode();
    const inserted = storage.mode === "remote"
      ? await importIntoRemote(storage.endpoint, cards)
      : importIntoBrowser(cards);
    return { ok: true, importedCount: inserted.length || cards.length, storage: storage.mode };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "import-parola-cards") return;
    void importCards(message.cards)
      .then((result) => {
        sendResponse(result);
        setTimeout(() => location.reload(), 120);
      })
      .catch((error) => {
        sendResponse({ error: error instanceof Error ? error.message : String(error) });
      });
    return true;
  });
})();
