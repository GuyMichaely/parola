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

function addSummaryItem(container, value, label) {
  const row = document.createElement("div");
  const strong = document.createElement("strong");
  const span = document.createElement("span");
  strong.textContent = String(value);
  span.textContent = label;
  row.append(strong, span);
  container.append(row);
}

function renderSummary(payload, encodedBytes) {
  const httpOnlyCount = (payload.cookies || []).filter((cookie) => cookie.httpOnly).length;
  const diagnostics = payload.cookieDiagnostics || {};
  const container = document.getElementById("export-summary");
  container.replaceChildren();
  addSummaryItem(container, payload.cookies?.length || 0, "Duolingo cookies");
  addSummaryItem(container, httpOnlyCount, "HttpOnly cookies");
  addSummaryItem(container, diagnostics.apexHostAccess && diagnostics.wildcardHostAccess ? "yes" : "no", "Duolingo host access");
  addSummaryItem(container, diagnostics.jwtTokenVisibleToPage ? "yes" : "no", "jwt_token visible to page");
  addSummaryItem(container, diagnostics.jwtTokenVisible ? "yes" : "no", "jwt_token captured");
  addSummaryItem(container, diagnostics.activeStoreId ?? "?", "Active cookie store");
  addSummaryItem(container, Object.keys(payload.localStorage || {}).length + Object.keys(payload.sessionStorage || {}).length, "Storage keys");
  addSummaryItem(container, encodedBytes, "Encoded bytes");
}

async function prepare() {
  const stored = await chrome.storage.local.get(sessionExportKey);
  const payload = stored[sessionExportKey];
  if (!payload) throw new Error("No pending Duolingo session export was found. Return to a logged-in Duolingo tab and use Export GitHub login session again.");

  encodedState = `${await encodePayload(payload)}\n`;
  renderSummary(payload, encodedState.length);
  const jwtVisible = Boolean(payload.cookieDiagnostics?.jwtTokenVisible);
  document.getElementById("export-status").textContent = jwtVisible
    ? "Ready. The authentication cookie was captured."
    : "Warning: the authenticated tab was detected, but jwt_token was not visible to Parola. Do not upload this export yet.";
  document.getElementById("download-session").disabled = !jwtVisible;
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
