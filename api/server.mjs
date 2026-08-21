import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const port = Number(process.env.PORT || 8080);
const dataPath = process.env.PAROLA_DATA_PATH || "/home/data/inventory.json";
const allowedOrigin = process.env.PAROLA_ALLOWED_ORIGIN || "https://guymichaely.com";
const validTypes = new Set(["noun", "verb", "adjective", "adverb"]);
const maxBodyBytes = 1024 * 1024;

const defaultNounMorphology = {
  declensionRules: [
    { name: "Singular form is the base", forms: { singular: { suffix: "" } } },
    { name: "Plural form is the base", forms: { plural: { suffix: "" } } },
    { name: "Unchanged singular / plural", forms: { singular: { suffix: "" }, plural: { suffix: "" } } },
    { name: "-o → -i", forms: { singular: { suffix: "o" }, plural: { suffix: "i" } } },
    { name: "-e → -i", forms: { singular: { suffix: "e" }, plural: { suffix: "i" } } },
    { name: "-a → -e", forms: { singular: { suffix: "a" }, plural: { suffix: "e" } } },
    { name: "-a → -i", forms: { singular: { suffix: "a" }, plural: { suffix: "i" } } },
    { name: "-ca → -che", forms: { singular: { suffix: "ca" }, plural: { suffix: "che" } } },
    { name: "-ga → -ghe", forms: { singular: { suffix: "ga" }, plural: { suffix: "ghe" } } },
    { name: "-chio → -chi", forms: { singular: { suffix: "chio" }, plural: { suffix: "chi" } } },
  ],
  inferenceSets: [
    {
      name: "Full noun answers",
      declensionRules: [
        "Singular form is the base",
        "Plural form is the base",
        "Unchanged singular / plural",
        "-o → -i",
        "-e → -i",
        "-a → -e",
        "-a → -i",
        "-ca → -che",
        "-ga → -ghe",
        "-chio → -chi",
      ],
    },
    {
      name: "Learned shorthand",
      declensionRules: ["Unchanged singular / plural", "-o → -i", "-e → -i", "-a → -e", "-a → -i", "-ca → -che", "-ga → -ghe"],
    },
  ],
  syntaxRules: [
    {
      name: "Article + singular",
      markers: [{ kind: "gender", required: false }],
      markerOrder: "any",
      fields: [{ kind: "article", definiteness: "definite", number: "singular" }, { kind: "noun", number: "singular" }],
      numberMode: "both",
      articleMode: "automatic",
      inferenceSet: "Learned shorthand",
    },
    {
      name: "Gender + singular",
      markers: [{ kind: "gender", required: true }],
      markerOrder: "any",
      fields: [{ kind: "noun", number: "singular" }],
      numberMode: "both",
      articleMode: "automatic",
      inferenceSet: "Learned shorthand",
    },
    {
      name: "Full declension",
      markers: [{ kind: "gender", required: false }],
      markerOrder: "any",
      fields: [
        { kind: "article", definiteness: "definite", number: "singular" },
        { kind: "noun", number: "singular" },
        { kind: "article", definiteness: "definite", number: "plural" },
        { kind: "noun", number: "plural" },
        { kind: "article", definiteness: "indefinite", number: "singular" },
      ],
      numberMode: "both",
      articleMode: "automatic",
      inferenceSet: "Full noun answers",
    },
    {
      name: "Singular-only noun",
      markers: [{ kind: "gender", required: false }, { kind: "tantum", required: true, value: "singular" }],
      markerOrder: "any",
      fields: [{ kind: "noun", number: "singular" }],
      numberMode: "singular",
      articleMode: "none",
      inferenceSet: "Full noun answers",
    },
    {
      name: "Singular-only article + noun",
      markers: [{ kind: "gender", required: false }, { kind: "tantum", required: true, value: "singular" }],
      markerOrder: "any",
      fields: [{ kind: "article", definiteness: "definite", number: "singular" }, { kind: "noun", number: "singular" }],
      numberMode: "singular",
      articleMode: "automatic",
      inferenceSet: "Full noun answers",
    },
    {
      name: "Plural-only noun",
      markers: [{ kind: "gender", required: false }, { kind: "tantum", required: true, value: "plural" }],
      markerOrder: "any",
      fields: [{ kind: "article", definiteness: "definite", number: "plural" }, { kind: "noun", number: "plural" }],
      numberMode: "plural",
      articleMode: "automatic",
      inferenceSet: "Full noun answers",
    },
  ],
};

