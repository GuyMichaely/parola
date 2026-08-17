const stagedKey = "parola-extension:staged";
const diagnosticsKey = "parola-extension:diagnostics";

function normalizeWord(value) {
  return String(value || "").normalize("NFC").trim().toLocaleLowerCase("it-IT");
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
  const diagnostic = {
    id: crypto.randomUUID(),
    kind: "positive-detection",
    capturedAt: now,
    ...detection,
  };
  state.diagnostics.push(diagnostic);

  const normalized = normalizeWord(detection.word);
  const existing = state.staged.find((item) => item.normalizedWord === normalized && item.status !== "discarded");
  if (existing) {
    existing.lastDetectedAt = now;
    existing.detectionCount = (existing.detectionCount || 1) + 1;
    if (detection.context && !existing.contexts.includes(detection.context)) {
      existing.contexts.push(detection.context);
    }
  } else {
    state.staged.push({
      id: crypto.randomUUID(),
      word: detection.word,
      normalizedWord: normalized,
      status: "pending",
      firstDetectedAt: now,
      lastDetectedAt: now,
      detectionCount: 1,
      contexts: detection.context ? [detection.context] : [],
      sourceUrl: detection.url,
    });
  }

  await Promise.all([writeDiagnostics(state.diagnostics), writeStaged(state.staged)]);
  return { stagedCount: state.staged.filter((item) => item.status !== "discarded").length };
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

async function handleMessage(message) {
  switch (message?.type) {
    case "detected-new-word":
      return recordDetection(message.detection);
    case "get-state": {
      const state = await readState();
      return {
        ...state,
        version: chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version,
      };
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
    case "clear-staged":
      await writeStaged([]);
      return { ok: true };
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
