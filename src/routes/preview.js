import { PREVIEW_TYPES, TEXT_PREVIEW, MAX_TG_SIZE } from "../constants.js";
import { getOne, checkAccess } from "../kv.js";
import { tgFileUrl } from "../telegram.js";
import { htmlResp, txt, esc, fmtSize, fmtDate, extOf, tgMsgLink } from "../utils.js";
import { layout, ic, I } from "../ui.js";

export async function serveProxy(key, env) {
  const info = await getOne(key, env);
  if (!info) return txt("文件不存在", 404);

  const deny = checkAccess(info);
  if (deny) return txt(deny.msg, deny.status);

  const ids = Array.isArray(info.chunks) ? info.chunks : (info.fileId ? [info.fileId] : null);
  if (!ids || ids.length !== 1) return txt("分片文件不支持 inline 预览", 400);

  const res = await tgFileUrl(ids[0], env);
  if (!res.url) return txt(res.error || "无法获取文件地址", 502);

  const up = await fetch(res.url);
  if (!up.ok) return txt("获取失败: HTTP " + up.status, 502);

  return new Response(up.body, {
    status: up.status,
    headers: {
      "Content-Type":        up.headers.get("Content-Type") || "application/pdf",
      "Content-Disposition": "inline",
      "X-Frame-Options":     "SAMEORIGIN",
    },
  });
}