let writeQueue = Promise.resolve();

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (origin !== allowedOrigin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function sendJson(res, status, value, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(value));
}

function normalizeIdentityText(value) {
  return String(value).normalize("NFC").trim().toLocaleLowerCase("it-IT").replace(/[’`]/g, "'").replace(/\s+/g, " ");
}

function cardDuplicateKey(card) {
  return `${card.type}\u0000${normalizeIdentityText(card.english)}\u0000${normalizeIdentityText(card.italian)}`;
}

function normalizeCard(value, { requireId = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Card must be an object.");
  const id = Number(value.id);
  if (requireId && (!Number.isSafeInteger(id) || id < 1)) throw new Error("Card id must be a positive integer.");
  const type = String(value.type || "");
  if (!validTypes.has(type)) throw new Error("Invalid card type.");
  const english = String(value.english || "").trim();
  const italian = String(value.italian || "").trim();
  if (!english || !italian) throw new Error("Card needs English and Italian text.");
  const details = value.details && typeof value.details === "object" && !Array.isArray(value.details)
    ? Object.fromEntries(Object.entries(value.details).map(([key, item]) => [key, String(item)]))
    : {};
  if (type === "noun") {
    const nounKeys = Object.keys(details).sort();
    const expectedKeys = ["articleMode", "base", "gender", "rule"];
    if (
      nounKeys.length !== expectedKeys.length
      || nounKeys.some((key, index) => key !== expectedKeys[index])
      || !details.rule
      || !Object.prototype.hasOwnProperty.call(details, "base")
      || !["masculine", "feminine"].includes(details.gender)
      || !["automatic", "none"].includes(details.articleMode)
    ) {
      throw new Error("Noun card does not use the current rule/base/gender/article schema.");
    }
  }
  return {
    ...(requireId ? { id } : {}),
    type,
    english,
    italian,
    setName: typeof value.setName === "string" && value.setName.trim() ? value.setName.trim() : null,
    tags: Array.isArray(value.tags) ? [...new Set(value.tags.map(String).map((tag) => tag.trim()).filter(Boolean))] : [],
    details,
  };
}

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function nonEmptyString(value, label) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`${label} must be a non-empty string.`);
  return result;
}

function normalizeTransform(value, label) {
  if (value === undefined || value === null) return null;
  const transform = objectValue(value, label);
  return { suffix: String(transform.suffix ?? "").normalize("NFC") };
}

function assertUniqueNames(values, label) {
  const names = new Set();
  for (const value of values) {
    if (names.has(value.name)) throw new Error(`Duplicate ${label} name: ${value.name}.`);
    names.add(value.name);
  }
}

function generateNounForm(rule, base, number) {
  const transform = rule.forms[number];
  if (!transform) return null;
  return `${String(base).normalize("NFC")}${transform.suffix}`;
}

function normalizeNounMorphology(value) {
  const payload = objectValue(value, "Noun morphology");
  if (!Array.isArray(payload.declensionRules) || !Array.isArray(payload.inferenceSets) || !Array.isArray(payload.syntaxRules)) {
    throw new Error("Noun morphology needs declensionRules, inferenceSets, and syntaxRules arrays.");
  }

  const declensionRules = payload.declensionRules.map((raw) => {
    const rule = objectValue(raw, "Declension rule");
    const forms = objectValue(rule.forms, "Declension rule forms");
    const singular = normalizeTransform(forms.singular, "Singular transform");
    const plural = normalizeTransform(forms.plural, "Plural transform");
    if (!singular && !plural) throw new Error("A declension rule must define at least one form.");
    return {
      name: nonEmptyString(rule.name, "Declension rule name"),
      forms: { ...(singular ? { singular } : {}), ...(plural ? { plural } : {}) },
    };
  });
  assertUniqueNames(declensionRules, "declension rule");
  const ruleNames = new Set(declensionRules.map((rule) => rule.name));

  const inferenceSets = payload.inferenceSets.map((raw) => {
    const set = objectValue(raw, "Inference set");
    if (!Array.isArray(set.declensionRules)) throw new Error("Inference set declensionRules must be an array.");
    const declensionRules = [...new Set(set.declensionRules.map((name) => nonEmptyString(name, "Inference rule name")))];
    for (const name of declensionRules) if (!ruleNames.has(name)) throw new Error(`Inference set references unknown declension rule: ${name}.`);
    return { name: nonEmptyString(set.name, "Inference set name"), declensionRules };
  });
  assertUniqueNames(inferenceSets, "inference set");
  const inferenceSetNames = new Set(inferenceSets.map((set) => set.name));

  const syntaxRules = payload.syntaxRules.map((raw) => {
    const syntax = objectValue(raw, "Syntax rule");
    if (!Array.isArray(syntax.markers) || !Array.isArray(syntax.fields)) throw new Error("Syntax rule markers and fields must be arrays.");
    const markers = syntax.markers.map((rawMarker) => {
      const marker = objectValue(rawMarker, "Syntax marker");
      if (marker.kind === "gender") return { kind: "gender", required: Boolean(marker.required) };
      if (marker.kind === "tantum" && (marker.value === "singular" || marker.value === "plural")) return { kind: "tantum", required: Boolean(marker.required), value: marker.value };
      throw new Error("Syntax marker must be a gender marker or a singular/plural tantum marker.");
    });
    if (markers.filter((marker) => marker.kind === "gender").length > 1) throw new Error("A syntax rule can contain at most one gender marker.");
    if (markers.filter((marker) => marker.kind === "tantum").length > 1) throw new Error("A syntax rule can contain at most one tantum marker.");

    const fields = syntax.fields.map((rawField) => {
      const field = objectValue(rawField, "Syntax field");
      if (field.kind === "noun" && (field.number === "singular" || field.number === "plural")) return { kind: "noun", number: field.number };
      if (field.kind === "article" && (field.number === "singular" || field.number === "plural") && (field.definiteness === "definite" || field.definiteness === "indefinite")) {
        if (field.definiteness === "indefinite" && field.number !== "singular") throw new Error("Indefinite article fields must be singular.");
        return { kind: "article", number: field.number, definiteness: field.definiteness };
      }
      throw new Error("Syntax field must be a noun form or article field.");
    });
    if (!fields.some((field) => field.kind === "noun")) throw new Error("A syntax rule must contain at least one noun field.");

    const numberMode = ["both", "singular", "plural"].includes(syntax.numberMode) ? syntax.numberMode : null;
    const articleMode = ["automatic", "none"].includes(syntax.articleMode) ? syntax.articleMode : null;
    const inferenceSet = nonEmptyString(syntax.inferenceSet, "Syntax inference set");
    if (!numberMode || !articleMode || !inferenceSetNames.has(inferenceSet)) throw new Error("Syntax rule has invalid number, article, or inference-set configuration.");
    if (articleMode === "none" && fields.some((field) => field.kind === "article")) throw new Error("A no-article syntax cannot contain article fields.");

    const name = nonEmptyString(syntax.name, "Syntax name");
    const tantum = markers.find((marker) => marker.kind === "tantum");
    if (tantum && (numberMode === "both" || tantum.value !== numberMode)) {
      throw new Error(`Noun syntax ${name} has a ${tantum.value}-only marker that conflicts with its ${numberMode} number mode.`);
    }
    if (numberMode !== "both" && fields.some((field) => field.number !== numberMode)) {
      throw new Error(`Noun syntax ${name} contains a field that conflicts with its ${numberMode} number mode.`);
    }

    return {
      name,
      markers,
      markerOrder: "any",
      fields,
      numberMode,
      articleMode,
      inferenceSet,
    };
  });
  assertUniqueNames(syntaxRules, "syntax rule");
  return { declensionRules, inferenceSets, syntaxRules };
}

function validateState(cards, nounMorphology) {
  const duplicateKeys = new Set();
  for (const card of cards) {
    const duplicateKey = cardDuplicateKey(card);
    if (duplicateKeys.has(duplicateKey)) throw new Error(`Duplicate ${card.type} card for “${card.italian}” / “${card.english}”.`);
    duplicateKeys.add(duplicateKey);
  }

  const rules = new Map(nounMorphology.declensionRules.map((rule) => [rule.name, rule]));
  for (const card of cards) {
    if (card.type !== "noun") continue;
    const rule = rules.get(card.details.rule);
    if (!rule) throw new Error(`Noun card ${card.id ?? card.english} references unknown declension rule ${card.details.rule}.`);
    const primaryNumber = rule.forms.singular ? "singular" : "plural";
    const primaryForm = generateNounForm(rule, card.details.base, primaryNumber);
    if (!primaryForm || normalizeIdentityText(card.italian) !== normalizeIdentityText(primaryForm)) {
      throw new Error(`Noun card ${card.id ?? card.english} has Italian form ${card.italian}, but its canonical morphology produces ${primaryForm ?? "no primary form"}.`);
    }
  }
}

function emptyState() {
  return {
    cards: [],
    nounMorphology: structuredClone(defaultNounMorphology),
    updatedAt: null,
  };
}

async function ensureDataDirectory() {
  await mkdir(dirname(dataPath), { recursive: true });
}

async function readState() {
  await ensureDataDirectory();
  try {
    const parsed = objectValue(JSON.parse(await readFile(dataPath, "utf8")), "Inventory state");
    if (!Array.isArray(parsed.cards)) throw new Error("Inventory state needs a cards array.");
    if (!parsed.nounMorphology) throw new Error("Inventory state needs nounMorphology.");
    const cards = parsed.cards.map((card) => normalizeCard(card, { requireId: true }));
    const nounMorphology = normalizeNounMorphology(parsed.nounMorphology);
    const updatedAt = parsed.updatedAt === null || parsed.updatedAt === undefined
      ? null
      : typeof parsed.updatedAt === "string" && Number.isFinite(Date.parse(parsed.updatedAt))
        ? parsed.updatedAt
        : (() => { throw new Error("Inventory state has an invalid updatedAt timestamp."); })();
    validateState(cards, nounMorphology);
    return { cards, nounMorphology, updatedAt };
  } catch (error) {
    if (error?.code === "ENOENT") return emptyState();
    throw error;
  }
}

async function writeAtomic(path, contents) {
  await ensureDataDirectory();
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, contents, "utf8");
  await rename(tempPath, path);
}

async function writeState(state) {
  validateState(state.cards, state.nounMorphology);
  await writeAtomic(dataPath, `${JSON.stringify(state, null, 2)}\n`);
}

function queueWrite(operation) {
  const next = writeQueue.then(operation);
  writeQueue = next.catch(() => {});
  return next;
}

function mutateCards(operation) {
  return queueWrite(async () => {
    const state = await readState();
    const result = await operation(state.cards);
    await writeState({ ...state, updatedAt: new Date().toISOString() });
    return result;
  });
}

function replaceStateIfNewer(cards, nounMorphology, updatedAt) {
  return queueWrite(async () => {
    const current = await readState();
    const incomingTime = Date.parse(updatedAt);
    const currentTime = current.updatedAt ? Date.parse(current.updatedAt) : Number.NEGATIVE_INFINITY;
    if (incomingTime < currentTime) return { conflict: true, state: current };
    if (incomingTime === currentTime) {
      const sameState = JSON.stringify(cards) === JSON.stringify(current.cards)
        && JSON.stringify(nounMorphology) === JSON.stringify(current.nounMorphology);
      return sameState ? { conflict: false, state: current } : { conflict: true, state: current };
    }
    const state = { cards, nounMorphology, updatedAt };
    await writeState(state);
    return { conflict: false, state };
  });
}

async function readJsonBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) throw new Error("Request body exceeds 1 MiB.");
    chunks.push(chunk);
  }
  if (!chunks.length) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (req, res) => {
  const cors = corsHeaders(req);
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (req.method === "OPTIONS") {
      if (req.headers.origin && req.headers.origin !== allowedOrigin) return sendJson(res, 403, { error: "Origin not allowed." });
      res.writeHead(204, cors);
      return res.end();
    }
    if (req.method === "GET" && url.pathname === "/health") return sendJson(res, 200, { ok: true });

    if (url.pathname === "/state") {
      if (req.method === "GET") return sendJson(res, 200, await readState(), cors);
      if (req.method === "PUT") {
        const body = await readJsonBody(req);
        if (!body || !Array.isArray(body.cards)) return sendJson(res, 400, { error: "PUT /state requires a cards array." }, cors);
        if (!body.nounMorphology) return sendJson(res, 400, { error: "PUT /state requires nounMorphology." }, cors);
        if (typeof body.updatedAt !== "string" || !Number.isFinite(Date.parse(body.updatedAt))) return sendJson(res, 400, { error: "PUT /state requires a valid updatedAt timestamp." }, cors);
        const cards = body.cards.map((card) => normalizeCard(card, { requireId: true }));
        const nounMorphology = normalizeNounMorphology(body.nounMorphology);
        validateState(cards, nounMorphology);
        const result = await replaceStateIfNewer(cards, nounMorphology, body.updatedAt);
        if (result.conflict) return sendJson(res, 409, { error: "Remote inventory is newer.", state: result.state }, cors);
        return sendJson(res, 200, result.state, cors);
      }
      return sendJson(res, 405, { error: "Method not allowed." }, { ...cors, allow: "GET, PUT, OPTIONS" });
    }

    if (url.pathname !== "/cards") return sendJson(res, 404, { error: "Not found." }, cors);
    if (req.method === "GET") return sendJson(res, 200, { cards: (await readState()).cards }, cors);

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const incoming = Array.isArray(body) ? body : body?.cards;
      if (!Array.isArray(incoming) || !incoming.length) return sendJson(res, 400, { error: "POST body must contain a non-empty cards array." }, cors);
      const created = await mutateCards((cards) => {
        const normalized = incoming.map((value) => normalizeCard(value));
        const keys = new Set(cards.map(cardDuplicateKey));
        for (const card of normalized) {
          const key = cardDuplicateKey(card);
          if (keys.has(key)) throw new Error(`A ${card.type} card for “${card.italian}” / “${card.english}” already exists.`);
          keys.add(key);
        }
        let nextId = cards.reduce((max, card) => Math.max(max, card.id), 0) + 1;
        const added = normalized.map((card) => ({ ...card, id: nextId++ }));
        cards.unshift(...added);
        return added;
      });
      return sendJson(res, 201, { cards: created }, cors);
    }

    if (req.method === "PUT") {
      const updatedCard = normalizeCard(await readJsonBody(req), { requireId: true });
      const result = await mutateCards((cards) => {
        const index = cards.findIndex((card) => card.id === updatedCard.id);
        if (index < 0) return null;
        cards[index] = updatedCard;
        return updatedCard;
      });
      if (!result) return sendJson(res, 404, { error: "Card not found." }, cors);
      return sendJson(res, 200, { card: result }, cors);
    }

    if (req.method === "DELETE") {
      const id = Number(url.searchParams.get("id"));
      if (!Number.isSafeInteger(id) || id < 1) return sendJson(res, 400, { error: "DELETE requires a positive integer id." }, cors);
      const deleted = await mutateCards((cards) => {
        const index = cards.findIndex((card) => card.id === id);
        if (index < 0) return false;
        cards.splice(index, 1);
        return true;
      });
      if (!deleted) return sendJson(res, 404, { error: "Card not found." }, cors);
      res.writeHead(204, cors);
      return res.end();
    }

    return sendJson(res, 405, { error: "Method not allowed." }, { ...cors, allow: "GET, POST, PUT, DELETE, OPTIONS" });
  } catch (error) {
    console.error(error);
    const message = error instanceof SyntaxError ? "Request body must be valid JSON." : error instanceof Error ? error.message : "Internal server error.";
    return sendJson(res, 400, { error: message }, cors);
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Parola API listening on port ${port}; state: ${dataPath}`);
});
