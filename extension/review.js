let currentState = null;
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

function stagedItems(state = currentState) {
  return state?.staged || [];
}

function typeOptions(selected) {
  return [
    '<option value="">Choose type…</option>',
    ...Object.entries(typeLabels).map(([value, label]) =>
      `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`
    ),
  ].join("");
}

function startsWithVowel(word) {
  return /^[aeiouàèéìòóù]/iu.test(String(word || "").trim());
}

function takesLoSet(word) {
  const normalized = String(word || "").trim().toLocaleLowerCase("it-IT");
  return /^(?:z|x|y|gn|ps|pn)/u.test(normalized)
    || /^s[^aeiouàèéìòóù]/u.test(normalized)
    || /^i[aeouàèéòóù]/u.test(normalized);
}

function nounSuggestions(gender, singular) {
  const word = String(singular || "").trim();
  if (!word || !["masculine", "feminine"].includes(gender)) {
    return { plural: "", definiteSingularArticle: "", definitePluralArticle: "", indefiniteArticle: "" };
  }

  const lower = word.toLocaleLowerCase("it-IT");
  let plural = "";
  if (lower.endsWith("a")) {
    if (gender === "feminine" && lower.endsWith("ca")) plural = `${word.slice(0, -2)}che`;
    else if (gender === "feminine" && lower.endsWith("ga")) plural = `${word.slice(0, -2)}ghe`;
    else plural = `${word.slice(0, -1)}${gender === "feminine" ? "e" : "i"}`;
  } else if (lower.endsWith("o") || lower.endsWith("e")) {
    plural = `${word.slice(0, -1)}i`;
  }

  if (gender === "feminine") {
    return {
      plural,
      definiteSingularArticle: startsWithVowel(word) ? "l’" : "la",
      definitePluralArticle: "le",
      indefiniteArticle: startsWithVowel(word) ? "un’" : "una",
    };
  }
  return {
    plural,
    definiteSingularArticle: startsWithVowel(word) ? "l’" : takesLoSet(word) ? "lo" : "il",
    definitePluralArticle: startsWithVowel(plural || word) || takesLoSet(plural || word) ? "gli" : "i",
    indefiniteArticle: takesLoSet(word) ? "uno" : "un",
  };
}

function adjectiveSuggestions(masculineSingular) {
  const word = String(masculineSingular || "").trim();
  const lower = word.toLocaleLowerCase("it-IT");
  if (lower.endsWith("o")) {
    const stem = word.slice(0, -1);
    return { feminineSingular: `${stem}a`, masculinePlural: `${stem}i`, femininePlural: `${stem}e` };
  }
  if (lower.endsWith("e")) {
    const plural = `${word.slice(0, -1)}i`;
    return { feminineSingular: word, masculinePlural: plural, femininePlural: plural };
  }
  return { feminineSingular: "", masculinePlural: "", femininePlural: "" };
}

function initialDetails(type, word) {
  const cleanWord = String(word || "").trim();
  if (type === "noun") {
    return {
      gender: "",
      singular: cleanWord,
      plural: "",
      definiteSingularArticle: "",
      definitePluralArticle: "",
      indefiniteArticle: "",
    };
  }
  if (type === "verb") {
    return {
      infinitive: cleanWord,
      io: "",
      tu: "",
      luiLei: "",
      noi: "",
      voi: "",
      loro: "",
      auxiliary: "avere",
      participle: "",
    };
  }
  if (type === "adjective") {
    return { masculineSingular: cleanWord, ...adjectiveSuggestions(cleanWord) };
  }
  if (type === "adverb") return { form: cleanWord };
  return {};
}

function textField(name, label, value, placeholder = "") {
  return `<label><span>${escapeHtml(label)}</span><input data-detail="${escapeHtml(name)}" value="${escapeHtml(value || "")}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" /></label>`;
}

function selectField(name, label, value, options) {
  return `<label><span>${escapeHtml(label)}</span><select data-detail="${escapeHtml(name)}">${options.map(([optionValue, optionLabel]) =>
    `<option value="${escapeHtml(optionValue)}" ${value === optionValue ? "selected" : ""}>${escapeHtml(optionLabel)}</option>`
  ).join("")}</select></label>`;
}

