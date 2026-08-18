const stagedKey = "parola-extension:staged";
const eventsKey = "parola-extension:debug-events";
const parolaUrl = "https://guymichaely.com/parola/";
const contextMenuId = "parola-stage-selection";
const cardTypes = new Set(["noun", "verb", "adjective", "adverb"]);
const maxEvents = 500;

function normalizeWord(value) {
  return String(value || "").normalize("NFC").trim().toLocaleLowerCase("it-IT");
}

function cleanDetails(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item ?? "").normalize("NFC").trim()]));
}

function joinArticle(article, noun) {
  const cleanArticle = String(article || "").trim();
  const cleanNoun = String(noun || "").trim();
  if (!cleanArticle) return cleanNoun;
  return cleanArticle.endsWith("’") || cleanArticle.endsWith("'")
    ? `${cleanArticle}${cleanNoun}`
    : `${cleanArticle} ${cleanNoun}`;
}

async function readState() {
  const stored = await chrome.storage.local.get([stagedKey, eventsKey]);
  return {
    staged: Array.isArray(stored[stagedKey]) ? stored[stagedKey] : [],
    events: Array.isArray(stored[eventsKey]) ? stored[eventsKey] : [],
  };
}

async function writeStaged(staged) {
  await chrome.storage.local.set({ [stagedKey]: staged });
  await updateBadge(staged);
}

async function writeEvents(events) {
  await chrome.storage.local.set({ [eventsKey]: events.slice(-maxEvents) });
}

async function appendEvent(type, data = {}) {
  const stored = await chrome.storage.local.get(eventsKey);
  const events = Array.isArray(stored[eventsKey]) ? stored[eventsKey] : [];
  events.push({
    id: crypto.randomUUID(),
    type,
    at: new Date().toISOString(),
    ...data,
  });
  await writeEvents(events);
}

async function updateBadge(stagedOverride) {
  const staged = stagedOverride ?? (await readState()).staged;
  await chrome.action.setBadgeText({ text: staged.length ? String(staged.length) : "" });
}

function parseInput(rawValue) {
  const rawInput = String(rawValue || "").normalize("NFC").trim();
  if (!rawInput) throw new Error("Enter a word or a sentence with the target surrounded by *asterisks*.");

  const stars = [...rawInput.matchAll(/\*/g)].map((match) => match.index);
  if (!stars.length) {
    if (/\s/u.test(rawInput)) {
      throw new Error("For a sentence, surround the word of interest with *asterisks*.");
    }
    return { word: rawInput, context: "", rawInput };
  }
  if (stars.length !== 2) {
    throw new Error("Use exactly one pair of *asterisks* around the word of interest.");
  }

  const word = rawInput.slice(stars[0] + 1, stars[1]).trim();
  if (!word) throw new Error("The text between the *asterisks* cannot be empty.");
  const context = `${rawInput.slice(0, stars[0])}${word}${rawInput.slice(stars[1] + 1)}`.replace(/\s+/g, " ").trim();
  return { word, context, rawInput };
}

async function stageCapture({ word, context = "", source = "popup", sourceUrl = "", rawInput = "" }) {
  const cleanWord = String(word || "").normalize("NFC").trim();
  const cleanContext = String(context || "").normalize("NFC").replace(/\s+/g, " ").trim();
  if (!cleanWord) throw new Error("Nothing was selected to stage.");

  const state = await readState();
  const now = new Date().toISOString();
  const normalized = normalizeWord(cleanWord);
  let item = state.staged.find((candidate) => candidate.normalizedWord === normalized);

  if (item) {
    item.updatedAt = now;
    item.contexts = Array.isArray(item.contexts) ? item.contexts : [];
    if (cleanContext && !item.contexts.includes(cleanContext)) item.contexts.push(cleanContext);
    item.sources = Array.isArray(item.sources) ? item.sources : [];
    if (source && !item.sources.includes(source)) item.sources.push(source);
    if (sourceUrl) item.sourceUrl = sourceUrl;
  } else {
    item = {
      id: crypto.randomUUID(),
      word: cleanWord,
      normalizedWord: normalized,
      english: "",
      cardType: "",
      details: {},
      status: "pending",
      createdAt: now,
      updatedAt: now,
      contexts: cleanContext ? [cleanContext] : [],
      sources: source ? [source] : [],
      sourceUrl: String(sourceUrl || ""),
    };
    state.staged.push(item);
  }

  await writeStaged(state.staged);
  await appendEvent("capture-staged", {
    source,
    sourceUrl: String(sourceUrl || ""),
    word: cleanWord,
    context: cleanContext,
    rawInput: String(rawInput || ""),
    stagedId: item.id,
    stagedCount: state.staged.length,
  });

  return { ok: true, id: item.id, word: cleanWord, stagedCount: state.staged.length };
}

