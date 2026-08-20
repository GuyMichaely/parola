import { createServer } from "node:http";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const port = Number(process.env.PORT || 8080);
const dataPath = process.env.PAROLA_DATA_PATH || "/home/data/cards.json";
const morphologyPath = `${dataPath}.noun-morphology.json`;
const metadataPath = `${dataPath}.meta.json`;
const allowedOrigin = process.env.PAROLA_ALLOWED_ORIGIN || "https://guymichaely.com";
const validTypes = new Set(["noun", "verb", "adjective", "adverb"]);
const maxBodyBytes = 1024 * 1024;

const defaultNounMorphology = {
  declensionRules: [
    { id: "identity", name: "Unchanged form", forms: { singular: { suffix: "" }, plural: { suffix: "" } } },
    { id: "o-i", name: "-o → -i", forms: { singular: { suffix: "o" }, plural: { suffix: "i" } } },
    { id: "e-i", name: "-e → -i", forms: { singular: { suffix: "e" }, plural: { suffix: "i" } } },
    { id: "a-e", name: "-a → -e", forms: { singular: { suffix: "a" }, plural: { suffix: "e" } } },
    { id: "a-i", name: "-a → -i", forms: { singular: { suffix: "a" }, plural: { suffix: "i" } } },
    { id: "ca-che", name: "-ca → -che", forms: { singular: { suffix: "ca" }, plural: { suffix: "che" } } },
    { id: "ga-ghe", name: "-ga → -ghe", forms: { singular: { suffix: "ga" }, plural: { suffix: "ghe" } } },
    { id: "chio-chi", name: "-chio → -chi", forms: { singular: { suffix: "chio" }, plural: { suffix: "chi" } } },
  ],
  inferenceSets: [
    { id: "full-noun", name: "Full noun answers", declensionRuleIds: ["identity", "o-i", "e-i", "a-e", "a-i", "ca-che", "ga-ghe", "chio-chi"] },
    { id: "learned-shorthand", name: "Learned shorthand", declensionRuleIds: ["o-i", "e-i", "a-e", "a-i", "ca-che", "ga-ghe"] },
  ],
  syntaxRules: [
    {
      id: "article-singular",
      name: "Article + singular",
      markers: [{ kind: "gender", required: false }],
      markerOrder: "any",
      fields: [{ kind: "article", definiteness: "definite", number: "singular" }, { kind: "noun", number: "singular" }],
      numberMode: "both",
      articleMode: "automatic",
      inferenceSetId: "learned-shorthand",
    },
    {
      id: "full-declension",
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
      inferenceSetId: "full-noun",
    },
    {
      id: "singular-tantum",
      name: "Singular-only noun",
      markers: [{ kind: "gender", required: false }, { kind: "tantum", required: true, value: "singular" }],
      markerOrder: "any",
      fields: [{ kind: "noun", number: "singular" }],
      numberMode: "singular",
      articleMode: "none",
      inferenceSetId: "full-noun",
    },
    {
      id: "singular-tantum-article",
      name: "Singular-only article + noun",
      markers: [{ kind: "gender", required: false }, { kind: "tantum", required: true, value: "singular" }],
      markerOrder: "any",
      fields: [{ kind: "article", definiteness: "definite", number: "singular" }, { kind: "noun", number: "singular" }],
      numberMode: "singular",
      articleMode: "automatic",
      inferenceSetId: "full-noun",
    },
    {
      id: "plural-tantum",
      name: "Plural-only noun",
      markers: [{ kind: "gender", required: false }, { kind: "tantum", required: true, value: "plural" }],
      markerOrder: "any",
      fields: [{ kind: "article", definiteness: "definite", number: "plural" }, { kind: "noun", number: "plural" }],
      numberMode: "plural",
      articleMode: "automatic",
      inferenceSetId: "full-noun",
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
  return String(value).normalize("NFC").trim().toLocaleLowerCase("it-IT").replace(/\s+/g, " ");
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
    if (
      !details.ruleId
      || !Object.prototype.hasOwnProperty.call(details, "base")
      || !["masculine", "feminine"].includes(details.gender)
      || !["both", "singular", "plural"].includes(details.numberMode)
      || !["automatic", "none"].includes(details.articleMode)
    ) {
      throw new Error("Noun card does not use the current base/rule noun schema.");
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

function normalizeNounMorphology(value) {
  const payload = objectValue(value, "Noun morphology");
  if (!Array.isArray(payload.declensionRules) || !Array.isArray(payload.inferenceSets) || !Array.isArray(payload.syntaxRules)) {
    throw new Error("Noun morphology needs declensionRules, inferenceSets, and syntaxRules arrays.");
  }

  const declensionRules = payload.declensionRules.map((raw) => {
    const rule = objectValue(raw, "Declension rule");
    const forms = objectValue(rule.forms, "Declension rule forms");
    const singular = objectValue(forms.singular, "Singular transform");
    const plural = objectValue(forms.plural, "Plural transform");
    return {
      id: nonEmptyString(rule.id, "Declension rule id"),
      name: nonEmptyString(rule.name, "Declension rule name"),
      forms: {
        singular: { suffix: String(singular.suffix ?? "").normalize("NFC") },
        plural: { suffix: String(plural.suffix ?? "").normalize("NFC") },
      },
    };
  });
  const ruleIds = new Set();
  for (const rule of declensionRules) {
    if (ruleIds.has(rule.id)) throw new Error(`Duplicate declension rule id: ${rule.id}.`);
    ruleIds.add(rule.id);
  }

  const inferenceSets = payload.inferenceSets.map((raw) => {
    const set = objectValue(raw, "Inference set");
    if (!Array.isArray(set.declensionRuleIds)) throw new Error("Inference set declensionRuleIds must be an array.");
    const declensionRuleIds = [...new Set(set.declensionRuleIds.map((id) => nonEmptyString(id, "Inference rule id")))];
    for (const id of declensionRuleIds) if (!ruleIds.has(id)) throw new Error(`Inference set references unknown declension rule: ${id}.`);
    return { id: nonEmptyString(set.id, "Inference set id"), name: nonEmptyString(set.name, "Inference set name"), declensionRuleIds };
  });
  const inferenceSetIds = new Set();
  for (const set of inferenceSets) {
    if (inferenceSetIds.has(set.id)) throw new Error(`Duplicate inference set id: ${set.id}.`);
    inferenceSetIds.add(set.id);
  }

  const syntaxRules = payload.syntaxRules.map((raw) => {
    const syntax = objectValue(raw, "Syntax rule");
    if (!Array.isArray(syntax.markers) || !Array.isArray(syntax.fields)) throw new Error("Syntax rule markers and fields must be arrays.");
    const markers = syntax.markers.map((rawMarker) => {
      const marker = objectValue(rawMarker, "Syntax marker");
      if (marker.kind === "gender") return { kind: "gender", required: Boolean(marker.required) };
      if (marker.kind === "tantum" && (marker.value === "singular" || marker.value === "plural")) return { kind: "tantum", required: Boolean(marker.required), value: marker.value };
      throw new Error("Invalid noun syntax marker.");
    });
    const fields = syntax.fields.map((rawField) => {
      const field = objectValue(rawField, "Syntax field");
      if (field.kind === "noun" && (field.number === "singular" || field.number === "plural")) return { kind: "noun", number: field.number };
      if (field.kind === "article" && (field.number === "singular" || field.number === "plural") && (field.definiteness === "definite" || field.definiteness === "indefinite")) {
        return { kind: "article", number: field.number, definiteness: field.definiteness };
      }
      throw new Error("Invalid noun syntax field.");
    });
    if (!["both", "singular", "plural"].includes(syntax.numberMode) || !["automatic", "none"].includes(syntax.articleMode)) throw new Error("Invalid noun syntax mode.");
    const inferenceSetId = nonEmptyString(syntax.inferenceSetId, "Syntax inferenceSetId");
    if (!inferenceSetIds.has(inferenceSetId)) throw new Error(`Syntax references unknown inference set: ${inferenceSetId}.`);
    return {
      id: nonEmptyString(syntax.id, "Syntax id"),
      name: nonEmptyString(syntax.name, "Syntax name"),
      markers,
      markerOrder: "any",
      fields,
      numberMode: syntax.numberMode,
      articleMode: syntax.articleMode,
      inferenceSetId,
    };
  });
  const syntaxIds = new Set();
  for (const syntax of syntaxRules) {
    if (syntaxIds.has(syntax.id)) throw new Error(`Duplicate syntax rule id: ${syntax.id}.`);
    syntaxIds.add(syntax.id);
  }
  return { declensionRules, inferenceSets, syntaxRules };
}

function validateNounAssignments(cards, nounMorphology) {
  const ruleIds = new Set(nounMorphology.declensionRules.map((rule) => rule.id));
  for (const card of cards) {
    if (card.type === "noun" && !ruleIds.has(card.details.ruleId)) {
      throw new Error(`Noun card ${card.id ?? card.english} references unknown declension rule ${card.details.ruleId}.`);
    }
  }
}

async function ensureDataDirectory() {
  await mkdir(dirname(dataPath), { recursive: true });
}

async function readCards() {
  await ensureDataDirectory();
  try {
    const parsed = JSON.parse(await readFile(dataPath, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("Card store is not an array.");
    return parsed.map((card) => normalizeCard(card, { requireId: true }));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function readNounMorphology() {
  try {
    return normalizeNounMorphology(JSON.parse(await readFile(morphologyPath, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return structuredClone(defaultNounMorphology);
    throw error;
  }
}

async function readUpdatedAt() {
  try {
    const parsed = JSON.parse(await readFile(metadataPath, "utf8"));
    const updatedAt = typeof parsed?.updatedAt === "string" ? parsed.updatedAt : "";
    if (!updatedAt || !Number.isFinite(Date.parse(updatedAt))) throw new Error("Invalid sync metadata.");
    return updatedAt;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    try {
      const info = await stat(dataPath);
      return info.mtime.toISOString();
    } catch (statError) {
      if (statError?.code === "ENOENT") return null;
      throw statError;
    }
  }
}

async function readState() {
  const [cards, nounMorphology, updatedAt] = await Promise.all([readCards(), readNounMorphology(), readUpdatedAt()]);
  validateNounAssignments(cards, nounMorphology);
  return { cards, nounMorphology, updatedAt };
}

async function writeAtomic(path, contents) {
  await ensureDataDirectory();
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, contents, "utf8");
  await rename(tempPath, path);
}

async function writeState(cards, nounMorphology, updatedAt) {
  validateNounAssignments(cards, nounMorphology);
  await writeAtomic(dataPath, `${JSON.stringify(cards, null, 2)}\n`);
  await writeAtomic(morphologyPath, `${JSON.stringify(nounMorphology, null, 2)}\n`);
  await writeAtomic(metadataPath, `${JSON.stringify({ updatedAt }, null, 2)}\n`);
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
    await writeState(state.cards, state.nounMorphology, new Date().toISOString());
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
    await writeState(cards, nounMorphology, updatedAt);
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
        validateNounAssignments(cards, nounMorphology);
        const result = await replaceStateIfNewer(cards, nounMorphology, body.updatedAt);
        if (result.conflict) return sendJson(res, 409, { error: "Remote inventory is newer.", state: result.state }, cors);
        return sendJson(res, 200, result.state, cors);
      }
      return sendJson(res, 405, { error: "Method not allowed." }, { ...cors, allow: "GET, PUT, OPTIONS" });
    }

    if (url.pathname !== "/cards") return sendJson(res, 404, { error: "Not found." }, cors);
    if (req.method === "GET") return sendJson(res, 200, { cards: await readCards() }, cors);

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
  console.log(`Parola API listening on port ${port}; data: ${dataPath}`);
});
