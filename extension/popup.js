async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.error) throw new Error(response.error);
  return response;
}

async function refresh() {
  const state = await send({ type: "get-state" });
  const active = state.staged.filter((item) => item.status !== "discarded");
  document.getElementById("staged-count").textContent = String(active.length);
  document.getElementById("version").textContent = state.version;
  document.getElementById("word-preview").textContent = active.slice(0, 6).map((item) => item.word).join(" · ") || "No words staged yet";
}

document.getElementById("review").addEventListener("click", async () => {
  await send({ type: "open-review" });
  window.close();
});

document.getElementById("capture").addEventListener("click", async () => {
  const status = document.getElementById("status");
  status.textContent = "Capturing…";
  try {
    await send({ type: "capture-current" });
    status.textContent = "Snapshot saved to Diagnostics.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});

void refresh();
