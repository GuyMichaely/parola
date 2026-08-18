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

function cookieIdentity(cookie) {
  return JSON.stringify([
    cookie.name,
    cookie.domain,
    cookie.path,
    cookie.storeId,
    cookie.partitionKey?.topLevelSite || "",
    Boolean(cookie.partitionKey?.hasCrossSiteAncestor),
  ]);
}

function mergeCookies(...groups) {
  const byIdentity = new Map();
  for (const cookie of groups.flat()) byIdentity.set(cookieIdentity(cookie), cookie);
  return [...byIdentity.values()];
}

function isDuolingoCookie(cookie) {
  const domain = String(cookie?.domain || "").replace(/^\./, "").toLocaleLowerCase();
  return domain === "duolingo.com" || domain.endsWith(".duolingo.com");
}

async function captureDuolingoPageState(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      function requestResult(request) {
        return new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
        });
      }

      function openDatabase(name) {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error || new Error(`Could not open IndexedDB database ${name}`));
        });
      }

      async function captureIndexedDB() {
        if (typeof indexedDB.databases !== "function") return [];
        const databaseInfos = await indexedDB.databases();
        const result = [];
        const encoder = new TextEncoder();
        const maxStoreBytes = 128_000;
        const maxTotalBytes = 512_000;
        let capturedBytes = 0;

        for (const info of databaseInfos) {
          if (!info.name) continue;
          let database;
          try {
            database = await openDatabase(info.name);
            const databaseResult = {
              name: database.name,
              version: database.version,
              stores: [],
            };
            for (const storeName of [...database.objectStoreNames]) {
              const transaction = database.transaction(storeName, "readonly");
              const store = transaction.objectStore(storeName);
              const records = await requestResult(store.getAll());
              const keys = await requestResult(store.getAllKeys());
              let serializableRecords = null;
              let serializableKeys = null;
              let approximateBytes = 0;
              try {
                const recordsJson = JSON.stringify(records);
                const keysJson = JSON.stringify(keys);
                approximateBytes = encoder.encode(recordsJson).length + encoder.encode(keysJson).length;
                if (approximateBytes <= maxStoreBytes && capturedBytes + approximateBytes <= maxTotalBytes) {
                  serializableRecords = JSON.parse(recordsJson);
                  serializableKeys = JSON.parse(keysJson);
                  capturedBytes += approximateBytes;
                }
              } catch {
                // Keep schema/count metadata even when a value is not JSON-serializable.
              }
              databaseResult.stores.push({
                name: store.name,
                keyPath: store.keyPath,
                autoIncrement: store.autoIncrement,
                indexes: [...store.indexNames].map((indexName) => {
                  const index = store.index(indexName);
                  return {
                    name: index.name,
                    keyPath: index.keyPath,
                    multiEntry: index.multiEntry,
                    unique: index.unique,
                  };
                }),
                entryCount: records.length,
                approximateBytes,
                captured: Boolean(serializableRecords && serializableKeys),
                records: serializableRecords,
                keys: serializableKeys,
              });
            }
            result.push(databaseResult);
          } catch (error) {
            result.push({ name: info.name, version: info.version || 1, error: String(error), stores: [] });
          } finally {
            database?.close();
          }
        }
        return result;
      }

      return {
        href: location.href,
        pathname: location.pathname,
        title: document.title,
        hasPasswordInput: Boolean(document.querySelector('input[data-test="password-input"], input[type="password"]')),
        bodyStart: (document.body?.innerText || "").trim().toLocaleLowerCase().slice(0, 1200),
        documentCookieNames: document.cookie.split(";").map((entry) => entry.trim().split("=", 1)[0]).filter(Boolean).sort(),
        localStorage: Object.fromEntries(Object.entries(localStorage)),
        sessionStorage: Object.fromEntries(Object.entries(sessionStorage)),
        indexedDB: await captureIndexedDB(),
      };
    },
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

async function captureCookies(tab, pageState) {
  const [granted, stores, apexHostAccess, wildcardHostAccess] = await Promise.all([
    chrome.permissions.getAll(),
    chrome.cookies.getAllCookieStores(),
    chrome.permissions.contains({ origins: ["https://duolingo.com/*"] }),
    chrome.permissions.contains({ origins: ["https://*.duolingo.com/*"] }),
  ]);

  const activeStore = stores.find((store) => store.tabIds.includes(tab.id));
  if (!activeStore) {
    throw new Error("Could not identify the Chrome cookie store used by the active Duolingo tab.");
  }
  const storeId = activeStore.id;

  const [allVisible, byDomain, byUrl, apexJwt, wwwJwt] = await Promise.all([
    chrome.cookies.getAll({ storeId }),
    chrome.cookies.getAll({ domain: "duolingo.com", storeId }),
    chrome.cookies.getAll({ url: tab.url, storeId }),
    chrome.cookies.get({ url: "https://duolingo.com/", name: "jwt_token", storeId }),
    chrome.cookies.get({ url: "https://www.duolingo.com/", name: "jwt_token", storeId }),
  ]);

  let partitionKey = null;
  let partitioned = [];
  try {
    const details = await chrome.cookies.getPartitionKey({ tabId: tab.id, frameId: 0 });
    partitionKey = details?.partitionKey || null;
    if (partitionKey) {
      partitioned = await chrome.cookies.getAll({
        domain: "duolingo.com",
        storeId,
        partitionKey,
      });
    }
  } catch (error) {
    console.warn("Parola could not inspect partitioned Duolingo cookies", error);
  }

  const cookies = mergeCookies(
    allVisible.filter(isDuolingoCookie),
    byDomain,
    byUrl,
    [apexJwt, wwwJwt].filter(Boolean),
    partitioned,
  ).filter(isDuolingoCookie);

  return {
    cookies,
    diagnostics: {
      cookiePermissionGranted: (granted.permissions || []).includes("cookies"),
      apexHostAccess,
      wildcardHostAccess,
      grantedOrigins: granted.origins || [],
      cookieStoreCount: stores.length,
      activeStoreId: storeId,
      activeStoreTabCount: activeStore.tabIds.length,
      cookieNames: [...new Set(cookies.map((cookie) => cookie.name))].sort(),
      cookieDomains: [...new Set(cookies.map((cookie) => cookie.domain))].sort(),
      jwtTokenVisible: cookies.some((cookie) => cookie.name === "jwt_token"),
      jwtTokenVisibleToPage: (pageState?.documentCookieNames || []).includes("jwt_token"),
      documentCookieNames: pageState?.documentCookieNames || [],
      partitionKey,
      partitionedCookieCount: cookies.filter((cookie) => cookie.partitionKey).length,
    },
  };
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

  const cookieCapture = await captureCookies(tab, pageState);
  const cookies = cookieCapture.cookies;
  if (!cookies.length) throw new Error("No Duolingo cookies were found for this browser profile.");

  const payload = {
    version: 2,
    origin: "https://www.duolingo.com",
    exportedAt: new Date().toISOString(),
    sourceUrl: pageState.href,
    cookies: cookies.map(normalizeCookie),
    cookieDiagnostics: cookieCapture.diagnostics,
    localStorage: pageState.localStorage || {},
    sessionStorage: pageState.sessionStorage || {},
    indexedDB: pageState.indexedDB || [],
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