function cardFromStaged(item) {
  const word = String(item.word || "").normalize("NFC").trim();
  const english = String(item.english || "").trim();
  const type = String(item.cardType || "");
  const d = cleanDetails(item.details);
  if (!word) throw new Error("Every approved item needs an Italian word.");
  if (!english) throw new Error(`${word} needs an English translation before it can be added.`);
  if (!cardTypes.has(type)) throw new Error(`${word} needs a part of speech before it can be added.`);

  if (type === "noun") {
    const gender = d.gender;
    const singular = d.singular || word;
    const plural = d.plural || "";
    const definiteSingularArticle = d.definiteSingularArticle || "";
    const definitePluralArticle = d.definitePluralArticle || "";
    const indefiniteArticle = d.indefiniteArticle || "";
    if (!new Set(["masculine", "feminine"]).has(gender)) throw new Error(`${word} needs a noun gender.`);
    if (!singular && !plural) throw new Error(`${word} needs a singular or plural noun form.`);
    return {
      id: 0,
      type,
      english,
      italian: singular || plural,
      setName: null,
      tags: [],
      details: {
        gender,
        singular,
        plural,
        definiteSingularArticle,
        definitePluralArticle,
        indefiniteArticle,
        definiteSingular: singular ? joinArticle(definiteSingularArticle, singular) : "",
        definitePlural: plural ? joinArticle(definitePluralArticle, plural) : "",
        indefinite: singular ? joinArticle(indefiniteArticle, singular) : "",
      },
    };
  }

  if (type === "verb") {
    const fields = ["infinitive", "io", "tu", "luiLei", "noi", "voi", "loro", "participle"];
    const missing = fields.find((field) => !d[field]);
    if (missing) throw new Error(`${word} needs all verb forms before it can be added.`);
    const auxiliary = d.auxiliary === "essere" ? "essere" : d.auxiliary === "avere" ? "avere" : "";
    if (!auxiliary) throw new Error(`${word} needs an avere/essere auxiliary.`);
    return {
      id: 0,
      type,
      english,
      italian: d.infinitive,
      setName: null,
      tags: [],
      details: {
        io: d.io,
        tu: d.tu,
        luiLei: d.luiLei,
        noi: d.noi,
        voi: d.voi,
        loro: d.loro,
        auxiliary,
        participle: d.participle,
      },
    };
  }

  if (type === "adjective") {
    const masculineSingular = d.masculineSingular || word;
    const feminineSingular = d.feminineSingular || "";
    const masculinePlural = d.masculinePlural || "";
    const femininePlural = d.femininePlural || "";
    if (![masculineSingular, feminineSingular, masculinePlural, femininePlural].every(Boolean)) {
      throw new Error(`${word} needs all four adjective forms before it can be added.`);
    }
    return {
      id: 0,
      type,
      english,
      italian: masculineSingular,
      setName: null,
      tags: [],
      details: { masculineSingular, feminineSingular, masculinePlural, femininePlural },
    };
  }

  const form = d.form || word;
  if (!form) throw new Error(`${word} needs an adverb form.`);
  return { id: 0, type, english, italian: form, setName: null, tags: [], details: {} };
}

async function waitForTabComplete(tabId, timeoutMs = 15000) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete") return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timed out waiting for Parola to load."));
    }, timeoutMs);
    function listener(updatedId, changeInfo) {
      if (updatedId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function sendToParolaTab(tabId, cards) {
  let lastError = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "import-parola-cards", cards });
      if (response?.error) throw new Error(response.error);
      if (response?.ok) return response;
      lastError = new Error("Parola did not acknowledge the import.");
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError || new Error("Could not connect to the Parola page.");
}

async function importStaged(message) {
  const requestedIds = new Set(Array.isArray(message.ids) ? message.ids.map(String) : []);
  if (!requestedIds.size) throw new Error("Approve at least one word before adding to Parola.");

  const state = await readState();
  const items = state.staged.filter((item) => requestedIds.has(String(item.id)));
  if (items.length !== requestedIds.size) throw new Error("One or more staged words are no longer available.");
  if (items.some((item) => item.status !== "approved")) throw new Error("Only approved words can be added to Parola.");
  const cards = items.map(cardFromStaged);

  await appendEvent("import-start", { ids: [...requestedIds], cardCount: cards.length });
  const tab = await chrome.tabs.create({ url: parolaUrl, active: true });
  if (!tab.id) throw new Error("Could not open Parola.");
  await waitForTabComplete(tab.id);
  const imported = await sendToParolaTab(tab.id, cards);

  state.staged = state.staged.filter((item) => !requestedIds.has(String(item.id)));
  await writeStaged(state.staged);
  await appendEvent("import-success", {
    ids: [...requestedIds],
    cardCount: cards.length,
    storage: imported.storage || "browser",
    parolaTabId: tab.id,
  });
  return { ok: true, importedCount: cards.length, storage: imported.storage || "browser" };
}

