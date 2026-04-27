import { CHUNK_SIZE, DL_RETRY, DL_CONCURRENCY, PARALLEL_DL_MAX, MAX_TG_SIZE } from "../constants.js";
import { getOne, incDownloads, checkAccess } from "../kv.js";
import { tgFileUrlWithRetry, fetchWithRetry } from "../telegram.js";
import { htmlResp, jsonResp, txt, esc, fmtSize, fmtDate, sleep } from "../utils.js";
import { layout, ic, I } from "../ui.js";

export async function serveFile(key, env, req) {
  const info = await getOne(key, env);
  if (!info) return jsonResp({ error: "文件不存在" }, 404);

  const deny = checkAccess(info);
  if (deny) return txt(deny.msg, deny.status);

  const ids = Array.isArray(info.chunks) ? info.chunks : (info.fileId ? [info.fileId] : null);
  if (!ids) return jsonResp({ error: "文件索引损坏" }, 500);

  incDownloads(key, env);

  const total   = info.size || 0;
  const range   = req.headers.get("Range");
  const etag    = `"${key}"`;
  const dispHdr = `attachment; filename="${encodeURIComponent(info.fileName)}"; filename*=UTF-8''${encodeURIComponent(info.fileName)}`;
  const baseHdr = {
    "Content-Type":        info.mimeType || "application/octet-stream",
    "Content-Disposition": dispHdr,
    "Accept-Ranges":       "bytes",
    "Cache-Control":       "no-transform, private, max-age=3600",
    "ETag":                etag,
    "CF-No-Transform":     "1",
  };

  if (req.headers.get("If-None-Match") === etag)
    return new Response(null, { status: 304 });

  // ── Single chunk ──
  if (ids.length === 1) {
    // Oversized single file (>20MB, webhook-indexed) → skip getFile, proxy via MTProto
    if (total > MAX_TG_SIZE) {
      const proxyUrl = env.MTPROXY_URL;
      if (!proxyUrl) {
        return txt("文件过大（超过 20MB），未配置 MTProto 下载代理", 502);
      }
      const proxyReq = await fetch(`${proxyUrl}/dl/${ids[0]}`, {
        headers: {
          "X-File-Name":    encodeURIComponent(info.fileName),
          "X-Total-Size":   String(total),
          ...(range ? { Range: range } : {}),
        },
      });
      if (!proxyReq.ok) {
        const err = await proxyReq.text().catch(() => "unknown");
        return txt("下载代理错误: " + err, 502);
      }
      const h = new Headers(baseHdr);
      for (const hk of ["Content-Length", "Content-Range", "Content-Disposition"])
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
      for (let i = 0; i < ids.length; i++) {
        const cs = i * CHUNK_SIZE;
        const ce = total > 0 ? Math.min(cs + CHUNK_SIZE, total) - 1 : cs + CHUNK_SIZE - 1;

        if (isRange) {
          if (ce < start) continue;
          if (cs > end)   break;
        }

        const localStart = isRange ? Math.max(0, start - cs) : 0;
        const localEnd   = isRange ? Math.min(ce - cs, end - cs) : (ce - cs);

        let bytesSent = 0;
        for (let attempt = 0; attempt < DL_RETRY; attempt++) {
          try {
            const resumeFrom = localStart + bytesSent;
            const sub = (resumeFrom > 0 || localEnd < (ce - cs))
              ? `bytes=${resumeFrom}-${localEnd}`
              : null;

            const res = await tgFileUrlWithRetry(ids[i], env);
            if (!res.url) throw new Error(`第 ${i + 1} 片 URL 解析失败：${res.error || "未知"}`);

            const up  = await fetchWithRetry(res.url, sub);
            const rdr = up.body.getReader();
            for (;;) {
              const { done, value } = await rdr.read();
              if (done) break;
              await writer.write(value);
              bytesSent += value.byteLength;
            }
            break;
          } catch (chunkErr) {
            console.warn(`[stream] 第 ${i + 1} 片第 ${attempt + 1} 次失败：${chunkErr.message}，已传 ${bytesSent} 字节`);
            if (attempt >= DL_RETRY - 1) throw chunkErr;
            await sleep(800 * (attempt + 1));
          }
        }
      }
      await writer.close();
    } catch (e) {
      console.error("stream error:", e);
      await writer.abort(e);
    }
  })();

  return new Response(readable, { status: isRange ? 206 : 200, headers: h });
}

