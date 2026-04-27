import { CHUNK_SIZE, CONCURRENCY } from "../constants.js";
import { genKey, fmtSize, htmlResp, jsonResp, esc } from "../utils.js";
import { tgSendDoc, tgSend } from "../telegram.js";
import { layout, ic, I } from "../ui.js";
import { createShortLink } from "./shortlink.js";

export function pageUpload(env, url) {
  const parent = url?.searchParams?.get("dir") || "";
  const body = `<div class="page sm">
    <h1 style="font-size:1.1rem;font-weight:700;margin-bottom:20px;display:flex;align-items:center;gap:8px">
      ${ic(I.up)} 上传文件
    </h1>
    <div class="Box">
      <div id="drop">
        ${ic('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>', 38)}
        <p style="color:var(--fg-muted);font-size:.88rem;margin-top:4px">点击选择或拖拽文件 / 文件夹</p>
        <p style="font-size:.74rem;color:var(--fg-subtle);margin-top:6px">自动 19.5 MB 分片 · 最多 ${CONCURRENCY} 片并发 · 支持任意大小</p>
        <input type="file" id="fi" style="display:none">
      </div>
      <div id="finfo" style="display:none;margin-top:14px;padding:10px 14px;background:var(--bg-input);border:1px solid var(--bd);border-radius:var(--r);align-items:center;gap:8px">
        ${ic(I.file)}
        <span class="mono" id="fname" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.8rem"></span>
        <span class="sub" id="fsize" style="font-size:.76rem;white-space:nowrap"></span>
      </div>
      <div id="cgrid" class="chunk-grid" style="display:none"></div>

      <details id="adv" style="margin-top:14px;display:none">
        <summary style="cursor:pointer;color:var(--fg-muted);font-size:.81rem;user-select:none;outline:none">⚙ 高级设置（可选）</summary>
        <div class="field" style="margin-top:10px;margin-bottom:8px">
          <label>文件备注</label>
          <input class="inp" type="text" id="note" placeholder="可选备注文字（显示在文件列表中）" style="font-size:.85rem">
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:10px">
          <div class="field" style="flex:1;min-width:130px;margin-bottom:0">
            <label>链接有效期</label>
            <select class="inp" id="expiry" style="padding:6px 10px;font-size:.83rem">
              <option value="">永久有效</option>
              <option value="3600">1 小时</option>
              <option value="86400">24 小时</option>
              <option value="604800">7 天</option>
              <option value="2592000">30 天</option>
            </select>
          </div>
          <div class="field" style="flex:1;min-width:130px;margin-bottom:0">
            <label>最大下载次数</label>
            <select class="inp" id="maxdl" style="padding:6px 10px;font-size:.83rem">
              <option value="">无限制</option>
              <option value="1">1 次</option>
              <option value="5">5 次</option>
              <option value="10">10 次</option>
              <option value="50">50 次</option>
              <option value="100">100 次</option>
            </select>
          </div>
        </div>
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--bd)">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem">
            <input type="checkbox" id="encChk" onchange="document.getElementById('encPw').style.display=this.checked?'block':'none'">
            🔒 客户端加密（AES-256-GCM）
          </label>
          <div id="encPw" style="display:none;margin-top:8px">
            <input class="inp" type="password" id="encPass" placeholder="设置加密密码" style="font-size:.85rem">
            <p class="sub" style="font-size:.72rem;margin-top:4px">文件在浏览器中加密后上传，密码不会发送到服务器</p>
          </div>
        </div>
      </details>
        <div class="flex">
          <button class="btn btn-primary" id="ubtn" onclick="up()" disabled>${ic(I.up)} 上传</button>
          <span id="umsg" style="font-size:.82rem;margin-left:10px"></span>
        </div>
        <div id="pw" style="display:none;margin-top:12px">
          <div class="pbar-wrap"><div class="pbar" id="pb"></div></div>
          <div id="pt" class="sub" style="margin-top:5px;font-size:.74rem"></div>
        </div>
      </div>
    <div id="res" style="display:none;margin-top:14px" class="Box"><div style="padding:24px">
      <div class="flash flash-ok" style="margin-bottom:14px">${ic(I.ok)}<span>上传成功</span></div>
      <div class="field">
        <label>下载链接</label>
        <div class="flex">
          <input class="inp mono" type="text" id="lv" readonly style="flex:1;font-size:.76rem;cursor:pointer">
          <button class="btn btn-default" id="cpbtn" onclick="cpLink()">${ic(I.copy)} 复制</button>
        </div>
      </div>
      <div class="field" id="shortField" style="display:none">
        <label>短链接</label>
        <div class="flex">
          <input class="inp mono" type="text" id="sv" readonly style="flex:1;font-size:.76rem;cursor:pointer">
          <button class="btn btn-default" onclick="cpS()">${ic(I.copy)} 复制</button>
        </div>
      </div>
      <div class="flex mt12">
        <a id="vl" class="btn btn-default" target="_blank">${ic(I.eye)} 预览</a>
        <a href="/list" class="btn btn-default">${ic(I.list)} 文件</a>
        <button class="btn btn-default" onclick="rst()">${ic(I.up)} 继续上传</button>
      </div>
      </div>
    </div>
  </div>`;

  const script = `<script>
const CHUNK=${CHUNK_SIZE},CONC=${CONCURRENCY},MAX_R=2;
window._tgdParent=${JSON.stringify(parent || null)};
let picked=null,pickedFiles=[],cProg=[],cState=[],encIVs=[],encSalt=null;
const $=id=>document.getElementById(id);
const sz=b=>!b?'-':b<1024?b+' B':b<1048576?(b/1024).toFixed(1)+' KB':b<1073741824?(b/1048576).toFixed(2)+' MB':(b/1073741824).toFixed(2)+' GB';

// Crypto: AES-256-GCM client-side encryption
const CR_SL=16,CR_IV=12,CR_IT=1e5;
async function dk(p,s){return crypto.subtle.deriveKey({name:"PBKDF2",salt:s,iterations:CR_IT,hash:"SHA-256"},await crypto.subtle.importKey("raw",new TextEncoder().encode(p),"PBKDF2",false,["deriveKey"]),{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);}
async function enc(b,p){const s=crypto.getRandomValues(new Uint8Array(CR_SL)),v=crypto.getRandomValues(new Uint8Array(CR_IV)),k=await dk(p,s);return{e:await crypto.subtle.encrypt({name:"AES-GCM",iv:v},k,b),v,s};}
function b2b(b){return btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+/g,"");}

// ── Directory walking ──
async function walkEntry(entry,path=""){
  if(entry.isFile) return new Promise(resolve=>{entry.file(f=>{f._relPath=path;resolve(f);});});
  if(entry.isDirectory){
    const entries=await new Promise(resolve=>entry.createReader().readEntries(resolve));
    return(await Promise.all(entries.map(e=>walkEntry(e,path+entry.name+"/")))).flat();
  }
  return[];
}

// ── Folder lookup / creation ──
const _folderCache={};
async function ensureFolder(path){
  if(!path)return window._tgdParent||null;
  if(_folderCache[path]!==undefined)return _folderCache[path];
  const parts=path.replace(/\/$/,"").split("/");
  let parent=window._tgdParent||null,cur="";
  for(const name of parts){
    cur=cur?cur+"/"+name:name;
    if(_folderCache[cur]!==undefined){parent=_folderCache[cur];continue;}
    const r=await fetch('/dir/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,parent})});
    const j=await r.json();
    if(j.ok){_folderCache[cur]=j.key;parent=j.key;}
    else throw new Error('创建文件夹失败: '+(j.error||'未知'));
  }
  return parent;
}

function rKey(f){return'tgd_'+f.name+'_'+f.size;}
function loadSaved(f){try{const v=sessionStorage.getItem(rKey(f));return v?JSON.parse(v):null;}catch{return null;}}
function saveProg(f,ids){try{sessionStorage.setItem(rKey(f),JSON.stringify(ids));}catch{}}
function clearProg(f){try{sessionStorage.removeItem(rKey(f));}catch{}}

function setF(f){
  if(!f)return;picked=f;
  const tc=Math.ceil(f.size/CHUNK)||1;
  $('fname').textContent=f.name;
  $('fsize').textContent=sz(f.size)+(tc>1?' · '+tc+'片 · 并发'+Math.min(CONC,tc):'');
  $('finfo').style.display='flex';$('adv').style.display='block';$('ubtn').disabled=false;$('res').style.display='none';
  buildGrid(tc);
  const saved=loadSaved(f);
  if(saved){
    const done=saved.filter(Boolean).length;
    $('umsg').innerHTML='<span style="color:var(--yn)">发现未完成上传（'+done+'/'+tc+' 片）&nbsp;'
      +'<button class="btn btn-default" style="padding:2px 8px" onclick="resumeUp()">续传</button>&nbsp;'
      +'<button class="btn btn-default" style="padding:2px 8px" onclick="clearAndUp()">重新上传</button></span>';
  } else {
    $('umsg').textContent='';
  }
}
function buildGrid(tc){
  const g=$('cgrid');if(tc<=1){g.style.display='none';return;}
  g.style.display='flex';g.innerHTML='';
  for(let i=0;i<tc;i++){const d=document.createElement('div');d.className='chunk-cell';d.id='cc'+i;d.title='片'+(i+1);g.appendChild(d);}
}
function setCell(i,s){const el=$('cc'+i);if(el)el.className='chunk-cell'+(s?' '+s:'');}
function refreshProg(tc){
  if(!picked)return;
  const loaded=cProg.reduce((a,b)=>a+b,0),total=picked.size,pct=total?Math.round(loaded/total*100):0;
  $('pb').style.width=pct+'%';
  const done=cState.filter(s=>s==='done').length,active=cState.filter(s=>s==='uploading').length;
  let t=pct+'% '+sz(loaded)+' / '+sz(total);
  if(tc>1)t+=' · 完成 '+done+'/'+tc+' 上传中 '+active;
  $('pt').textContent=t;
}
// ── Multi-file / Directory handlers ──
function setFiles(files){
  pickedFiles=files;
  const totalSize=files.reduce((s,f)=>s+f.size,0),tc=files.reduce((s,f)=>s+Math.ceil(f.size/CHUNK),0);
  $('fname').textContent=files.length+' 个文件';
  $('fsize').textContent=sz(totalSize)+(tc>0?' · ~'+tc+' 片':'');
  $('finfo').style.display='flex';$('adv').style.display='block';$('ubtn').disabled=false;$('res').style.display='none';
  $('cgrid').style.display='none';$('umsg').textContent='';
}
async function handleDrop(items){
  const all=[];
  for(let i=0;i<items.length;i++){
    const entry=items[i].webkitGetAsEntry?items[i].webkitGetAsEntry():null;
    if(entry&&entry.isDirectory)all.push(...await walkEntry(entry));
    else if(entry&&entry.isFile)all.push(...await walkEntry(entry));
    else if(items[i].getAsFile){const f=items[i].getAsFile();if(f)all.push(f);}
  }
  if(all.length)setFiles(all);else if(items[0]?.getAsFile())setF(items[0].getAsFile());
}
const drop=$('drop'),fi=$('fi');
drop.onclick=()=>fi.click();
drop.ondragover=e=>{e.preventDefault();drop.classList.add('over')};
drop.ondragleave=()=>drop.classList.remove('over');
drop.ondrop=e=>{e.preventDefault();e.stopPropagation();drop.classList.remove('over');
  if(e.dataTransfer.items&&e.dataTransfer.items.length)handleDrop(e.dataTransfer.items);
  else if(e.dataTransfer.files[0])setF(e.dataTransfer.files[0]);};
fi.setAttribute('multiple','multiple');
fi.setAttribute('webkitdirectory','');
fi.onchange=()=>{if(fi.files&&fi.files.length>1||(fi.files[0]&&fi.files[0].webkitRelativePath))setFiles([...fi.files]);else if(fi.files[0])setF(fi.files[0]);};
function cpLink(){
  navigator.clipboard.writeText($('lv').value);
  const b=$('cpbtn');const h=b.innerHTML;b.textContent='✓ 已复制';setTimeout(()=>b.innerHTML=h,1800);
}
function cpS(){
  navigator.clipboard.writeText($('sv').value);
}
function rst(){fi.value='';picked=null;pickedFiles=[];$('finfo').style.display='none';$('res').style.display='none';$('adv').style.display='none';$('ubtn').disabled=true;$('cgrid').innerHTML='';$('cgrid').style.display='none';$('umsg').textContent='';document.getElementById('note').value='';}
async function uploadChunk(f,i,tc,ids){
  const s=i*CHUNK,e=Math.min(s+CHUNK,f.size),csz=e-s;
  if(ids[i]){cProg[i]=csz;cState[i]='done';setCell(i,'done');refreshProg(tc);return ids[i];}
  cState[i]='uploading';setCell(i,'uploading');
  for(let attempt=0;attempt<=MAX_R;attempt++){
    try{
      let blob=f.slice(s,e);
      const encOn=document.getElementById('encChk').checked;
      if(encOn){
        const pw=document.getElementById('encPass').value;
        if(!pw)throw new Error('请设置加密密码');
        const ab=await blob.arrayBuffer();
        const r=await enc(ab,pw);
        blob=new Blob([r.e]);
        encIVs[i]=b2b(r.v);
        if(!encSalt)encSalt=b2b(r.s);
      }
      const fid=await new Promise((res,rej)=>{
        const fd=new FormData();fd.append('file',blob,f.name);
        const x=new XMLHttpRequest();
        x.upload.onprogress=ev=>{if(ev.lengthComputable){cProg[i]=ev.loaded;refreshProg(tc);}};
        x.onload=()=>{
          if(x.status===413){rej(new Error('片超大小限制'));return;}
          let j;try{j=JSON.parse(x.responseText)}catch{rej(new Error('HTTP '+x.status));return;}
          if(j.fileId)res(j.fileId);else rej(new Error('第'+(i+1)+'片: '+(j.error||'失败')));
        };
        x.onerror=()=>rej(new Error('网络错误'));
        x.open('POST','/upload/chunk');x.send(fd);
      });
      cProg[i]=csz;cState[i]='done';setCell(i,'done');refreshProg(tc);return fid;
    }catch(err){
      if(attempt===MAX_R){cState[i]='error';setCell(i,'error');throw new Error('第'+(i+1)+'片失败（重试'+MAX_R+'次）：'+err.message);}
      await new Promise(r=>setTimeout(r,800*(attempt+1)));
    }
  }
}
// ── Upload a single file with chunking + commit ──
async function _upOne(f,parentOverride){
  const tc=Math.ceil(f.size/CHUNK)||1;
  const ids=new Array(tc).fill(null);
  cProg=new Array(tc).fill(0);cState=new Array(tc).fill('idle');
  buildGrid(tc);refreshProg(tc);
  const queue=Array.from({length:tc},(_,i)=>i).filter(i=>!ids[i]);
  const worker=async()=>{while(queue.length){const i=queue.shift();if(i===undefined)break;ids[i]=await uploadChunk(f,i,tc,ids);}};
  await Promise.all(Array.from({length:Math.min(CONC,tc)},()=>worker()));
  const expiryVal=parseInt($('expiry').value)||0;
  const maxDlVal=parseInt($('maxdl').value)||0;
  const noteVal=document.getElementById('note').value.trim()||null;
  const cr=await fetch('/upload/commit',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({fileName:f.name,size:f.size,mimeType:f.type||'application/octet-stream',chunks:ids,
      ...(expiryVal?{expires:Date.now()+expiryVal*1000}:{}),
      ...(maxDlVal?{maxDl:maxDlVal}:{}),
      ...(parentOverride?{parent:parentOverride}:{}),
      ...(noteVal?{note:noteVal}:{}),
      ...(encSalt?{encSalt,encIVs:encIVs.filter(Boolean)}:{})})});
  const cj=await cr.json();
  if(!cj.link)throw new Error((cj.error||'提交失败'));
  return cj;
}

// ── Multi-file (folder) upload: process files sequentially ──
async function _upFolder(files){
  const total=files.length;
  for(let i=0;i<total;i++){
    const f=files[i];
    const relPath=f._relPath||"";
    $('umsg').innerHTML='<span style="color:var(--sb)">['+(i+1)+'/'+total+'] '+escHtml(f.name)+'</span>';
    const parentOverride=relPath?await ensureFolder(relPath.replace(/\/[^/]+$/,'')):(window._tgdParent||null);
    await _upOne(f,parentOverride);
  }
}
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

// ── Main entry ──
async function _up(){
  if(pickedFiles.length){
    $('ubtn').disabled=true;$('pw').style.display='block';$('umsg').textContent='';$('res').style.display='none';
    try{
      await _upFolder(pickedFiles);
      $('pw').style.display='none';
      $('umsg').innerHTML='<span style="color:var(--gn)">✅ 全部 '+pickedFiles.length+' 个文件上传完成</span>';
      document.getElementById('res').style.display='block';
      document.getElementById('lv').value=location.origin+'/list';
    }catch(e){$('pw').style.display='none';$('umsg').innerHTML='<span style="color:var(--rd)">❌ '+e.message+'</span>';}
    $('ubtn').disabled=false;
    return;
  }
  const f=picked;if(!f)return;
  $('ubtn').disabled=true;$('pw').style.display='block';$('umsg').textContent='';$('res').style.display='none';
  try{
    const cj=await _upOne(f,window._tgdParent||null);
    $('pw').style.display='none';
    clearProg(f);
    $('lv').value=cj.link;$('vl').href=cj.view;$('res').style.display='block';$('umsg').textContent='';
    if(cj.short){$('sv').value=cj.short;document.getElementById('shortField').style.display='block';}
  }catch(e){$('pw').style.display='none';$('umsg').innerHTML='<span style="color:var(--rd)">'+e.message+'</span>';}
  $('ubtn').disabled=false;
}
function up(){_up();}
function resumeUp(){const saved=loadSaved(picked);if(picked&&saved){/*simple re-upload in original flow*/_up();}else _up();}
function clearAndUp(){if(picked)clearProg(picked);$('umsg').textContent='';_up();}
</script>`;
  return htmlResp(layout("上传文件", "up", body, script));
}

