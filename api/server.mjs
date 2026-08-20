import { createServer } from "node:http";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const port = Number(process.env.PORT || 8080);
const dataPath = process.env.PAROLA_DATA_PATH || "/home/data/cards.json";
const patternsPath = `${dataPath}.noun-patterns.json`;
const metadataPath = `${dataPath}.meta.json`;
const allowedOrigin = process.env.PAROLA_ALLOWED_ORIGIN || "https://guymichaely.com";
const validTypes = new Set(["noun", "verb", "adjective", "adverb"]);
const validPatternGenders = new Set(["masculine", "feminine"]);
const validPatternSyntaxes = new Set(["full", "article-singular"]);
const maxBodyBytes = 1024 * 1024;

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
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(value));
}

function normalizeIdentityText(value) {
  return String(value).normalize("NFC").trim().toLocaleLowerCase("it-IT").replace(/\s+/g, " ");
}

function cardDuplicateKey(card) {
  return `${card.type}\u0000${normalizeIdentityText(card.english)}\u0000${normalizeIdentityText(card.italian)}`;
}

function normalizeCard(value, { requireId = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Card must be an object.");
  }

  const id = Number(value.id);
  if (requireId && (!Number.isSafeInteger(id) || id < 1)) {
    throw new Error("Card id must be a positive integer.");
  }

  const type = String(value.type || "");
  if (!validTypes.has(type)) throw new Error("Invalid card type.");

  const english = String(value.english || "").trim();
  const italian = String(value.italian || "").trim();
  if (!english || !italian) throw new Error("Card needs English and Italian text.");

  return {
    ...(requireId ? { id } : {}),
    type,
    english,
    italian,
    setName:
      typeof value.setName === "string" && value.setName.trim()
        ? value.setName.trim()
        : null,
    tags: Array.isArray(value.tags)
      ? [...new Set(value.tags.map(String).map((tag) => tag.trim()).filter(Boolean))]
      : [],
    details:
      value.details && typeof value.details === "object" && !Array.isArray(value.details)
        ? Object.fromEntries(
            Object.entries(value.details).map(([key, item]) => [key, String(item)]),
          )
        : {},
  };
}

function normalizeNounPattern(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Noun pattern must be an object.");
  }
  const pattern = {
    id: String(value.id || "").trim(),
    name: String(value.name || "").trim(),
    gender: String(value.gender || ""),
    singularSuffix: String(value.singularSuffix ?? "").normalize("NFC").trim(),
    pluralSuffix: String(value.pluralSuffix ?? "").normalize("NFC").trim(),
    syntax: String(value.syntax || ""),
  };
  if (!pattern.id || !pattern.name || !pattern.singularSuffix || !pattern.pluralSuffix) {
    throw new Error("Noun pattern needs an id, name, singular suffix, and plural suffix.");
  }
  if (!validPatternGenders.has(pattern.gender) || !validPatternSyntaxes.has(pattern.syntax)) {
    throw new Error("Noun pattern has an invalid gender or syntax.");
  }
  return pattern;
}

function normalizeNounPatterns(values) {
  if (!Array.isArray(values)) throw new Error("Noun patterns must be an array.");
  const patterns = values.map(normalizeNounPattern);
  const ids = new Set();
  for (const pattern of patterns) {
    if (ids.has(pattern.id)) throw new Error(`Duplicate noun pattern id: ${pattern.id}.`);
    ids.add(pattern.id);
  }
  return patterns;
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

async function readNounPatterns() {
  try {
    return normalizeNounPatterns(JSON.parse(await readFile(patternsPath, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
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
  const [cards, nounPatterns, updatedAt] = await Promise.all([readCards(), readNounPatterns(), readUpdatedAt()]);
  return { cards, nounPatterns, updatedAt };
}

async function writeAtomic(path, contents) {
  await ensureDataDirectory();
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, contents, "utf8");
  await rename(tempPath, path);
}

async function writeState(cards, nounPatterns, updatedAt) {
  await writeAtomic(dataPath, `${JSON.stringify(cards, null, 2)}\n`);
  if (nounPatterns !== null) {
    await writeAtomic(patternsPath, `${JSON.stringify(nounPatterns, null, 2)}\n`);
  }
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
    await writeState(state.cards, state.nounPatterns, new Date().toISOString());
    return result;
  });
}

function replaceStateIfNewer(cards, nounPatterns, updatedAt) {
  return queueWrite(async () => {
    const current = await readState();
    const incomingTime = Date.parse(updatedAt);
    const currentTime = current.updatedAt ? Date.parse(current.updatedAt) : Number.NEGATIVE_INFINITY;

    if (incomingTime < currentTime) return { conflict: true, state: current };
    if (incomingTime === currentTime) {
      const sameState = JSON.stringify(cards) === JSON.stringify(current.cards)
        && JSON.stringify(nounPatterns) === JSON.stringify(current.nounPatterns);
      return sameState
        ? { conflict: false, state: current }
        : { conflict: true, state: current };
    }

    const state = { cards, nounPatterns, updatedAt };
    await writeState(cards, nounPatterns, updatedAt);
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
      if (req.headers.origin && req.headers.origin !== allowedOrigin) {
        return sendJson(res, 403, { error: "Origin not allowed." });
      }
      res.writeHead(204, cors);
      return res.end();
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === "/state") {
      if (req.method === "GET") {
        return sendJson(res, 200, await readState(), cors);
      }

      if (req.method === "PUT") {
        const body = await readJsonBody(req);
        if (!body || !Array.isArray(body.cards)) {
          return sendJson(res, 400, { error: "PUT /state requires a cards array." }, cors);
        }
        if (!Array.isArray(body.nounPatterns)) {
          return sendJson(res, 400, { error: "PUT /state requires a nounPatterns array." }, cors);
        }
        if (typeof body.updatedAt !== "string" || !Number.isFinite(Date.parse(body.updatedAt))) {
          return sendJson(res, 400, { error: "PUT /state requires a valid updatedAt timestamp." }, cors);
        }
        const cards = body.cards.map((card) => normalizeCard(card, { requireId: true }));
        const nounPatterns = normalizeNounPatterns(body.nounPatterns);
        const result = await replaceStateIfNewer(cards, nounPatterns, body.updatedAt);
        if (result.conflict) {
          return sendJson(res, 409, { error: "Remote inventory is newer.", state: result.state }, cors);
        }
        return sendJson(res, 200, result.state, cors);
      }

      return sendJson(res, 405, { error: "Method not allowed." }, { ...cors, allow: "GET, PUT, OPTIONS" });
    }

    if (url.pathname !== "/cards") {
      return sendJson(res, 404, { error: "Not found." }, cors);
    }

    if (req.method === "GET") {
      return sendJson(res, 200, { cards: await readCards() }, cors);
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const incoming = Array.isArray(body) ? body : body?.cards;
      if (!Array.isArray(incoming) || !incoming.length) {
        return sendJson(res, 400, { error: "POST body must contain a non-empty cards array." }, cors);
      }

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
      if (!Number.isSafeInteger(id) || id < 1) {
        return sendJson(res, 400, { error: "DELETE requires a positive integer id." }, cors);
      }

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
    const message =
      error instanceof SyntaxError
        ? "Request body must be valid JSON."
        : error instanceof Error
          ? error.message
          : "Internal server error.";
    return sendJson(res, 400, { error: message }, cors);
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Parola API listening on port ${port}; data: ${dataPath}`);
});
