import { CHUNK_SIZE, DL_RETRY, MAX_TG_SIZE } from "../constants.js";
import { getOne, checkAccess } from "../kv.js";
import { txt, jsonResp, sleep } from "../utils.js";
import { tgFileUrlWithRetry, fetchWithRetry } from "../telegram.js";

/**
 * Serve a file for inline streaming with full Range/byte-range support.
 * GET /sfile/<key>
 *
 * Works for all file types — multi-chunk concatenation, oversized single (>20MB)
 * via MTProto proxy, and direct TG CDN for small single files.
 */
export async function serveStreamFile(key, env, req) {
  const info = await getOne(key, env);
  if (!info) return txt("文件不存在", 404);

  const deny = checkAccess(info);
  if (deny) return txt(deny.msg, deny.status);

  const ids = Array.isArray(info.chunks) ? info.chunks : (info.fileId ? [info.fileId] : null);
  if (!ids) return txt("文件索引损坏", 500);

  const total = info.size || 0;
  const range = req.headers.get("Range");

  const baseHdr = {
    "Content-Type":        info.mimeType || "application/octet-stream",
    "Content-Disposition": "inline",
    "Accept-Ranges":       "bytes",
    "Cache-Control":       "no-transform, private, max-age=3600",
  };

  // ── Single chunk ──
  if (ids.length === 1) {
    if (total > MAX_TG_SIZE) {
      const proxyUrl = env.MTPROXY_URL;
      if (!proxyUrl) return txt("未配置 MTProto 下载代理", 502);
      const proxyReq = await fetch(`${proxyUrl}/dl/${ids[0]}`, {
        headers: {
          "X-File-Name":    encodeURIComponent(info.fileName),
          "X-Total-Size":   String(total),
          ...(range ? { Range: range } : {}),
        },
      });
      if (!proxyReq.ok) {
        return txt("下载代理错误: " + await proxyReq.text().catch(() => "unknown"), 502);
      }
      const h = new Headers(baseHdr);
      for (const hk of ["Content-Length", "Content-Range"])
        if (proxyReq.headers.get(hk)) h.set(hk, proxyReq.headers.get(hk));
      return new Response(proxyReq.body, {
        status: range && proxyReq.status === 206 ? 206 : 200,
        headers: h,
      });
    }

    const res = await tgFileUrlWithRetry(ids[0], env);
    if (!res.url) return txt("获取下载地址失败：" + res.error, 502);
    const up = await fetchWithRetry(res.url, range);
    const h  = new Headers(baseHdr);
    for (const hk of ["Content-Length", "Content-Range"])
      if (up.headers.get(hk)) h.set(hk, up.headers.get(hk));
    return new Response(up.body, { status: range ? 206 : 200, headers: h });
  }

  // ── Multi-chunk streaming ──
  const h = new Headers(baseHdr);
  let start = 0, end = total > 0 ? total - 1 : 0, isRange = false;

  if (range && total > 0) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    if (m) {
      start = m[1] ? parseInt(m[1]) : 0;
      end   = m[2] ? parseInt(m[2]) : total - 1;
      start = Math.max(0, Math.min(start, total - 1));
      end   = Math.min(end, total - 1);
      if (start <= end) {
        isRange = true;
        h.set("Content-Range",  `bytes ${start}-${end}/${total}`);
        h.set("Content-Length", String(end - start + 1));
      }
    }
  } else if (total > 0) {
    h.set("Content-Length", String(total));
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  (async () => {
    try {
      // Helper: compute sub byte-range for chunk idx
      const chunkSub = (idx, offset = 0) => {
        const cs = idx * CHUNK_SIZE;
        const ce = total > 0 ? Math.min(cs + CHUNK_SIZE, total) - 1 : cs + CHUNK_SIZE - 1;
        if (ce < start) return null;
        if (cs > end)   return null;
        const ls = isRange ? Math.max(0, start - cs) : 0;
        const le = isRange ? Math.min(ce - cs, end - cs) : (ce - cs);
        const from = ls + offset;
        return (from > 0 || le < (ce - cs)) ? `bytes=${from}-${le}` : null;
      };

      // Resolve ALL chunk download URLs in parallel
      const urlResults = await Promise.all(ids.map(id => tgFileUrlWithRetry(id, env)));
      const urls = urlResults.map(r => r.url);
      for (let i = 0; i < urls.length; i++)
        if (!urls[i]) throw new Error(`第 ${i + 1} 片获取地址失败`);

      // Stream chunks with data prefetch (overlap next CDN fetch with current)
      let dataPromise = null;

      for (let i = 0; i < ids.length; i++) {
        const sub = chunkSub(i);
        if (sub === null && isRange) {
          const cs = i * CHUNK_SIZE;
          const ce = total > 0 ? Math.min(cs + CHUNK_SIZE, total) - 1 : cs + CHUNK_SIZE - 1;
          if (ce < start) continue;
          if (cs > end) break;
          continue;
        }
        if (sub === null) continue;

        const nextI = i + 1;
        let nextPromise = null;
        if (nextI < ids.length) {
          const nsub = chunkSub(nextI);
          if (nsub !== null) nextPromise = fetchWithRetry(urls[nextI], nsub);
        }

        // Start or reuse current chunk data fetch
        if (!dataPromise) dataPromise = fetchWithRetry(urls[i], sub);
        let resp = await dataPromise;
        dataPromise = nextPromise; // slide window

        // Stream with retries
        let bytesSent = 0;
        for (let attempt = 0; attempt < DL_RETRY; attempt++) {
          try {
            const rdr = resp.body.getReader();
            for (;;) {
              const { done, value } = await rdr.read();
              if (done) break;
              await writer.write(value);
              bytesSent += value.byteLength;
            }
            break;
          } catch (chunkErr) {
            console.warn(`[sfile] 第 ${i + 1} 片第 ${attempt + 1} 次失败：${chunkErr.message}`);
            if (attempt >= DL_RETRY - 1) throw chunkErr;
            const sub2 = chunkSub(i, bytesSent);
            resp = await fetchWithRetry(urls[i], sub2 || undefined);
            await sleep(800 * (attempt + 1));
          }
        }
      }
      await writer.close();
    } catch (e) {
      console.error("sfile error:", e);
      await writer.abort(e);
    }
  })();
  return new Response(readable, { status: isRange ? 206 : 200, headers: h });
}