export async function handleChunk(req, env) {
  const fd = await req.formData();
  const f  = fd.get("file");
  if (!f) return jsonResp({ error: "没有文件" }, 400);
  const tg = await tgSendDoc(env.CHAT_ID, f, f.name, env);
  if (!tg.ok || !tg.result?.document)
    return jsonResp({ error: "Bot API 错误: " + (tg.description || "未知") }, 502);
  return jsonResp({ fileId: tg.result.document.file_id });
}

export async function handleCommit(req, env) {
  let body;
  try { body = await req.json(); } catch { return jsonResp({ error: "invalid JSON" }, 400); }
  const { fileName, size, mimeType, chunks, expires, maxDl, parent, note, encSalt, encIVs } = body;
  if (!fileName || !Array.isArray(chunks) || !chunks.length)
    return jsonResp({ error: "invalid body" }, 400);

  const key  = genKey();
  const nc   = chunks.length;
  const data = {
    key, fileName,
    size:      size     || 0,
    mimeType:  mimeType || "application/octet-stream",
    timestamp: Date.now(),
    downloads: 0,
    ...(nc === 1 ? { fileId: chunks[0] } : { chunks }),
    ...(nc > 1 ? { partNames: chunks.map((_, i) =>
      `${fileName}.part${String(i + 1).padStart(3, "0")}`) } : {}),
    ...(expires ? { expires } : {}),
    ...(maxDl   ? { maxDl }   : {}),
    ...(parent  ? { parent }  : {}),
    ...(note    ? { note }    : {}),
    ...(encSalt ? { encSalt, encIVs } : {}),
  };
  await env.FILES_KV.put(key, JSON.stringify(data));

  // Generate short link
  let shortCode = null;
  try { shortCode = await createShortLink(key, env); } catch (e) { console.error("Short link gen failed:", e); }

  if (nc > 1) {
    tgSend(env.CHAT_ID,
      `📤 网页分片上传\n📄 ${fileName}\n📦 ${fmtSize(size || 0)} · ${nc} 片\n\n`
      + `🔗 ${env.BASE_LINK_URL}/file/${key}\n👁 ${env.BASE_LINK_URL}/view/${key}\n🗑 /del ${key}`, env);
  }
  return jsonResp({
    link: `${env.BASE_LINK_URL}/file/${key}`,
    view: `${env.BASE_LINK_URL}/view/${key}`,
    ...(shortCode ? { short: `${env.BASE_LINK_URL}/s/${shortCode}` } : {}),
  });
}
