// @ts-nocheck
/**
 * TGDrive — Cloudflare Worker
 *
 * 基于 Telegram 群组的个人网盘，CF Worker 驱动
 * 文件元数据存于 CF KV，文件本体存于 Telegram。
 */

import { handleRoot, handleLogin } from "./routes/login.js";
import { pageUpload, handleChunk, handleCommit } from "./routes/upload.js";
import { pageList } from "./routes/list.js";
import { serveFile, serveChunkUrl, serveFileManifest, serveDlPage } from "./routes/download.js";
import { serveProxy, pagePreview } from "./routes/preview.js";
import { handleDelete, handleRename, handleNote, handleCleanup } from "./routes/manage.js";
import { handleWebhook } from "./routes/webhook.js";
import { pageDebug } from "./routes/debug.js";
import {
  handleCreateDir, handleRenameDir, handleDeleteDir, handleMove,
} from "./routes/folders.js";
import { handleBatchUpdate, handleBatchMove, handleListFolders } from "./routes/batch.js";
import { serveStream, serveStreamFile } from "./routes/stream.js";
import { handleShortLink } from "./routes/shortlink.js";
import { handleGenPublicUpload, handlePublicUploadPage, handlePublicUploadChunk, handlePublicUploadCommit } from "./routes/public_upload.js";
import { authed } from "./auth.js";
import { redir, txt } from "./utils.js";

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p   = url.pathname;
    const M   = req.method;
    try {
      // ── Public routes ──
      if (p === "/")                                  return handleRoot(req, env, url);
      if (p === "/login"            && M === "POST")  return handleLogin(req, env);
      if (p === "/telegram-webhook" && M === "POST")  return handleWebhook(req, env, ctx);

      if (p.startsWith("/file/")) {
        const rest  = p.slice(6);
        const slash = rest.indexOf("/");
        const bkey  = slash >= 0 ? rest.slice(0, slash) : rest;
        if (M === "HEAD") return serveFile(bkey, env, req);
        if (url.searchParams.has("dl")) return serveFile(bkey, env, req);
        return (req.headers.get("Accept") || "").includes("text/html")
          ? serveDlPage(bkey, env)
          : serveFile(bkey, env, req);
      }
      if (p.startsWith("/dl/"))            return serveDlPage(p.slice(4), env);
      if (p.startsWith("/chunk-url/"))     return serveChunkUrl(p.slice(11), env);
      if (p.startsWith("/file-manifest/")) return serveFileManifest(p.slice(15), env);
      if (p.startsWith("/proxy/"))         return serveProxy(p.slice(7), env);
      if (p.startsWith("/view/"))          return pagePreview(p.slice(6), env, url);
      if (p.startsWith("/stream/"))        return serveStream(p.slice(8), env);
      if (p.startsWith("/sfile/"))         return serveStreamFile(p.slice(7), env, req);
      if (p.startsWith("/s/"))             return handleShortLink(p.slice(3), env, req);

      // ── Public upload (token-based, no login) ──
      if (p.startsWith("/pubup/")) {
        const rest = p.slice(7);
        if (M === "GET")                                     return handlePublicUploadPage(rest, env);
        if (M === "POST" && rest.endsWith("/chunk"))         return handlePublicUploadChunk(rest, env, req);
        if (M === "POST" && rest.endsWith("/commit"))        return handlePublicUploadCommit(rest, env, req);
      }

      // ── Authenticated routes ──
      if (!(await authed(req, env))) return redir("/");
      if (p === "/upload"           && M === "GET")   return pageUpload(env, url);
      if (p === "/upload/chunk"     && M === "POST")  return handleChunk(req, env);
      if (p === "/upload/commit"    && M === "POST")  return handleCommit(req, env);
      if (p === "/list")                               return pageList(req, env, url);
      if (p === "/delete"           && M === "POST")  return handleDelete(req, env);
      if (p === "/rename"           && M === "POST")  return handleRename(req, env);
      if (p === "/note"             && M === "POST")  return handleNote(req, env);
      if (p === "/cleanup")                            return handleCleanup(env);
      if (p === "/debug")                              return pageDebug(req, env);

      // ── Folder management ──
      if (p === "/dir/create"       && M === "POST")  return handleCreateDir(req, env);
      if (p === "/dir/rename"       && M === "POST")  return handleRenameDir(req, env);
      if (p === "/dir/delete"       && M === "POST")  return handleDeleteDir(req, env);
      if (p === "/dir/move"         && M === "POST")  return handleMove(req, env);
      if (p === "/dir/list")                           return handleListFolders(req, env);

      // ── Batch operations ──
      if (p === "/batch/update"     && M === "POST")  return handleBatchUpdate(req, env);
      if (p === "/batch/move"       && M === "POST")  return handleBatchMove(req, env);

      // ── Public upload token generation ──
      if (p === "/pubup/gen"        && M === "POST")  return handleGenPublicUpload(req, env);

      return txt("404 Not Found", 404);
    } catch (e) {
      console.error(e);
      return txt("500 Internal Error: " + e.message, 500);
    }
  },
};
