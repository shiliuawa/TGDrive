#!/usr/bin/env node
/**
 * TGDrive MTProto Proxy
 *
 * Standalone HTTP server that uses gramJS (MTProto) to download files
 * from Telegram at any size — bypasses Bot API 20MB limit.
 *
 * Usage:
 *   API_ID=27900871 API_HASH=4f771cb97806ce68bf84741e1208599d \
 *     BOT_TOKEN=<token> node tg-mtproto-proxy.js
 *
 * Endpoints:
 *   GET /dl/:fileId   — Stream file by Bot API file_id (pass X-File-Name header)
 *   GET /health       — Health check
 */

const http = require("http");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { Api } = require("telegram/tl");
const { FileId } = require("@tgsnake/fileid");
const BigInteger = require("big-integer");

const API_ID = parseInt(process.env.API_ID || "0", 10);
const API_HASH = process.env.API_HASH || "";
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const PORT = parseInt(process.env.PORT || "4317", 10);
const SESSION_FILE = process.env.SESSION_FILE || "./gram-session.json";

if (!API_ID || !API_HASH || !BOT_TOKEN) {
  console.error("Usage: API_ID=xxx API_HASH=xxx BOT_TOKEN=xxx node tg-mtproto-proxy.js");
  process.exit(1);
}

let client = null;

async function getClient() {
  if (client && client.connected) return client;

  let sessionStr = "";
  try { sessionStr = JSON.parse(require("fs").readFileSync(SESSION_FILE, "utf8")).session || ""; } catch {}

  const session = new StringSession(sessionStr);
  client = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 5,
    useWSS: true,
  });

  await client.start({ botAuthToken: BOT_TOKEN });
  console.log("[proxy] MTProto connected. DC:", client.session.dcId);

  try {
    require("fs").writeFileSync(SESSION_FILE, JSON.stringify({ session: client.session.save() }), "utf8");
  } catch {}

  return client;
}

async function handleDownload(req, res) {
  const fileId = req.url.split("/dl/")[1];
  if (!fileId) {
    res.writeHead(400); res.end("Missing fileId");
    return;
  }

  let decoded;
  try {
    decoded = FileId.decodeFileId(fileId);
  } catch (e) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Invalid file_id: " + e.message);
    return;
  }

  const fileName = decodeURIComponent(req.headers["x-file-name"] || "download");
  const totalSize = parseInt(req.headers["x-total-size"] || "0", 10);

  try {
    const cl = await getClient();

    const location = new Api.InputDocumentFileLocation({
      id: BigInt(decoded.id),
      accessHash: BigInt(decoded.accessHash),
      fileReference: Buffer.from(decoded.fileReference),
      thumbSize: "",
    });

    // ── Parse Range header ──
    const rangeHdr = req.headers["range"];
    let offset = 0, limit = undefined, isRange = false;
    if (rangeHdr) {
      const m = rangeHdr.match(/bytes=(\d+)-(\d*)/);
      if (m) {
        offset = parseInt(m[1], 10);
        if (m[2]) limit = parseInt(m[2], 10) - offset + 1;
        isRange = true;
      }
    }

    const contentLen = isRange
      ? (limit || totalSize - offset)
      : totalSize;

    res.writeHead(isRange ? 206 : 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      ...(contentLen > 0 ? { "Content-Length": String(contentLen) } : {}),
      ...(isRange && totalSize > 0 ? { "Content-Range": `bytes ${offset}-${offset + contentLen - 1}/${totalSize}` } : {}),
      "Cache-Control": "no-transform",
      "Accept-Ranges": "bytes",
    });

    let total = 0;
    const iter = cl.iterDownload({
      file: location,
      dcId: decoded.dcId,
      offset: BigInteger(offset),
      limit,
      chunkSize: 1024 * 1024,
      fileSize: totalSize > 0 ? BigInteger(totalSize) : undefined,
      requestSize: 1024 * 1024,
    });

    for await (const chunk of iter) {
      if (chunk instanceof Buffer ? chunk.length : chunk.byteLength > 0) {
        res.write(chunk);
        total += chunk.length || chunk.byteLength;
      }
    }

    res.end();
    console.log("[proxy] Complete:", (total / 1024 / 1024).toFixed(1), "MB -", fileName);
  } catch (e) {
    console.error("[proxy] Error:", e.message);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
    }
    try { res.end("Proxy error: " + e.message); } catch {}
  }
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, connected: client?.connected || false }));
    return;
  }

  if (req.url.startsWith("/dl/")) {
    handleDownload(req, res);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`[proxy] TGDrive MTProto proxy listening on :${PORT}`);
});