async function ensureContextMenu() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: contextMenuId,
    title: "Stage “%s” in Parola",
    contexts: ["selection"],
  });
}

async function handleMessage(message) {
  switch (message?.type) {
    case "stage-input": {
      const parsed = parseInput(message.input);
      return stageCapture({ ...parsed, source: "popup", sourceUrl: message.sourceUrl || "" });
    }
    case "stage-selection":
      return stageCapture({
        word: message.selectionText,
        context: "",
        source: "selection",
        sourceUrl: message.sourceUrl || "",
        rawInput: message.selectionText || "",
      });
    case "get-state": {
      const state = await readState();
      return { ...state, version: chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version };
    }
    case "get-debug-bundle": {
      const state = await readState();
      const manifest = chrome.runtime.getManifest();
      return {
        formatVersion: 2,
        generatedAt: new Date().toISOString(),
        extension: { id: chrome.runtime.id, name: manifest.name, version: manifest.version, versionName: manifest.version_name || null },
        staged: state.staged,
        events: state.events,
      };
    }
    case "update-staged": {
      const state = await readState();
      const item = state.staged.find((candidate) => candidate.id === message.id);
      if (!item) throw new Error("Staged word not found.");
      if (typeof message.word === "string") {
        item.word = message.word.normalize("NFC").trim();
        item.normalizedWord = normalizeWord(item.word);
      }
      if (typeof message.english === "string") item.english = message.english.trim();
      if (typeof message.cardType === "string") item.cardType = cardTypes.has(message.cardType) ? message.cardType : "";
      if (message.details && typeof message.details === "object" && !Array.isArray(message.details)) item.details = cleanDetails(message.details);
      item.updatedAt = new Date().toISOString();
      await writeStaged(state.staged);
      await appendEvent("review-update", { stagedId: item.id, fields: Object.keys(message).filter((key) => !["type", "id"].includes(key)) });
      return { ok: true };
    }
    case "set-staged-status": {
      const state = await readState();
      const item = state.staged.find((candidate) => candidate.id === message.id);
      if (!item) throw new Error("Staged word not found.");
      item.status = message.status === "approved" ? "approved" : "pending";
      item.updatedAt = new Date().toISOString();
      await writeStaged(state.staged);
      await appendEvent("review-status", { stagedId: item.id, status: item.status });
      return { ok: true };
    }
    case "discard-staged": {
      const state = await readState();
      const item = state.staged.find((candidate) => candidate.id === message.id);
      state.staged = state.staged.filter((candidate) => candidate.id !== message.id);
      await writeStaged(state.staged);
      await appendEvent("stage-discard", { stagedId: message.id, word: item?.word || "" });
      return { ok: true };
    }
    case "import-staged":
      return importStaged(message);
    case "clear-staged": {
      const state = await readState();
      const cleared = state.staged.length;
      state.staged = [];
      await writeStaged(state.staged);
      await appendEvent("stage-clear", { cleared });
      return { ok: true };
    }
    case "clear-debug-events":
      await writeEvents([]);
      return { ok: true };
    case "open-review":
      await chrome.tabs.create({ url: chrome.runtime.getURL("review.html") });
      return { ok: true };
    default:
      throw new Error("Unknown extension message.");
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureContextMenu();
  void updateBadge();
});
chrome.runtime.onStartup.addListener(() => {
  void ensureContextMenu();
  void updateBadge();
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== contextMenuId || !info.selectionText) return;
  void stageCapture({
    word: info.selectionText,
    source: "selection",
    sourceUrl: tab?.url || info.pageUrl || "",
    rawInput: info.selectionText,
  }).catch((error) => appendEvent("error", {
    operation: "context-menu-stage",
    message: error instanceof Error ? error.message : String(error),
  }));
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleMessage(message).then(sendResponse).catch(async (error) => {
    const text = error instanceof Error ? error.message : String(error);
    try {
      await appendEvent("error", { operation: message?.type || "unknown-message", message: text });
    } catch {}
    sendResponse({ error: text });
  });
  return true;
});

void ensureContextMenu();
void updateBadge();
