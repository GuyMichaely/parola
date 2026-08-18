const sessionExportKey = "parola-extension:duolingo-session-export";

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

function normalizeCookie(cookie) {
  const result = {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path || "/",
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    session: Boolean(cookie.session),
  };
  if (Number.isFinite(cookie.expirationDate)) result.expires = cookie.expirationDate;
  if (cookie.sameSite === "no_restriction") result.sameSite = "None";
  else if (cookie.sameSite === "lax") result.sameSite = "Lax";
  else if (cookie.sameSite === "strict") result.sameSite = "Strict";
  if (cookie.partitionKey) result.partitionKey = cookie.partitionKey;
  return result;
}

async function captureDuolingoPageState(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      href: location.href,
      pathname: location.pathname,
      title: document.title,
      hasPasswordInput: Boolean(document.querySelector('input[data-test="password-input"], input[type="password"]')),
      bodyStart: (document.body?.innerText || "").trim().toLocaleLowerCase().slice(0, 1200),
      localStorage: Object.fromEntries(Object.entries(localStorage)),
      sessionStorage: Object.fromEntries(Object.entries(sessionStorage)),
    }),
  });
  return result;
}

function looksLoggedOut(pageState) {
  if (!pageState) return true;
  if (pageState.hasPasswordInput) return true;
  if (/\/log-in(?:\/|$)/.test(pageState.pathname || "")) return true;
  const text = pageState.bodyStart || "";
  return (text.includes("get started") && text.includes("log in")) || text.includes("sign up with google");
}

async function prepareSessionExport() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/(?:www\.)?duolingo\.com\//i.test(tab.url || "")) {
    throw new Error("Open Duolingo in the active tab and make sure the disposable test account is logged in first.");
  }

  const pageState = await captureDuolingoPageState(tab.id);
  if (looksLoggedOut(pageState)) {
    throw new Error("This Duolingo tab appears to be logged out. Log into the disposable test account, then export again.");
  }

  const cookies = await chrome.cookies.getAll({ domain: "duolingo.com" });
  if (!cookies.length) throw new Error("No Duolingo cookies were found for this browser profile.");

  const payload = {
    version: 1,
    origin: "https://www.duolingo.com",
    exportedAt: new Date().toISOString(),
    sourceUrl: pageState.href,
    cookies: cookies.map(normalizeCookie),
    localStorage: pageState.localStorage || {},
    sessionStorage: pageState.sessionStorage || {},
  };

  await chrome.storage.local.set({ [sessionExportKey]: payload });
  await chrome.tabs.create({ url: chrome.runtime.getURL("session-export.html") });
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

document.getElementById("export-session").addEventListener("click", async () => {
  const status = document.getElementById("status");
  const button = document.getElementById("export-session");
  button.disabled = true;
  status.textContent = "Collecting Duolingo cookies and browser storage…";
  try {
    await prepareSessionExport();
    window.close();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    button.disabled = false;
  }
});

void refresh();
