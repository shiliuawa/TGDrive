import { genKey, fmtSize, htmlResp, jsonResp, txt, esc } from "../utils.js";
import { tgSendDoc, tgSend } from "../telegram.js";
import { getOne } from "../kv.js";
import { layout, ic, I } from "../ui.js";
import { CHUNK_SIZE, CONCURRENCY } from "../constants.js";

/**
 * Public upload — no login required.
 *
 * Flow:
 * 1. Authenticated user generates a token: POST /pubup/gen { maxSize?, maxFiles?, expires? }
 *    → Returns shareable URL: /pubup/<token>
 * 2. Anyone with the URL can upload files (sends to the same TG chat)
 * 3. Rate-limited per IP
 */

export async function handlePublicUploadPage(token, env) {
  // Validate token
  const config = await getOne("pubup_" + token, env);
  if (!config) return txt("上传链接无效或已过期", 404);

  if (config.expires && Date.now() > config.expires) {
    return htmlResp(layout("链接已过期", "", `<div class="page sm"><div class="Box" style="padding:40px;text-align:center"><p style="font-size:2rem;margin-bottom:12px">🔒</p><p style="font-weight:600">此上传链接已过期</p></div></div>`));
  }

  // Reuse the upload page but with public endpoints
  const body = `<div class="page sm">
    <h1 style="font-size:1.1rem;font-weight:700;margin-bottom:20px;display:flex;align-items:center;gap:8px">
      ${ic(I.up)} 公开上传 - ${esc(config.name || "文件")}
    </h1>
    <div class="Box" style="padding:24px">
      <div id="drop">
        ${ic('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>', 38)}
        <p style="color:var(--fg-muted);font-size:.88rem;margin-top:4px">点击选择或拖拽文件</p>
        <p style="font-size:.74rem;color:var(--fg-subtle);margin-top:6px">自动 19.5 MB 分片 · 最多 ${CONCURRENCY} 片并发</p>
        <input type="file" id="fi" style="display:none">
      </div>
      <div id="finfo" style="display:none;margin-top:14px;padding:10px 14px;background:var(--bg-input);border-radius:var(--r);border:1px solid var(--bd);align-items:center;gap:8px">
        ${ic(I.file)}
        <span class="mono" id="fname" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.8rem"></span>
        <span class="sub" id="fsize" style="font-size:.76rem;white-space:nowrap"></span>
      </div>
      <div id="cgrid" class="chunk-grid" style="display:none"></div>
      <div style="margin-top:14px">
        <div class="flex">
          <button class="btn btn-primary" id="ubtn" onclick="up()" disabled>${ic(I.up)} 上传</button>
          <span id="umsg" style="font-size:.82rem;margin-left:10px"></span>
        </div>
        <div id="pw" style="display:none;margin-top:12px">
          <div class="pbar-wrap"><div class="pbar" id="pb"></div></div>
          <div id="pt" class="sub" style="margin-top:5px;font-size:.74rem"></div>
        </div>
      </div>
    </div>
    <div id="res" style="display:none;margin-top:14px" class="Box"><div style="padding:24px">
      <div class="flash flash-ok" style="margin-bottom:14px">${ic(I.ok)}<span>上传成功</span></div>
      <div class="flex mt12" style="justify-content:center">
        <button class="btn btn-default" onclick="rst()">继续上传</button>
      </div>
    </div>
  </div>
</div>`;

  const tokenJson = JSON.stringify(token);
  const script = `<script>
const CHUNK=${CHUNK_SIZE},CONC=${CONCURRENCY},MAX_R=2,TOKEN=${tokenJson};
let picked=null,cProg=[],cState=[];
const $=id=>document.getElementById(id);
const sz=b=>!b?'-':b<1024?b+' B':b<1048576?(b/1024).toFixed(1)+' KB':b<1073741824?(b/1048576).toFixed(2)+' MB':(b/1073741824).toFixed(2)+' GB';
function setF(f){if(!f)return;picked=f;const tc=Math.ceil(f.size/CHUNK)||1;
  $('fname').textContent=f.name;$('fsize').textContent=sz(f.size)+(tc>1?' · '+tc+'片':'');
  $('finfo').style.display='flex';$('ubtn').disabled=false;$('res').style.display='none';buildGrid(tc);$('umsg').textContent='';}
function buildGrid(tc){const g=$('cgrid');if(tc<=1){g.style.display='none';return;}
  g.style.display='flex';g.innerHTML='';for(let i=0;i<tc;i++){const d=document.createElement('div');d.className='chunk-cell';d.id='cc'+i;d.title='片'+(i+1);g.appendChild(d);}}
function refreshProg(tc){if(!picked)return;const l=cProg.reduce((a,b)=>a+b,0),t=picked.size,p=t?Math.round(l/t*100):0;
  $('pb').style.width=p+'%';const d=cState.filter(s=>s==='done').length,a=cState.filter(s=>s==='uploading').length;
  let s=p+'% '+sz(l)+' / '+sz(t);if(tc>1)s+=' · 完成 '+d+'/'+tc; $('pt').textContent=s;}
const drop=$('drop'),fi=$('fi');
drop.onclick=()=>fi.click();drop.ondragover=e=>{e.preventDefault();drop.classList.add('over')};
drop.ondragleave=()=>drop.classList.remove('over');
drop.ondrop=e=>{e.preventDefault();drop.classList.remove('over');if(e.dataTransfer.files[0])setF(e.dataTransfer.files[0])};
fi.onchange=()=>setF(fi.files[0]);
function rst(){fi.value='';picked=null;$('finfo').style.display='none';$('res').style.display='none';$('ubtn').disabled=true;$('cgrid').innerHTML='';$('umsg').textContent='';}
async function uploadChunk(f,i,tc,ids){const s=i*CHUNK,e=Math.min(s+CHUNK,f.size),csz=e-s;
  if(ids[i]){cProg[i]=csz;cState[i]='done';setCell(i,'done');refreshProg(tc);return ids[i];}
  cState[i]='uploading';setCell(i,'uploading');
  for(let a=0;a<=MAX_R;a++){try{
    const fid=await new Promise((res,rej)=>{const fd=new FormData();fd.append('file',f.slice(s,e),f.name);
      const x=new XMLHttpRequest();x.upload.onprogress=ev=>{if(ev.lengthComputable){cProg[i]=ev.loaded;refreshProg(tc);}};
      x.onload=()=>{if(x.status===413){rej(new Error('片超大小限制'));return;}
        let j;try{j=JSON.parse(x.responseText)}catch{rej(new Error('HTTP '+x.status));return;}
        if(j.fileId)res(j.fileId);else rej(new Error('第'+(i+1)+'片: '+(j.error||'失败')));};
      x.onerror=()=>rej(new Error('网络错误'));x.open('POST','/pubup/'+TOKEN+'/chunk');x.send(fd);});
    cProg[i]=csz;cState[i]='done';setCell(i,'done');refreshProg(tc);return fid;
  }catch(err){if(a===MAX_R){cState[i]='error';setCell(i,'error');throw new Error('第'+(i+1)+'片失败：'+err.message);}
    await new Promise(r=>setTimeout(r,800*(a+1)));}}
}
function setCell(i,s){const el=$('cc'+i);if(el)el.className='chunk-cell'+(s?' '+s:'');}
async function up(){const f=picked;if(!f)return;$('ubtn').disabled=true;$('pw').style.display='block';$('umsg').textContent='';$('res').style.display='none';
  try{const tc=Math.ceil(f.size/CHUNK)||1;const ids=new Array(tc).fill(null);cProg=new Array(tc).fill(0);cState=new Array(tc).fill('idle');
    buildGrid(tc);refreshProg(tc);const q=Array.from({length:tc},(_,i)=>i);
    const w=async()=>{while(q.length){const i=q.shift();if(i===undefined)break;ids[i]=await uploadChunk(f,i,tc,ids);}};
    await Promise.all(Array.from({length:Math.min(CONC,tc)},()=>w()));
    const cr=await fetch('/pubup/'+TOKEN+'/commit',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({fileName:f.name,size:f.size,mimeType:f.type||'application/octet-stream',chunks:ids})});
    const cj=await cr.json();
    $('pw').style.display='none';
    if(cj.ok){$('res').style.display='block';$('umsg').textContent='';}else throw new Error(cj.error||'提交失败');
  }catch(e){$('pw').style.display='none';$('umsg').innerHTML='<span style="color:var(--rd)">'+e.message+'</span>';}
  $('ubtn').disabled=false;}
</script>`;
  return htmlResp(layout("公开上传", "", body, script));
}