export async function serveChunkUrl(path, env) {
  const slash = path.indexOf("/");
  const key   = slash >= 0 ? path.slice(0, slash) : path;
  const idx   = slash >= 0 ? parseInt(path.slice(slash + 1)) : 0;

  const info = await getOne(key, env);
  if (!info) return txt("文件不存在", 404);

  const deny = checkAccess(info);
  if (deny) return txt(deny.msg, deny.status);

  const ids = Array.isArray(info.chunks) ? info.chunks : (info.fileId ? [info.fileId] : null);
  if (!ids || isNaN(idx) || idx >= ids.length) return txt("片索引超范围", 404);

  const res = await tgFileUrlWithRetry(ids[idx], env);
  if (!res.url) return txt("获取下载地址失败: " + (res.error || "未知"), 502);

  const tgResp = await fetch(res.url);
  if (!tgResp.ok) return txt("TG 请求失败: HTTP " + tgResp.status, 502);

  const isLast    = idx === ids.length - 1;
  const chunkName = ids.length > 1
    ? `${info.fileName}.part${String(idx + 1).padStart(3, "0")}`
    : info.fileName;

  return new Response(tgResp.body, {
    headers: {
      "Content-Type":              tgResp.headers.get("Content-Type") || info.mimeType || "application/octet-stream",
      "Content-Disposition":       `attachment; filename*=UTF-8''${encodeURIComponent(chunkName)}`,
      "Content-Length":            tgResp.headers.get("Content-Length") || "",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control":             "no-store",
    },
  });
}

export async function serveFileManifest(key, env) {
  const info = await getOne(key, env);
  if (!info) return jsonResp({ error: "文件不存在" }, 404);

  const deny = checkAccess(info);
  if (deny) return jsonResp({ error: deny.msg }, deny.status);

  const ids = Array.isArray(info.chunks) ? info.chunks : (info.fileId ? [info.fileId] : null);
  if (!ids) return jsonResp({ error: "索引损坏" }, 500);

  return jsonResp({
    key,
    fileName:   info.fileName,
    mimeType:   info.mimeType || "application/octet-stream",
    size:       info.size    || 0,
    chunkCount: ids.length,
    expires:    info.expires || null,
    maxDl:      info.maxDl   ?? null,
    downloads:  info.downloads || 0,
    encrypted:  !!info.encSalt,
    encSalt:    info.encSalt || null,
    encIVs:     info.encIVs  || null,
  });
}

