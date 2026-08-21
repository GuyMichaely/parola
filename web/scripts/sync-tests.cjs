const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const testDist = path.join(__dirname, "..", ".test-dist");
fs.mkdirSync(testDist, { recursive: true });
fs.writeFileSync(path.join(testDist, "package.json"), '{"type":"commonjs"}\n');

const {
  cloneNounMorphology,
  defaultNounMorphology,
} = require(path.join(testDist, "cards", "nounMorphology.js"));
const {
  readLocalSnapshot,
  writeLocalSnapshot,
} = require(path.join(testDist, "storage", "browser.js"));
const {
  readSyncStatus,
  SyncStorage,
} = require(path.join(testDist, "storage", "sync.js"));

function adverbCard(id, italian, english) {
  return {
    id,
    type: "adverb",
    english,
    italian,
    setName: null,
    tags: [],
    details: {},
  };
}

function inventorySnapshot(cards, updatedAt) {
  return {
    cards,
    nounMorphology: cloneNounMorphology(defaultNounMorphology),
    updatedAt,
  };
}

function memoryLocalStorage() {
  const data = new Map();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    key(index) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key) {
      data.delete(key);
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
  };
}

function installBrowser() {
  const localStorage = memoryLocalStorage();
  global.window = { localStorage };
  return localStorage;
}

function response(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() {
      return payload === null || payload === undefined ? "" : JSON.stringify(payload);
    },
  };
}

function installRemote(initialSnapshot) {
  let snapshot = JSON.parse(JSON.stringify(initialSnapshot));
  let writes = 0;
  global.fetch = async (_url, init = {}) => {
    const method = init.method ?? "GET";
    if (method === "GET") return response(200, snapshot);
    if (method === "PUT") {
      writes += 1;
      snapshot = JSON.parse(String(init.body));
      return response(200, snapshot);
    }
    return response(405, { error: "Method not allowed" });
  };
  return {
    snapshot: () => JSON.parse(JSON.stringify(snapshot)),
    writes: () => writes,
  };
}

test("automatic sync accepts a newer remote snapshot and persists it locally", async () => {
  installBrowser();
  const local = inventorySnapshot([adverbCard(1, "qui", "here")], "2026-08-20T12:00:00.000Z");
  const remote = inventorySnapshot([adverbCard(2, "lì", "there")], "2026-08-20T13:00:00.000Z");
  writeLocalSnapshot(local);
  const server = installRemote(remote);

  const storage = new SyncStorage("https://sync.example.test", { persistLocal: true, loadPolicy: "automatic" });
  const inventory = await storage.readInventory();

  assert.equal(inventory.cards[0]?.english, "there");
  assert.equal(readLocalSnapshot().cards[0]?.english, "there");
  assert.equal(server.writes(), 0);
  assert.equal(readSyncStatus().status, "synced");
});

test("automatic sync pushes a newer local snapshot to the remote peer", async () => {
  installBrowser();
  const local = inventorySnapshot([adverbCard(1, "qui", "here")], "2026-08-20T14:00:00.000Z");
  const remote = inventorySnapshot([adverbCard(2, "lì", "there")], "2026-08-20T13:00:00.000Z");
  writeLocalSnapshot(local);
  const server = installRemote(remote);

  const storage = new SyncStorage("https://sync.example.test/state", { persistLocal: true, loadPolicy: "automatic" });
  const inventory = await storage.readInventory();

  assert.equal(inventory.cards[0]?.english, "here");
  assert.equal(server.writes(), 1);
  assert.equal(server.snapshot().cards[0]?.english, "here");
  assert.equal(readSyncStatus().status, "synced");
});

test("ask-first sync preserves local state until an explicit sync", async () => {
  installBrowser();
  const local = inventorySnapshot([adverbCard(1, "qui", "here")], "2026-08-20T12:00:00.000Z");
  const remote = inventorySnapshot([adverbCard(2, "lì", "there")], "2026-08-20T13:00:00.000Z");
  writeLocalSnapshot(local);
  const server = installRemote(remote);

  const storage = new SyncStorage("https://sync.example.test/cards", { persistLocal: true, loadPolicy: "ask" });
  const initial = await storage.readInventory();

  assert.equal(initial.cards[0]?.english, "here");
  assert.equal(server.writes(), 0);
  assert.equal(readSyncStatus().status, "pending");

  const reconciled = await storage.syncNow();
  assert.equal(reconciled.cards[0]?.english, "there");
  assert.equal(readLocalSnapshot().cards[0]?.english, "there");
  assert.equal(readSyncStatus().status, "synced");
});

test("non-persistent sync uses the remote snapshot without leaving browser inventory state", async () => {
  const localStorage = installBrowser();
  writeLocalSnapshot(inventorySnapshot([adverbCard(1, "qui", "here")], "2026-08-20T14:00:00.000Z"));
  const remote = inventorySnapshot([adverbCard(2, "lì", "there")], "2026-08-20T15:00:00.000Z");
  installRemote(remote);

  const storage = new SyncStorage("https://sync.example.test", { persistLocal: false, loadPolicy: "automatic" });
  const inventory = await storage.readInventory();

  assert.equal(inventory.cards[0]?.english, "there");
  assert.equal(localStorage.getItem("parola:inventory"), null);
  assert.equal(readSyncStatus().status, "synced");
});

test("an unavailable remote leaves the local snapshot usable", async () => {
  installBrowser();
  writeLocalSnapshot(inventorySnapshot([adverbCard(1, "qui", "here")], "2026-08-20T14:00:00.000Z"));
  global.fetch = async () => {
    throw new Error("offline");
  };

  const storage = new SyncStorage("https://sync.example.test", { persistLocal: true, loadPolicy: "automatic" });
  const inventory = await storage.readInventory();

  assert.equal(inventory.cards[0]?.english, "here");
  assert.equal(readSyncStatus().status, "offline");
});