/** Generate a public upload token (authenticated) */
export async function handleGenPublicUpload(req, env) {
  let body;
  try { body = await req.json(); } catch { return jsonResp({ error: "invalid JSON" }, 400); }

  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const config = {
    name: body.name || "公开上传",
    expires: body.expires ? Date.now() + body.expires * 1000 : null,
    maxSize: body.maxSize || null,
    createdAt: Date.now(),
  };

  await env.FILES_KV.put("pubup_" + token, JSON.stringify(config));
  return jsonResp({
    ok: true,
    token,
    url: env.BASE_LINK_URL + "/pubup/" + token,
  });
}

/** Handle public upload chunk */
export async function handlePublicUploadChunk(path, env, req) {
  const token = path.split("/")[0];
  const config = await getOne("pubup_" + token, env);
  if (!config) return jsonResp({ error: "链接无效" }, 404);

  if (config.expires && Date.now() > config.expires) {
    return jsonResp({ error: "链接已过期" }, 410);
  }

  const fd = await req.formData();
  const f  = fd.get("file");
  if (!f) return jsonResp({ error: "没有文件" }, 400);

  if (config.maxSize && f.size > config.maxSize)
    return jsonResp({ error: `文件超过大小限制（最大 ${config.maxSize} 字节）` }, 413);

  const tg = await tgSendDoc(env.CHAT_ID, f, f.name, env);
  if (!tg.ok || !tg.result?.document)
    return jsonResp({ error: "Bot API 错误: " + (tg.description || "未知") }, 502);
  return jsonResp({ fileId: tg.result.document.file_id });
}

