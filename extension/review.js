let currentState = null;
const lessonId = new URLSearchParams(location.search).get("lesson") || "";
const typeLabels = {
  noun: "Noun",
  verb: "Verb",
  adjective: "Adjective",
  adverb: "Adverb",
};

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.error) throw new Error(response.error);
  return response;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function shownItems(state = currentState) {
  const staged = state?.staged || [];
  return lessonId ? staged.filter((item) => item.lessonId === lessonId) : staged;
}

function typeOptions(selected) {
  return [
    '<option value="">Choose type…</option>',
    ...Object.entries(typeLabels).map(([value, label]) =>
      `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`
    ),
  ].join("");
}

function stagedCard(item) {
  const context = item.contexts?.[item.contexts.length - 1] || "No context captured";
  const approved = item.status === "approved";
  return `
    <article class="staged-card ${approved ? "approved" : ""}" data-id="${escapeHtml(item.id)}">
      <div class="staged-main">
        <div class="word-line">
          <strong>${approved ? "Approved" : "Review"}</strong>
          ${approved ? '<span class="approved-pill">Ready</span>' : ""}
        </div>
        <div class="review-fields">
          <label>
            <span>Italian</span>
            <input data-field="word" value="${escapeHtml(item.word)}" autocomplete="off" />
          </label>
          <label>
            <span>English</span>
            <input data-field="english" value="${escapeHtml(item.english || "")}" placeholder="Translation" autocomplete="off" />
          </label>
          <label>
            <span>Part of speech</span>
            <select data-field="cardType">${typeOptions(item.cardType || "")}</select>
          </label>
        </div>
        <p class="captured-context">${escapeHtml(context)}</p>
        <small>Detected ${item.detectionCount || 1} ${item.detectionCount === 1 ? "time" : "times"}</small>
      </div>
      <div class="inline-actions staged-actions">
        <button data-action="approve" class="${approved ? "" : "primary"}">${approved ? "Unapprove" : "Approve"}</button>
        <button data-action="discard" class="danger-subtle">Discard</button>
      </div>
    </article>`;
}

function updateImportSummary() {
  const visible = shownItems();
  const approved = visible.filter((item) => item.status === "approved");
  document.getElementById("approved-summary").textContent = `${approved.length} approved`;
  document.getElementById("add-approved").disabled = approved.length === 0;
}

function render(state) {
  currentState = state;
  document.getElementById("version").textContent = state.version;
  if (lessonId) {
    document.getElementById("review-title").textContent = "Lesson complete";
    document.getElementById("review-subtitle").textContent = "Review the new words Parola found in this lesson, then add the approved ones to your inventory.";
  }

  const visible = shownItems(state);
  const list = document.getElementById("staged-list");
  list.innerHTML = visible.length
    ? visible.map(stagedCard).join("")
    : '<div class="empty-card">No staged words are waiting for review.</div>';

  const positives = state.diagnostics.filter((item) => item.kind === "positive-detection").length;
  const manual = state.diagnostics.filter((item) => item.kind === "manual-false-negative-snapshot").length;
  document.getElementById("diagnostics-summary").innerHTML = `
    <div><strong>${state.diagnostics.length}</strong><span>Total records</span></div>
    <div><strong>${positives}</strong><span>Positive detections</span></div>
    <div><strong>${manual}</strong><span>Manual snapshots</span></div>`;
  updateImportSummary();
}

async function refresh() {
  render(await send({ type: "get-state" }));
}

function setImportStatus(message, isError = false) {
  const element = document.getElementById("import-status");
  element.textContent = message;
  element.classList.toggle("error-text", isError);
}

async function persistField(control) {
  const card = control.closest("[data-id]");
  const id = card?.dataset.id;
  const item = currentState?.staged.find((candidate) => candidate.id === id);
  if (!id || !item) return;
  const field = control.dataset.field;
  const value = control.value;
  item[field] = value;
  await send({ type: "update-staged", id, [field]: value });
}

document.getElementById("staged-list").addEventListener("change", async (event) => {
  const control = event.target.closest("[data-field]");
  if (!control) return;
  try {
    await persistField(control);
    setImportStatus("");
  } catch (error) {
    setImportStatus(error instanceof Error ? error.message : String(error), true);
  }
});

document.getElementById("staged-list").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const card = button.closest("[data-id]");
  const id = card?.dataset.id;
  if (!id) return;

  try {
    if (button.dataset.action === "discard") {
      await send({ type: "discard-staged", id });
    } else {
      const item = currentState.staged.find((candidate) => candidate.id === id);
      await send({ type: "set-staged-status", id, status: item?.status === "approved" ? "pending" : "approved" });
    }
    setImportStatus("");
    await refresh();
  } catch (error) {
    setImportStatus(error instanceof Error ? error.message : String(error), true);
  }
});

document.getElementById("approve-all").addEventListener("click", async () => {
  try {
    for (const item of shownItems()) {
      if (item.status !== "approved") {
        await send({ type: "set-staged-status", id: item.id, status: "approved" });
      }
    }
    await refresh();
  } catch (error) {
    setImportStatus(error instanceof Error ? error.message : String(error), true);
  }
});

document.getElementById("add-approved").addEventListener("click", async () => {
  const approved = shownItems().filter((item) => item.status === "approved");
  if (!approved.length) return;
  const missing = approved.find((item) => !String(item.english || "").trim() || !item.cardType);
  if (missing) {
    setImportStatus(`Add an English translation and part of speech for ${missing.word || "each approved word"}.`, true);
    return;
  }

  const button = document.getElementById("add-approved");
  button.disabled = true;
  button.textContent = "Adding…";
  setImportStatus("Opening Parola and adding the approved words…");
  try {
    const result = await send({ type: "import-staged", ids: approved.map((item) => item.id) });
    setImportStatus(`Added ${result.importedCount} ${result.importedCount === 1 ? "word" : "words"} to Parola (${result.storage} storage).`);
    await refresh();
  } catch (error) {
    setImportStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    button.textContent = "Add approved to Parola";
    updateImportSummary();
  }
});

document.getElementById("clear-staged").addEventListener("click", async () => {
  const visible = shownItems();
  if (!visible.length) return;
  if (!confirm(`Clear ${visible.length === 1 ? "this staged word" : "these staged words"}? Diagnostics will be kept.`)) return;
  await send({ type: "clear-staged", lessonId });
  await refresh();
});

document.getElementById("clear-diagnostics").addEventListener("click", async () => {
  if (!confirm("Clear all detector diagnostics?")) return;
  await send({ type: "clear-diagnostics" });
  await refresh();
});

document.getElementById("export-diagnostics").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(currentState?.diagnostics || [], null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `parola-duolingo-diagnostics-${new Date().toISOString().replaceAll(":", "-")}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

void refresh().catch((error) => setImportStatus(error instanceof Error ? error.message : String(error), true));
