let currentState = null;

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.error) throw new Error(response.error);
  return response;
}

function setStatus(message, isError = false) {
  const status = document.getElementById("status");
  status.textContent = message;
  status.classList.toggle("error-text", isError);
}

async function currentTabUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url || "";
  } catch {
    return "";
  }
}

function render(state) {
  currentState = state;
  document.getElementById("version").textContent = state.version;
  const staged = state.staged || [];
  document.getElementById("staged-count").textContent = String(staged.length);
  document.getElementById("word-preview").textContent = staged.length
    ? staged.slice(-6).map((item) => item.word).join(" · ")
    : "Nothing staged yet";
  document.getElementById("review").disabled = staged.length === 0;
}

async function refresh() {
  render(await send({ type: "get-state" }));
}

document.getElementById("capture-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.getElementById("capture-input");
  const value = input.value;
  try {
    const result = await send({ type: "stage-input", input: value, sourceUrl: await currentTabUrl() });
    input.value = "";
    setStatus(`Staged ${result.word}.`);
    await refresh();
    input.focus();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
});

document.getElementById("review").addEventListener("click", async () => {
  try {
    await send({ type: "open-review" });
    window.close();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
});

document.getElementById("export-debug").addEventListener("click", async () => {
  try {
    const bundle = await send({ type: "get-debug-bundle" });
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `parola-debug-${new Date().toISOString().replaceAll(":", "-")}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`Exported ${bundle.events.length} debug events.`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
});

void refresh().catch((error) => setStatus(error instanceof Error ? error.message : String(error), true));