/** Handle public upload commit */
export async function handlePublicUploadCommit(path, env, req) {
  const token = path.split("/")[0];
  const config = await getOne("pubup_" + token, env);
  if (!config) return jsonResp({ error: "链接无效" }, 404);

  if (config.expires && Date.now() > config.expires) {
    return jsonResp({ error: "链接已过期" }, 410);
  }

  let body;
  try { body = await req.json(); } catch { return jsonResp({ error: "invalid JSON" }, 400); }
  const { fileName, size, mimeType, chunks } = body;
  if (!fileName || !Array.isArray(chunks) || !chunks.length)
    return jsonResp({ error: "invalid body" }, 400);

  if (config.maxSize && size > config.maxSize)
    return jsonResp({ error: `文件超过大小限制（最大 ${config.maxSize} 字节）` }, 413);

  const key  = genKey();
  const nc   = chunks.length;
  const data = {
    key, fileName,
    size:      size     || 0,
    mimeType:  mimeType || "application/octet-stream",
    timestamp: Date.now(),
    downloads: 0,
    fromPublic: true,
    ...(nc === 1 ? { fileId: chunks[0] } : { chunks }),
  };
  await env.FILES_KV.put(key, JSON.stringify(data));

  tgSend(env.CHAT_ID,
    `📤 公开上传\n📄 ${fileName}\n📦 ${fmtSize(size || 0)}${nc > 1 ? ` · ${nc} 片` : ""}`
    + `\n🔗 ${env.BASE_LINK_URL}/file/${key}`, env);

  return jsonResp({ ok: true });
}