/**
 * Generate an HLS m3u8 playlist with byte-range segments for inline streaming.
 * GET /stream/<key>.m3u8  or  GET /stream/<key>
 *
 * Segments reference /sfile/<key> with EXT-X-BYTERANGE for arbitrary byte ranges,
 * making it compatible with HLS players (VLC, IINA, hls.js).
 */
export async function serveStream(path, env) {
  const key = path.replace(/\.m3u8$/i, "");

  const info = await getOne(key, env);
  if (!info) return txt("文件不存在", 404);

  const deny = checkAccess(info);
  if (deny) return jsonResp({ error: deny.msg }, deny.status);

  const ids = Array.isArray(info.chunks) ? info.chunks : (info.fileId ? [info.fileId] : null);
  if (!ids || !info.size) return jsonResp({ error: "文件不支持流式播放" }, 400);

  const totalSize = info.size;
  const SEG_SIZE = 2 * 1024 * 1024;  // 2 MB segments
  const segCount = Math.ceil(totalSize / SEG_SIZE);

  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:4",
    "#EXT-X-TARGETDURATION:10",
    "#EXT-X-MEDIA-SEQUENCE:0",
  ];

  for (let i = 0; i < segCount; i++) {
    const offset = i * SEG_SIZE;
    const len   = Math.min(SEG_SIZE, totalSize - offset);
    const dur   = Math.max(2, Math.round(len / 200000));  // ~200 KB/s estimated
    lines.push(`#EXTINF:${dur},`);
    lines.push(`#EXT-X-BYTERANGE:${len}@${offset}`);
    lines.push(`/sfile/${key}`);
  }

  lines.push("#EXT-X-ENDLIST");

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "application/vnd.apple.mpegurl",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache",
    },
  });
}