export async function pagePreview(key, env, url) {
  const info = await getOne(key, env);
  if (!info) return txt("文件不存在", 404);

  const deny = checkAccess(info);
  if (deny) return htmlResp(layout(deny.msg, "list", `<div class="page page-sm"><div style="max-width:640px;margin:0 auto">
    <div class="flash flash-err" style="margin-bottom:20px">${ic(I.lock)} <span>${esc(deny.msg)}</span></div>
    <a class="btn btn-default" href="/list">返回列表</a>
  </div></div>`), deny.status);

  const ids = Array.isArray(info.chunks) ? info.chunks : (info.fileId ? [info.fileId] : null);
  if (!ids) return htmlResp(layout("预览","list",`<div class="page"><div class="flash flash-err">${ic(I.warn)} 文件索引损坏</div></div>`));

  // Gallery siblings from list page
  const siblingsRaw = url?.searchParams?.get("siblings") || "";
  const siblings = siblingsRaw ? siblingsRaw.split(",").filter(Boolean) : [];
  const curIdx = siblings.indexOf(key);
  const prevKey = curIdx > 0 ? siblings[curIdx - 1] : null;
  const nextKey = curIdx >= 0 && curIdx < siblings.length - 1 ? siblings[curIdx + 1] : null;
  const galNav = prevKey || nextKey ? `<div class="gal-nav">
    ${prevKey ? `<a class="btn btn-default btn-sm" href="/view/${prevKey}?siblings=${siblingsRaw}" id="galPrev">${ic(I.left)} 上一张</a>` : `<span class="btn btn-default btn-sm" style="opacity:.3;cursor:default">${ic(I.left)} 上一张</span>`}
    <span class="sub" style="padding:4px 8px;font-size:.78rem">${curIdx + 1} / ${siblings.length}</span>
    ${nextKey ? `<a class="btn btn-default btn-sm" href="/view/${nextKey}?siblings=${siblingsRaw}" id="galNext">下一张 ${ic(I.right)}</a>` : `<span class="btn btn-default btn-sm" style="opacity:.3;cursor:default">下一张 ${ic(I.right)}</span>`}
  </div>` : "";

  const tgLink = tgMsgLink(info);
  const metaBar = `<div class="fh">
    <div class="fh-info">
      <div class="fh-name">${esc(info.fileName)}</div>
      <div class="fh-meta">${fmtSize(info.size)} · ${fmtDate(info.timestamp)}</div>
    </div>
    <div class="fh-actions">
      <a class="btn btn-primary btn-sm" href="/file/${esc(key)}">${ic(I.dl)} 下载</a>
      ${tgLink ? `<a class="btn btn-default btn-sm" href="${esc(tgLink)}" target="_blank">${ic(I.tg)} TG 原文</a>` : ""}
      <a class="btn btn-default btn-sm" href="/list">返回</a>
    </div>
  </div>`;

  if (ids.length > 1) {
    const ext = extOf(info.fileName);
    let preview = "";

    if (PREVIEW_TYPES.video.has(ext)) {
      const _mw = ext === "mov"
        ? `<div class="flash flash-warn" style="margin-bottom:12px;text-align:left"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg><span>MOV 格式部分编码浏览器不原生支持，如无视频画面请下载后观看</span></div>`
        : "";
      preview = _mw + `<video controls src="/sfile/${esc(key)}" style="max-width:100%;width:100%;background:#000"></video>`;
    } else if (PREVIEW_TYPES.audio.has(ext)) {
      preview = `<div style="padding:24px"><audio controls src="/sfile/${esc(key)}" style="width:100%"></audio></div>`;
    } else {
      preview = `<div style="padding:48px;text-align:center;color:var(--fg-muted)">
        ${ic(I.file, 36)}<p style="margin-top:12px">分片文件不支持在线预览</p>
        <a class="btn btn-primary" href="/file/${esc(key)}" style="margin-top:16px">${ic(I.dl)} 直接下载</a>
      </div>`;
    }

    return htmlResp(layout("预览 · " + info.fileName, "list",
      `<div class="page"><div style="max-width:960px">${metaBar}<div class="Box"><div class="preview-box">${preview}</div></div></div></div>`));
  }

  const ext   = extOf(info.fileName);
  const isOversize = (info.size || 0) > MAX_TG_SIZE;

  // Oversized single file (>20MB, webhook-indexed) — use streaming endpoint
  if (isOversize && (PREVIEW_TYPES.video.has(ext) || PREVIEW_TYPES.audio.has(ext))) {
    const preview = PREVIEW_TYPES.video.has(ext)
      ? (ext === "mov"
        ? `<div class="flash flash-warn" style="margin-bottom:12px;text-align:left"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg><span>MOV 格式部分编码浏览器不原生支持，如无视频画面请下载后观看</span></div>`
          + `<video controls src="/sfile/${esc(key)}" style="max-width:100%;width:100%;background:#000"></video>`
        : `<video controls src="/sfile/${esc(key)}" style="max-width:100%;width:100%;background:#000"></video>`)
      : `<div style="padding:24px"><audio controls src="/sfile/${esc(key)}" style="width:100%"></audio></div>`;

    return htmlResp(layout("预览 · " + info.fileName, "list",
      `<div class="page"><div style="max-width:960px">${metaBar}<div class="Box"><div class="preview-box">${preview}</div></div></div></div>`));
  }

  const tgRes = await tgFileUrl(ids[0], env);
  if (!tgRes.url) {
    const msg = "获取文件失败：" + (tgRes.error || "未知");
    return htmlResp(layout("预览","list",`<div class="page">
      <div class="flash flash-err">${ic(I.warn)} ${esc(msg)}</div>
      <div class="mt16"><a href="/list">← 返回</a></div>
    </div>`));
  }

  const dlUrl = tgRes.url;
  let preview = "";

  if      (PREVIEW_TYPES.img.has(ext))
    preview = `${galNav}<img src="${dlUrl}" alt="${esc(info.fileName)}" style="max-width:100%;display:block">
${prevKey || nextKey ? `<script>document.addEventListener('keydown',function(e){if(e.key==='ArrowLeft'){var a=document.getElementById('galPrev');if(a)a.click()}else if(e.key==='ArrowRight'){var a=document.getElementById('galNext');if(a)a.click()}});<\/script>` : ""}`;
  else if (PREVIEW_TYPES.video.has(ext)) {
    const _mw = ext === "mov"
      ? `<div class="flash flash-warn" style="margin-bottom:12px;text-align:left"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg><span>MOV 格式部分编码浏览器不原生支持，如无视频画面请下载后观看</span></div>`
      : "";
    preview = _mw + `<video controls src="${dlUrl}" style="max-width:100%;width:100%;background:#000"></video>`;
  }
  else if (PREVIEW_TYPES.audio.has(ext))
    preview = `<div style="padding:24px"><audio controls src="${dlUrl}" style="width:100%"></audio></div>`;
  else if (PREVIEW_TYPES.pdf.has(ext))
    preview = `<iframe src="/proxy/${esc(key)}" style="width:100%;height:80vh;border:none;border-radius:var(--r)"></iframe>`;
  else if (PREVIEW_TYPES.text.has(ext)) {
    const raw = await fetch(dlUrl, { headers: { Range: `bytes=0-${TEXT_PREVIEW - 1}` } })
      .then(r => r.text()).catch(() => "(读取失败)");
    const truncated = (info.size || 0) > TEXT_PREVIEW;
    preview = `<pre style="background:var(--bg-input);padding:20px;border-radius:var(--r);overflow:auto;font-family:var(--mono);font-size:.78rem;line-height:1.7;max-height:80vh;white-space:pre-wrap;word-break:break-all">${esc(raw)}</pre>`
      + (truncated ? `<p class="sub" style="padding:8px 12px;font-size:.76rem">仅显示前 100 KB · <a href="/file/${esc(key)}">下载完整文件</a></p>` : "");
  } else {
    preview = `<div style="padding:60px;text-align:center;color:var(--fg-muted)">
      ${ic(I.file, 40)}<p style="margin-top:12px">此格式不支持在线预览</p>
      <a class="btn btn-primary" href="/file/${esc(key)}" style="margin-top:16px">${ic(I.dl)} 下载</a>
    </div>`;
  }

  return htmlResp(layout("预览 · " + info.fileName, "list",
    `<div class="page"><div style="max-width:960px">${metaBar}<div class="Box"><div class="preview-box">${preview}</div></div></div></div>`));
}