export async function serveDlPage(key, env) {
  const info = await getOne(key, env);
  if (!info) return txt("文件不存在", 404);

  const deny = checkAccess(info);
  if (deny) return htmlResp(layout(deny.msg, "", `<div class="page sm"><div class="Box" style="padding:40px;text-align:center">
    <p style="font-size:2rem;margin-bottom:12px">🔒</p>
    <p style="font-weight:600">${esc(deny.msg)}</p>
  </div></div>`), deny.status);

  const ids = Array.isArray(info.chunks) ? info.chunks : (info.fileId ? [info.fileId] : null);
  if (!ids) return txt("文件索引损坏", 500);

  const chunkCount = ids.length;
  const isLarge    = (info.size || 0) > PARALLEL_DL_MAX;

  // ── Oversized single-file (indexed via webhook, >20MB) ──
  const isOversize    = !info.chunks && info.fileId && (info.size || 0) > MAX_TG_SIZE;
  const hasMtproxy    = !!env.MTPROXY_URL;
  const tgLink        = info.msgId && info.fromChat
    ? `https://t.me/c/${String(info.fromChat).replace(/^-100/, "")}/${info.msgId}`
    : null;

  const expiresStr = info.expires ? `⏱ 有效期至：${fmtDate(info.expires)}` : "";
  const maxDlStr   = info.maxDl   ? `📊 限 ${info.maxDl} 次下载（已下载 ${info.downloads || 0} 次）` : "";
  const isEnc      = !!info.encSalt;

  const body = `<div class="page sm">
    <div class="Box" style="padding:32px;text-align:center">
      <div style="margin-bottom:16px;opacity:.6">${ic(I.dl, 44)}</div>
      <h1 class="mono" style="font-size:.9rem;font-weight:600;word-break:break-all;margin-bottom:8px">${esc(info.fileName)}</h1>
      <p class="sub" style="font-size:.8rem;margin-bottom:4px">${fmtSize(info.size)}${chunkCount > 1 ? ` · ${chunkCount} 片` : ""}${isEnc ? " · 🔒 已加密" : ""}</p>
      ${expiresStr ? `<p class="sub" style="font-size:.74rem;margin-bottom:2px">${esc(expiresStr)}</p>` : ""}
      ${maxDlStr   ? `<p class="sub" style="font-size:.74rem;margin-bottom:0">${esc(maxDlStr)}</p>`   : ""}
      <div style="height:1px;background:var(--bd);margin:20px 0"></div>

      <div id="dl-area">
        ${isOversize ? `
          <div class="flash flash-warn" style="margin-bottom:16px;text-align:left">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span>文件较大（超过 20MB）${hasMtproxy ? "，服务器将从 Telegram 分片流式传输，大文件建议使用 Chrome/Edge。" : "，当前未配置下载代理，无法直接下载。"}</span>
          </div>
          ${hasMtproxy ? `
          <button class="btn btn-primary btn-lg" id="dlbtn" onclick="startOversizeDl()" style="width:100%;justify-content:center;font-size:.95rem;padding:11px">
            ${ic(I.dl)} 下载文件
          </button>
          <button class="btn btn-default btn-lg" id="cplink" onclick="copyLink()" style="width:100%;justify-content:center;font-size:.85rem;padding:8px;margin-top:6px">${ic(I.copy)} 复制下载链接</button>` : `
          <div class="flash flash-err" style="margin-bottom:16px;text-align:left">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0">
              <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            <span>暂不支持直接下载，请使用 Telegram 客户端下载。</span>
          </div>`}
          ${tgLink ? `<a class="btn btn-default btn-lg" href="${esc(tgLink)}" target="_blank" style="width:100%;justify-content:center;font-size:.85rem;padding:8px;margin-top:8px">${ic(I.tg)} Telegram 备用</a>` : ""}
        ` : `
          <button class="btn btn-primary btn-lg" id="dlbtn" onclick="startDl()" style="width:100%;justify-content:center;font-size:.95rem;padding:11px">
            ${ic(I.dl)} 下载文件
          </button>
          <button class="btn btn-default btn-lg" id="cplink" onclick="copyLink()" style="width:100%;justify-content:center;font-size:.85rem;padding:8px;margin-top:6px">${ic(I.copy)} 复制下载链接</button>
        `}
        ${isLarge && !isOversize ? `<p class="sub" style="font-size:.72rem;margin-top:10px">大文件建议使用 Chrome / Edge 以获得最佳体验</p>` : ""}
      </div>

      <div id="dl-prog" style="display:none;margin-top:18px">
        <div class="pbar-wrap" style="margin-bottom:8px"><div class="pbar" id="dlpb"></div></div>
        <p class="sub" id="dlpt" style="font-size:.78rem"></p>
      </div>
      <div id="dl-done" style="display:none;margin-top:16px">
        <div class="flash flash-ok">${ic(I.ok)}<span>下载完成！</span></div>
      </div>
      <div id="dl-err" style="display:none;margin-top:16px"></div>
    </div>
  </div>`;

  const encVars = isEnc
    ? `,ENC_SALT=${JSON.stringify(info.encSalt)},ENC_IVS=${JSON.stringify(info.encIVs || [])}`
    : "";
  const encJs = isEnc ? `
const CR_IT=1e5;let _pw="";
function b2ab(b){b=(b+"===").slice(0,(b.length+3)&~3).replace(/-/g,"+").replace(/_/g,"/");return Uint8Array.from(atob(b),c=>c.charCodeAt(0)).buffer;}
async function dk(p,s){return crypto.subtle.deriveKey({name:"PBKDF2",salt:new Uint8Array(b2ab(s)),iterations:CR_IT,hash:"SHA-256"},await crypto.subtle.importKey("raw",new TextEncoder().encode(p),"PBKDF2",false,["deriveKey"]),{name:"AES-GCM",length:256},false,["decrypt"]);}
async function dec(b,i){const k=await dk(_pw,ENC_SALT);return crypto.subtle.decrypt({name:"AES-GCM",iv:new Uint8Array(b2ab(ENC_IVS[i]))},k,b);}
function promptPw(){_pw=prompt("🔒 此文件已加密\\n请输入加密密码：");return !!_pw;}
` : "";

  const encGuard = isEnc ? "if(!_pw&&!promptPw()){$('dlbtn').disabled=false;return;}" : "";
  const decryptChunk = isEnc ? `try{buf=await dec(buf,done);}catch(e){throw new Error('解密失败，密码错误或文件损坏');}` : "";

  const script = isOversize ? `<script>
const KEY=${JSON.stringify(key)},FNAME=${JSON.stringify(info.fileName)};
const $=id=>document.getElementById(id);
function startOversizeDl(){
  $('dlbtn').disabled=true;
  $('dl-prog').style.display='block';
  setPct(0,'准备下载...');
  const a=document.createElement('a');
  a.href='/file/'+KEY+'/'+encodeURIComponent(FNAME)+'?dl';
  a.download=FNAME;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{a.remove();setPct(100,'下载中，请查看浏览器下载任务...');},1000);
}
function setPct(p,m){const pb=document.getElementById('dlpb');const pt=document.getElementById('dlpt');if(pb)pb.style.width=p+'%';if(pt)pt.textContent=m;}
function copyLink(){
  const u=location.origin+'/file/'+KEY+'/'+encodeURIComponent(FNAME)+'?dl';
  navigator.clipboard.writeText(u).then(()=>{
    const b=$('cplink');b.textContent='已复制';setTimeout(()=>{b.textContent='复制下载链接';},2000);
  });
}
</script>` : `<script>
const KEY=${JSON.stringify(key)},FNAME=${JSON.stringify(info.fileName)},
      MIME=${JSON.stringify(info.mimeType||"application/octet-stream")},
      SIZE=${info.size||0},CHUNKS=${chunkCount},
      PLIMIT=${PARALLEL_DL_MAX},CONC=${DL_CONCURRENCY}${encVars};
const $=id=>document.getElementById(id);
const sz=b=>!b?'-':b<1024?b+' B':b<1048576?(b/1024).toFixed(1)+' KB':b<1073741824?(b/1048576).toFixed(2)+' MB':(b/1073741824).toFixed(2)+' GB';
function setPct(p,m){$('dlpb').style.width=p+'%';$('dlpt').textContent=m;}
function showErr(m){$('dl-err').innerHTML='<div class=\"alert alert-err\"><svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z\"/><line x1=\"12\" y1=\"9\" x2=\"12\" y2=\"13\"/><line x1=\"12\" y1=\"17\" x2=\"12.01\" y2=\"17\"/></svg><span>'+m+'</span></div>';$('dl-err').style.display='block';$('dl-prog').style.display='none';$('dlbtn').disabled=false;}
${encJs}
function copyLink(){
  const u=location.origin+'/file/'+KEY+'/'+encodeURIComponent(FNAME)+'?dl';
  navigator.clipboard.writeText(u).then(()=>{
    const b=$('cplink');b.textContent='已复制';setTimeout(()=>{b.textContent='复制下载链接';},2000);
  });
}
async function startDl(){
  ${encGuard}
  $('dlbtn').disabled=true;$('dl-err').style.display='none';$('dl-prog').style.display='block';
  setPct(0,'准备下载...');
  try{
    await parallelDl();
    $('dl-done').style.display='block';$('dl-prog').style.display='none';
  }catch(e){showErr('下载失败：'+e.message);}
}
async function parallelDl(){
  const bufs=new Array(CHUNKS);let done=0;
  const queue=Array.from({length:CHUNKS},(_,i)=>i);
  async function worker(){
    while(queue.length){
      const i=queue.shift();if(i===undefined)break;
      setPct(Math.round(done/CHUNKS*85),'下载第 '+(i+1)+'/'+CHUNKS+' 片...');
      const r=await fetch('/chunk-url/'+KEY+'/'+i);
      if(!r.ok)throw new Error('第'+(i+1)+'片 HTTP '+r.status);
      let buf=await r.arrayBuffer();
      ${decryptChunk}
      bufs[i]=buf;done++;
      setPct(Math.round(done/CHUNKS*85),'已完成 '+done+'/'+CHUNKS+' 片');
    }
  }
  await Promise.all(Array.from({length:Math.min(CONC,CHUNKS)},()=>worker()));
  setPct(92,'合并文件...');
  const blob=new Blob(bufs,{type:MIME});
  setPct(97,'准备保存...');
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=FNAME;
  document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},30000);
  setPct(100,'完成');
}
</script>`;

  return htmlResp(layout("下载 · " + info.fileName, "", body, script));
}
