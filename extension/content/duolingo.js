(() => {
  const seenFingerprints = new Set();
  const lessonSessionKey = "parola-duolingo:lesson-session";
  let scanTimer = null;

  function normalizeText(value) {
    return String(value || "").normalize("NFC").replace(/\s+/g, " ").trim();
  }

  function truncate(value, max) {
    const text = String(value || "");
    return text.length <= max ? text : `${text.slice(0, max)}\n<!-- truncated -->`;
  }

  function newSessionId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  function visible(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0 && rect.width > 0 && rect.height > 0;
  }

  function parseRgb(value) {
    const match = String(value || "").match(/rgba?\((\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)/i);
    return match ? match.slice(1, 4).map(Number) : null;
  }

  function looksPurple(color) {
    const rgb = parseRgb(color);
    if (!rgb) return false;
    const [r, g, b] = rgb;
    return r >= 125 && b >= 145 && g <= Math.min(r, b) * 0.88 && (r + b - (2 * g)) >= 75;
  }

  function textNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = normalizeText(node.nodeValue);
      if (text) nodes.push({ node, text });
    }
    return nodes;
  }

  function newWordMarkers() {
    const markers = new Set();
    for (const { node, text } of textNodes(document.body)) {
      if (text.toLocaleUpperCase("en-US") === "NEW WORD" && node.parentElement) markers.add(node.parentElement);
    }
    return [...markers].filter(visible);
  }

  function exerciseRoot(marker) {
    let current = marker;
    let best = marker.parentElement || marker;
    for (let depth = 0; current && depth < 9; depth += 1, current = current.parentElement) {
      if (current === document.body || current === document.documentElement) break;
      const text = normalizeText(current.innerText || current.textContent);
      if (text.length >= 20 && text.length <= 3500) best = current;
      if (current.matches?.("main, [role='main']")) break;
    }
    return best;
  }

  function candidateTextElements(root, marker) {
    const candidates = [];
    const seen = new Set();
    for (const { node, text } of textNodes(root)) {
      const element = node.parentElement;
      if (!element || marker.contains(element) || element.contains(marker) || !visible(element)) continue;
      if (seen.has(element)) continue;
      if (text.toLocaleUpperCase("en-US") === "NEW WORD") continue;
      if (!/^[\p{L}][\p{L}'’\-]{0,39}$/u.test(text)) continue;
      const color = getComputedStyle(element).color;
      if (!looksPurple(color)) continue;
      seen.add(element);
      candidates.push({ element, word: text, color });
    }
    return candidates;
  }

  function candidateContext(element, root) {
    let current = element;
    let best = normalizeText(element.innerText || element.textContent);
    for (let depth = 0; current && current !== root && depth < 6; depth += 1, current = current.parentElement) {
      const text = normalizeText(current.innerText || current.textContent);
      const wordCount = text ? text.split(/\s+/).length : 0;
      if (text.length <= 180 && wordCount <= 18) best = text;
      else break;
    }
    return best;
  }

  function describeElement(element) {
    return {
      tagName: element.tagName,
      className: typeof element.className === "string" ? element.className : "",
      role: element.getAttribute("role"),
      dataTest: element.getAttribute("data-test"),
    };
  }

  function readLessonSession() {
    try {
      const stored = sessionStorage.getItem(lessonSessionKey);
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      return parsed && typeof parsed.id === "string" ? parsed : null;
    } catch {
      return null;
    }
  }

  function writeLessonSession(session) {
    try {
      sessionStorage.setItem(lessonSessionKey, JSON.stringify(session));
    } catch {
      // The in-memory detector still works if Duolingo blocks sessionStorage.
    }
  }

  function ensureLessonSession() {
    const existing = readLessonSession();
    if (existing && !existing.completed) return existing;
    const session = {
      id: newSessionId(),
      startedAt: new Date().toISOString(),
      startUrl: location.href,
      completed: false,
    };
    writeLessonSession(session);
    return session;
  }

  function completionMarker() {
    if (!document.body) return null;
    const pattern = /^(?:LESSON|PRACTICE|LEVEL|UNIT)\s+COMPLETE!?$/;
    for (const { node, text } of textNodes(document.body)) {
      if (!pattern.test(text.toLocaleUpperCase("en-US"))) continue;
      const element = node.parentElement;
      if (element && visible(element)) return { element, text };
    }
    return null;
  }

  async function reportLessonComplete(marker) {
    const session = readLessonSession();
    if (!session || session.completed) return;
    const completedAt = new Date().toISOString();
    writeLessonSession({ ...session, completed: true, completedAt, completionText: marker.text });
    try {
      await chrome.runtime.sendMessage({
        type: "lesson-complete",
        lessonId: session.id,
        completedAt,
        url: location.href,
        completionText: marker.text,
      });
    } catch (error) {
      console.warn("Parola could not open the lesson review", error);
    }
  }

  function showToast(word) {
    const old = document.getElementById("parola-new-word-toast");
    old?.remove();
    const toast = document.createElement("div");
    toast.id = "parola-new-word-toast";
    toast.textContent = `Parola staged: ${word}`;
    Object.assign(toast.style, {
      position: "fixed",
      right: "20px",
      bottom: "20px",
      zIndex: "2147483647",
      background: "#111827",
      color: "white",
      padding: "10px 14px",
      borderRadius: "10px",
      font: "600 14px system-ui, sans-serif",
      boxShadow: "0 8px 30px rgba(0,0,0,.28)",
      pointerEvents: "none",
    });
    document.documentElement.appendChild(toast);
    setTimeout(() => toast.remove(), 1800);
  }

  async function report(marker, root, candidate) {
    const lesson = ensureLessonSession();
    const context = candidateContext(candidate.element, root);
    const exerciseText = normalizeText(root.innerText || root.textContent);
    const fingerprint = [lesson.id, candidate.word, context, exerciseText.slice(0, 500), location.pathname].join("\u241f");
    if (seenFingerprints.has(fingerprint)) return;
    seenFingerprints.add(fingerprint);

    const detection = {
      lessonId: lesson.id,
      lessonStartedAt: lesson.startedAt,
      word: candidate.word,
      context,
      exerciseText,
      url: location.href,
      pageTitle: document.title,
      evidence: {
        newWordMarker: true,
        highlightedText: true,
        color: candidate.color,
        marker: describeElement(marker),
        candidate: describeElement(candidate.element),
        root: describeElement(root),
      },
      markerHtml: truncate(marker.outerHTML, 20_000),
      candidateHtml: truncate(candidate.element.outerHTML, 20_000),
      contextHtml: truncate(candidate.element.parentElement?.outerHTML, 80_000),
      exerciseHtml: truncate(root.outerHTML, 250_000),
    };

    try {
      const result = await chrome.runtime.sendMessage({ type: "detected-new-word", detection });
      if (!result?.error) showToast(candidate.word);
    } catch (error) {
      console.warn("Parola could not stage detected word", error);
    }
  }

  function scan() {
    if (!document.body) return;
    for (const marker of newWordMarkers()) {
      const root = exerciseRoot(marker);
      for (const candidate of candidateTextElements(root, marker)) {
        void report(marker, root, candidate);
      }
    }
    const completed = completionMarker();
    if (completed) void reportLessonComplete(completed);
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 180);
  }

  function coloredTextSample() {
    const result = [];
    for (const { node, text } of textNodes(document.body)) {
      const element = node.parentElement;
      if (!element || !visible(element) || text.length > 100) continue;
      const color = getComputedStyle(element).color;
      if (!color || color === "rgb(0, 0, 0)") continue;
      result.push({ text, color, html: truncate(element.outerHTML, 4000) });
      if (result.length >= 800) break;
    }
    return result;
  }

  function manualSnapshot() {
    return {
      url: location.href,
      pageTitle: document.title,
      viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
      visibleText: truncate(document.body?.innerText || "", 500_000),
      fullDocumentHtml: truncate(document.documentElement.outerHTML, 4_000_000),
      coloredText: coloredTextSample(),
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "capture-manual-snapshot") {
      sendResponse({ snapshot: manualSnapshot() });
    }
  });

  new MutationObserver(scheduleScan).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "aria-hidden"],
  });

  scheduleScan();
})();
