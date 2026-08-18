const sessionExportKey = "parola-extension:duolingo-session-export";
let encodedState = "";

function bytesToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function gzipBytes(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function encodePayload(payload) {
  const raw = JSON.stringify(payload);
  return bytesToBase64(await gzipBytes(raw));
}

function renderSummary(payload, encodedBytes) {
  const httpOnlyCount = (payload.cookies || []).filter((cookie) => cookie.httpOnly).length;
  document.getElementById("export-summary").innerHTML = `
    <div><strong>${payload.cookies?.length || 0}</strong><span>Duolingo cookies</span></div>
    <div><strong>${httpOnlyCount}</strong><span>HttpOnly cookies</span></div>
    <div><strong>${Object.keys(payload.localStorage || {}).length + Object.keys(payload.sessionStorage || {}).length}</strong><span>Storage keys</span></div>
    <div><strong>${encodedBytes}</strong><span>Encoded bytes</span></div>`;
}

async function prepare() {
  const stored = await chrome.storage.local.get(sessionExportKey);
  const payload = stored[sessionExportKey];
  if (!payload) throw new Error("No pending Duolingo session export was found. Return to a logged-in Duolingo tab and use Export GitHub login session again.");

  encodedState = `${await encodePayload(payload)}\n`;
  renderSummary(payload, encodedState.length);
  document.getElementById("export-status").textContent = "Ready. Download the file and replace the repository session fixture with it.";
  document.getElementById("download-session").disabled = false;
  await chrome.storage.local.remove(sessionExportKey);
}

document.getElementById("download-session").addEventListener("click", () => {
  if (!encodedState) return;
  const blob = new Blob([encodedState], { type: "text/plain;charset=us-ascii" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "duolingo-session-state.b64";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  document.getElementById("export-status").textContent = "Downloaded. Replace extension/tests/fixtures/duolingo-session-state.b64, commit, and push.";
});

void prepare().catch((error) => {
  document.getElementById("export-status").textContent = error instanceof Error ? error.message : String(error);
  document.getElementById("export-status").classList.add("error-text");
});
