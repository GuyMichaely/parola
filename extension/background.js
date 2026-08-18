const stagedKey = "parola-extension:staged";
const diagnosticsKey = "parola-extension:diagnostics";
const parolaUrl = "https://guymichaely.com/parola/";
const cardTypes = new Set(["noun", "verb", "adjective", "adverb"]);

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
  const stored = await chrome.storage.local.get([stagedKey, diagnosticsKey]);
  return {
    staged: Array.isArray(stored[stagedKey]) ? stored[stagedKey] : [],
    diagnostics: Array.isArray(stored[diagnosticsKey]) ? stored[diagnosticsKey] : [],
  };
}

async function writeStaged(staged) {
  await chrome.storage.local.set({ [stagedKey]: staged });
  await updateBadge(staged);
}

async function writeDiagnostics(diagnostics) {
  await chrome.storage.local.set({ [diagnosticsKey]: diagnostics });
}

async function updateBadge(stagedOverride) {
  const staged = stagedOverride ?? (await readState()).staged;
  const count = staged.filter((item) => item.status !== "discarded").length;
  await chrome.action.setBadgeText({ text: count ? String(count) : "" });
}

async function recordDetection(detection) {
  const state = await readState();
  const now = new Date().toISOString();
  const lessonId = String(detection.lessonId || "unscoped");
  const diagnostic = {
    id: crypto.randomUUID(),
    kind: "positive-detection",
    capturedAt: now,
    ...detection,
    lessonId,
  };
  state.diagnostics.push(diagnostic);

  const normalized = normalizeWord(detection.word);
  const existing = state.staged.find((item) =>
    item.normalizedWord === normalized
    && item.lessonId === lessonId
    && item.status !== "discarded"
  );
  if (existing) {
    existing.lastDetectedAt = now;
    existing.detectionCount = (existing.detectionCount || 1) + 1;
    existing.contexts = Array.isArray(existing.contexts) ? existing.contexts : [];
    if (detection.context && !existing.contexts.includes(detection.context)) {
      existing.contexts.push(detection.context);
    }
  } else {
    state.staged.push({
      id: crypto.randomUUID(),
      lessonId,
      lessonStartedAt: detection.lessonStartedAt || now,
      word: detection.word,
      normalizedWord: normalized,
      english: "",
      cardType: "",
      details: {},
      status: "pending",
      firstDetectedAt: now,
      lastDetectedAt: now,
      detectionCount: 1,
      contexts: detection.context ? [detection.context] : [],
      sourceUrl: detection.url,
    });
  }

  await Promise.all([writeDiagnostics(state.diagnostics), writeStaged(state.staged)]);
  return {
    lessonId,
    stagedCount: state.staged.filter((item) => item.status !== "discarded").length,
  };
}

async function recordLessonComplete(message) {
  const lessonId = String(message.lessonId || "");
  if (!lessonId) return { reviewOpened: false, reason: "missing-lesson-id" };

  const state = await readState();
  const lessonItems = state.staged.filter((item) => item.lessonId === lessonId);
  if (!lessonItems.length) return { reviewOpened: false, reason: "no-staged-words" };
  if (lessonItems.some((item) => item.reviewOpenedAt)) {
    return { reviewOpened: false, reason: "already-opened" };
  }

  const now = new Date().toISOString();
  for (const item of lessonItems) {
    item.lessonCompletedAt = message.completedAt || now;
    item.reviewOpenedAt = now;
  }
  await writeStaged(state.staged);

  const query = new URLSearchParams({ lesson: lessonId });
  await chrome.tabs.create({ url: `${chrome.runtime.getURL("review.html")}?${query}` });
  return { reviewOpened: true, lessonId, wordCount: lessonItems.length };
}

async function recordManualSnapshot(snapshot) {
  const state = await readState();
  state.diagnostics.push({
    id: crypto.randomUUID(),
    kind: "manual-false-negative-snapshot",
    capturedAt: new Date().toISOString(),
    ...snapshot,
  });
  await writeDiagnostics(state.diagnostics);
  return { diagnosticsCount: state.diagnostics.length };
}

async function captureCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab is available.");
  const response = await chrome.tabs.sendMessage(tab.id, { type: "capture-manual-snapshot" });
  if (!response?.snapshot) throw new Error("Open a Duolingo lesson before capturing a snapshot.");
  return recordManualSnapshot(response.snapshot);
}