function grammaticalFields(item) {
  const d = item.details || {};
  if (item.cardType === "noun") {
    return `
      <div class="grammar-heading"><strong>Noun forms</strong><span>Standard plural and articles are suggested after you choose gender; every field stays editable.</span></div>
      <div class="grammar-fields noun-fields">
        ${selectField("gender", "Gender", d.gender || "", [["", "Choose gender…"], ["masculine", "Masculine"], ["feminine", "Feminine"]])}
        ${textField("singular", "Singular", d.singular || item.word)}
        ${textField("plural", "Plural", d.plural)}
        ${textField("definiteSingularArticle", "Def. singular", d.definiteSingularArticle, "il / lo / la / l’")}
        ${textField("definitePluralArticle", "Def. plural", d.definitePluralArticle, "i / gli / le")}
        ${textField("indefiniteArticle", "Indefinite", d.indefiniteArticle, "un / uno / una / un’")}
      </div>`;
  }
  if (item.cardType === "verb") {
    return `
      <div class="grammar-heading"><strong>Verb forms</strong><span>Enter the infinitive, six present-tense forms, auxiliary, and past participle.</span></div>
      <div class="grammar-fields verb-fields">
        ${textField("infinitive", "Infinitive", d.infinitive || item.word)}
        ${textField("io", "io", d.io)}
        ${textField("tu", "tu", d.tu)}
        ${textField("luiLei", "lui / lei", d.luiLei)}
        ${textField("noi", "noi", d.noi)}
        ${textField("voi", "voi", d.voi)}
        ${textField("loro", "loro", d.loro)}
        ${selectField("auxiliary", "Auxiliary", d.auxiliary || "avere", [["avere", "avere"], ["essere", "essere"]])}
        ${textField("participle", "Participle", d.participle)}
      </div>`;
  }
  if (item.cardType === "adjective") {
    return `
      <div class="grammar-heading"><strong>Adjective forms</strong><span>Regular -o and -e forms are suggested automatically and can be corrected.</span></div>
      <div class="grammar-fields adjective-fields">
        ${textField("masculineSingular", "Masculine singular", d.masculineSingular || item.word)}
        ${textField("feminineSingular", "Feminine singular", d.feminineSingular)}
        ${textField("masculinePlural", "Masculine plural", d.masculinePlural)}
        ${textField("femininePlural", "Feminine plural", d.femininePlural)}
      </div>`;
  }
  if (item.cardType === "adverb") {
    return `
      <div class="grammar-heading"><strong>Adverb form</strong><span>Adverbs are stored as invariant.</span></div>
      <div class="grammar-fields adverb-fields">${textField("form", "Italian form", d.form || item.word)}</div>`;
  }
  return '<p class="grammar-placeholder">Choose a part of speech to review the grammatical information Parola will store.</p>';
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
        <div class="grammar-panel">${grammaticalFields(item)}</div>
        <p class="captured-context">Context: ${escapeHtml(context)}</p>
      </div>
      <div class="inline-actions staged-actions">
        <button data-action="approve" class="${approved ? "" : "primary"}">${approved ? "Unapprove" : "Approve"}</button>
        <button data-action="discard" class="danger-subtle">Discard</button>
      </div>
    </article>`;
}

function updateImportSummary() {
  const approved = stagedItems().filter((item) => item.status === "approved");
  document.getElementById("approved-summary").textContent = `${approved.length} approved`;
  document.getElementById("add-approved").disabled = approved.length === 0;
}

function render(state) {
  currentState = state;
  document.getElementById("version").textContent = state.version;

  const staged = stagedItems(state);
  const list = document.getElementById("staged-list");
  list.innerHTML = staged.length
    ? staged.map(stagedCard).join("")
    : '<div class="empty-card">No staged words are waiting for review.</div>';

  const events = state.events || [];
  const captures = events.filter((event) => event.type === "capture-staged").length;
  const errors = events.filter((event) => event.type === "error").length;
  document.getElementById("debug-summary").innerHTML = `
    <div><strong>${events.length}</strong><span>Total events</span></div>
    <div><strong>${captures}</strong><span>Captures staged</span></div>
    <div><strong>${errors}</strong><span>Errors</span></div>`;
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

function replaceSuggested(current, previousSuggestion, nextSuggestion) {
  return !String(current || "").trim() || current === previousSuggestion ? nextSuggestion : current;
}

function updateNounDetails(details, field, value) {
  const previous = nounSuggestions(details.gender, details.singular);
  const next = { ...details, [field]: value };
  if (field !== "gender" && field !== "singular") return next;
  const suggested = nounSuggestions(next.gender, next.singular);
  return {
    ...next,
    plural: replaceSuggested(details.plural, previous.plural, suggested.plural),
    definiteSingularArticle: replaceSuggested(details.definiteSingularArticle, previous.definiteSingularArticle, suggested.definiteSingularArticle),
    definitePluralArticle: replaceSuggested(details.definitePluralArticle, previous.definitePluralArticle, suggested.definitePluralArticle),
    indefiniteArticle: replaceSuggested(details.indefiniteArticle, previous.indefiniteArticle, suggested.indefiniteArticle),
  };
}

function updateAdjectiveDetails(details, field, value) {
  if (field !== "masculineSingular") return { ...details, [field]: value };
  const previous = adjectiveSuggestions(details.masculineSingular);
  const suggested = adjectiveSuggestions(value);
  return {
    ...details,
    masculineSingular: value,
    feminineSingular: replaceSuggested(details.feminineSingular, previous.feminineSingular, suggested.feminineSingular),
    masculinePlural: replaceSuggested(details.masculinePlural, previous.masculinePlural, suggested.masculinePlural),
    femininePlural: replaceSuggested(details.femininePlural, previous.femininePlural, suggested.femininePlural),
  };
}

function syncItalianWord(item, value) {
  const oldWord = String(item.word || "");
  const nextDetails = { ...(item.details || {}) };
  if (item.cardType === "noun" && (!nextDetails.singular || nextDetails.singular === oldWord)) {
    Object.assign(nextDetails, updateNounDetails(nextDetails, "singular", value));
  } else if (item.cardType === "verb" && (!nextDetails.infinitive || nextDetails.infinitive === oldWord)) {
    nextDetails.infinitive = value;
  } else if (item.cardType === "adjective" && (!nextDetails.masculineSingular || nextDetails.masculineSingular === oldWord)) {
    Object.assign(nextDetails, updateAdjectiveDetails(nextDetails, "masculineSingular", value));
  } else if (item.cardType === "adverb" && (!nextDetails.form || nextDetails.form === oldWord)) {
    nextDetails.form = value;
  }
  return nextDetails;
}

async function persistControl(control) {
  const card = control.closest("[data-id]");
  const id = card?.dataset.id;
  const item = currentState?.staged.find((candidate) => candidate.id === id);
  if (!id || !item) return false;

  if (control.dataset.detail) {
    const field = control.dataset.detail;
    const currentDetails = { ...(item.details || initialDetails(item.cardType, item.word)) };
    const details = item.cardType === "noun"
      ? updateNounDetails(currentDetails, field, control.value)
      : item.cardType === "adjective"
        ? updateAdjectiveDetails(currentDetails, field, control.value)
        : { ...currentDetails, [field]: control.value };
    item.details = details;
    await send({ type: "update-staged", id, details });
    return field === "gender" || field === "singular" || field === "masculineSingular";
  }

  const field = control.dataset.field;
  const value = control.value;
  if (field === "cardType") {
    item.cardType = value;
    item.details = initialDetails(value, item.word);
    await send({ type: "update-staged", id, cardType: value, details: item.details });
    return true;
  }
  if (field === "word") {
    const details = syncItalianWord(item, value);
    item.word = value;
    item.details = details;
    await send({ type: "update-staged", id, word: value, details });
    return true;
  }
  item[field] = value;
  await send({ type: "update-staged", id, [field]: value });
  return false;
}

document.getElementById("staged-list").addEventListener("change", async (event) => {
  const control = event.target.closest("[data-field], [data-detail]");
  if (!control) return;
  try {
    const shouldRefresh = await persistControl(control);
    setImportStatus("");
    if (shouldRefresh) await refresh();
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
    for (const item of stagedItems()) {
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
  const approved = stagedItems().filter((item) => item.status === "approved");
  if (!approved.length) return;

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
  const staged = stagedItems();
  if (!staged.length) return;
  if (!confirm(`Clear ${staged.length === 1 ? "this staged word" : "all staged words"}? Debug events will be kept.`)) return;
  await send({ type: "clear-staged" });
  await refresh();
});

document.getElementById("clear-debug-events").addEventListener("click", async () => {
  if (!confirm("Clear all debug events?")) return;
  await send({ type: "clear-debug-events" });
  await refresh();
});

document.getElementById("export-debug-events").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(currentState?.events || [], null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `parola-debug-events-${new Date().toISOString().replaceAll(":", "-")}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

void refresh().catch((error) => setImportStatus(error instanceof Error ? error.message : String(error), true));
