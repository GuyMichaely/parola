let currentState = null;

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.error) throw new Error(response.error);
  return response;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stagedCard(item) {
  const context = item.contexts?.[item.contexts.length - 1] || "No context captured";
  const approved = item.status === "approved";
  return `
    <article class="staged-card ${approved ? "approved" : ""}" data-id="${item.id}">
      <div class="staged-main">
        <div class="word-line">
          <strong>${escapeHtml(item.word)}</strong>
          ${approved ? '<span class="approved-pill">Approved</span>' : ""}
        </div>
        <p>${escapeHtml(context)}</p>
        <small>Detected ${item.detectionCount || 1} ${item.detectionCount === 1 ? "time" : "times"}</small>
      </div>
      <div class="inline-actions">
        <button data-action="approve" class="${approved ? "" : "primary"}">${approved ? "Unapprove" : "Approve"}</button>
        <button data-action="discard" class="danger-subtle">Discard</button>
      </div>
    </article>`;
}

function render(state) {
  currentState = state;
  document.getElementById("version").textContent = state.version;
  const list = document.getElementById("staged-list");
  list.innerHTML = state.staged.length
    ? state.staged.map(stagedCard).join("")
    : '<div class="empty-card">No staged words yet.</div>';

  const positives = state.diagnostics.filter((item) => item.kind === "positive-detection").length;
  const manual = state.diagnostics.filter((item) => item.kind === "manual-false-negative-snapshot").length;
  document.getElementById("diagnostics-summary").innerHTML = `
    <div><strong>${state.diagnostics.length}</strong><span>Total records</span></div>
    <div><strong>${positives}</strong><span>Positive detections</span></div>
    <div><strong>${manual}</strong><span>Manual snapshots</span></div>`;
}

async function refresh() {
  render(await send({ type: "get-state" }));
}

document.getElementById("staged-list").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const card = button.closest("[data-id]");
  const id = card?.dataset.id;
  if (!id) return;

  if (button.dataset.action === "discard") {
    await send({ type: "discard-staged", id });
  } else {
    const item = currentState.staged.find((candidate) => candidate.id === id);
    await send({ type: "set-staged-status", id, status: item?.status === "approved" ? "pending" : "approved" });
  }
  await refresh();
});

document.getElementById("clear-staged").addEventListener("click", async () => {
  if (!confirm("Clear all staged words? Diagnostics will be kept.")) return;
  await send({ type: "clear-staged" });
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

void refresh();
