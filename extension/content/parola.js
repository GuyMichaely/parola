(() => {
  const requestType = "parola-extension-import";
  const resultType = "parola-extension-import-result";
  const requestSource = "parola-capture-extension";
  const resultSource = "parola-web";

  function importThroughParola(candidates) {
    if (!Array.isArray(candidates) || !candidates.length) throw new Error("No candidates were supplied for import.");
    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      let settled = false;
      const payload = {
        source: requestSource,
        type: requestType,
        requestId,
        candidates,
      };

      function cleanup() {
        window.removeEventListener("message", handleMessage);
        clearInterval(retryTimer);
        clearTimeout(timeoutTimer);
      }

      function finish(callback) {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      }

      function handleMessage(event) {
        if (event.source !== window || event.origin !== window.location.origin) return;
        const message = event.data;
        if (message?.source !== resultSource || message?.type !== resultType || message?.requestId !== requestId) return;
        if (message.ok) {
          finish(() => resolve({
            ok: true,
            importedCount: Number(message.importedCount) || candidates.length,
            storage: message.storage === "sync" ? "sync" : "browser",
          }));
        } else {
          finish(() => reject(new Error(String(message.error || "Parola rejected the staged candidates."))));
        }
      }

      function postRequest() {
        window.postMessage(payload, window.location.origin);
      }

      window.addEventListener("message", handleMessage);
      const retryTimer = setInterval(postRequest, 250);
      const timeoutTimer = setTimeout(() => {
        finish(() => reject(new Error("Parola did not accept the staged candidates. Reload Parola and try again.")));
      }, 10000);
      postRequest();
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "import-parola-cards") return;
    void importThroughParola(message.cards)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({ error: error instanceof Error ? error.message : String(error) });
      });
    return true;
  });
})();
