import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const port = Number(process.env.PORT || 8080);
const dataPath = process.env.PAROLA_DATA_PATH || "/home/data/cards.json";
const allowedOrigin = process.env.PAROLA_ALLOWED_ORIGIN || "https://guymichaely.com";
const validTypes = new Set(["noun", "verb", "adjective", "adverb"]);
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

async function writeCards(cards) {
  await ensureDataDirectory();
  const tempPath = `${dataPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(cards, null, 2)}\n`, "utf8");
  await rename(tempPath, dataPath);
}

function mutateCards(operation) {
  const next = writeQueue.then(async () => {
    const cards = await readCards();
    const result = await operation(cards);
    await writeCards(cards);
    return result;
  });
  writeQueue = next.catch(() => {});
  return next;
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
        return sendJson(
          res,
          400,
          { error: "POST body must contain a non-empty cards array." },
          cors,
        );
      }

      const created = await mutateCards((cards) => {
        let nextId = cards.reduce((max, card) => Math.max(max, card.id), 0) + 1;
        const added = incoming.map((value) => ({ ...normalizeCard(value), id: nextId++ }));
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

    return sendJson(
      res,
      405,
      { error: "Method not allowed." },
      { ...cors, allow: "GET, POST, PUT, DELETE, OPTIONS" },
    );
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