function cardFromStaged(item) {
  const detectedWord = String(item.word || "").normalize("NFC").trim();
  const english = String(item.english || "").trim();
  const type = String(item.cardType || "");
  const d = cleanDetails(item.details);
  if (!detectedWord) throw new Error("Every approved item needs an Italian word.");
  if (!english) throw new Error(`${detectedWord} needs an English translation before it can be added.`);
  if (!cardTypes.has(type)) throw new Error(`${detectedWord} needs a part of speech before it can be added.`);

  if (type === "noun") {
    const gender = d.gender;
    const singular = d.singular || detectedWord;
    const plural = d.plural || "";
    const definiteSingularArticle = d.definiteSingularArticle || "";
    const definitePluralArticle = d.definitePluralArticle || "";
    const indefiniteArticle = d.indefiniteArticle || "";
    if (!new Set(["masculine", "feminine"]).has(gender)) {
      throw new Error(`${detectedWord} needs a noun gender.`);
    }
    if (!singular && !plural) throw new Error(`${detectedWord} needs a singular or plural noun form.`);
    if (!singular && (definiteSingularArticle || indefiniteArticle)) {
      throw new Error(`${detectedWord} has singular articles but no singular noun form.`);
    }
    if (!plural && definitePluralArticle) {
      throw new Error(`${detectedWord} has a plural article but no plural noun form.`);
    }
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
    if (missing) throw new Error(`${detectedWord} needs all verb forms before it can be added.`);
    const auxiliary = d.auxiliary === "essere" ? "essere" : d.auxiliary === "avere" ? "avere" : "";
    if (!auxiliary) throw new Error(`${detectedWord} needs an avere/essere auxiliary.`);
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
    const masculineSingular = d.masculineSingular || detectedWord;
    const feminineSingular = d.feminineSingular || "";
    const masculinePlural = d.masculinePlural || "";
    const femininePlural = d.femininePlural || "";
    if (![masculineSingular, feminineSingular, masculinePlural, femininePlural].every(Boolean)) {
      throw new Error(`${detectedWord} needs all four adjective forms before it can be added.`);
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

  const form = d.form || detectedWord;
  if (!form) throw new Error(`${detectedWord} needs an adverb form.`);
  return {
    id: 0,
    type,
    english,
    italian: form,
    setName: null,
    tags: [],
    details: {},
  };
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
  if (items.some((item) => item.status !== "approved")) {
    throw new Error("Only approved words can be added to Parola.");
  }
  const cards = items.map(cardFromStaged);

  const tab = await chrome.tabs.create({ url: parolaUrl, active: true });
  if (!tab.id) throw new Error("Could not open Parola.");
  await waitForTabComplete(tab.id);
  const imported = await sendToParolaTab(tab.id, cards);

  state.staged = state.staged.filter((item) => !requestedIds.has(String(item.id)));
  await writeStaged(state.staged);
  return {
    ok: true,
    importedCount: cards.length,
    storage: imported.storage || "browser",
  };
}

async function handleMessage(message) {
  switch (message?.type) {
    case "detected-new-word":
      return recordDetection(message.detection);
    case "lesson-complete":
      return recordLessonComplete(message);
    case "get-state": {
      const state = await readState();
      return {
        ...state,
        version: chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version,
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
      if (typeof message.cardType === "string") {
        item.cardType = cardTypes.has(message.cardType) ? message.cardType : "";
      }
      if (message.details && typeof message.details === "object" && !Array.isArray(message.details)) {
        item.details = cleanDetails(message.details);
      }
      await writeStaged(state.staged);
      return { ok: true };
    }
    case "set-staged-status": {
      const state = await readState();
      const item = state.staged.find((candidate) => candidate.id === message.id);
      if (!item) throw new Error("Staged word not found.");
      item.status = message.status === "approved" ? "approved" : "pending";
      await writeStaged(state.staged);
      return { ok: true };
    }
    case "discard-staged": {
      const state = await readState();
      state.staged = state.staged.filter((candidate) => candidate.id !== message.id);
      await writeStaged(state.staged);
      return { ok: true };
    }
    case "import-staged":
      return importStaged(message);
    case "clear-staged": {
      const state = await readState();
      const lessonId = String(message.lessonId || "");
      state.staged = lessonId
        ? state.staged.filter((item) => item.lessonId !== lessonId)
        : [];
      await writeStaged(state.staged);
      return { ok: true };
    }
    case "clear-diagnostics":
      await writeDiagnostics([]);
      return { ok: true };
    case "capture-current":
      return captureCurrentTab();
    case "open-review":
      await chrome.tabs.create({ url: chrome.runtime.getURL("review.html") });
      return { ok: true };
    default:
      throw new Error("Unknown extension message.");
  }
}

chrome.runtime.onInstalled.addListener(() => void updateBadge());
chrome.runtime.onStartup.addListener(() => void updateBadge());
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleMessage(message).then(sendResponse).catch((error) => {
    sendResponse({ error: error instanceof Error ? error.message : String(error) });
  });
  return true;
});

void updateBadge();
