import { getAllFiles } from "../kv.js";
import { esc, fmtSize, fmtDate, fmtNum, htmlResp, tgMsgLink } from "../utils.js";
import { layout, ic, I } from "../ui.js";
import { listByParent, getBreadcrumbs, getAllFolders } from "./folders.js";

export async function pageList(req, env, url) {
  const q     = (url.searchParams.get("q")    || "").toLowerCase().trim();
  const sort  = url.searchParams.get("sort") || "time";
  const dir   = url.searchParams.get("dir") || "";

  const allFiles = await getAllFiles(env);
  const currentDir = dir || null;

  // Breadcrumbs
  const crumbs = currentDir ? await getBreadcrumbs(currentDir, env) : [];
  // Current folder info (for the nav highlight)
  const currFolder = currentDir ? crumbs[crumbs.length - 1] : null;

  let entries;
  if (q) {
    // Search across all files
    const all = await getAllFolders(env);
    entries = [
      ...all.filter(f => (f.name || "").toLowerCase().includes(q)).map(f => ({ ...f, _isDir: true })),
      ...allFiles.filter(f => (f.fileName || "").toLowerCase().includes(q)).map(f => ({ ...f, _isDir: false })),
    ];
  } else {
    entries = await listByParent(currentDir, env);
    // Mark directories
    entries = entries.map(e => ({ ...e, _isDir: !e.fileName }));
  }

  // Sort
  if (sort === "name") {
    entries.sort((a, b) => {
      if (a._isDir && !b._isDir) return -1;
      if (!a._isDir && b._isDir) return 1;
      return (a.name || a.fileName || "").localeCompare(b.name || b.fileName || "");
    });
  } else if (sort === "size") {
    entries.sort((a, b) => {
      if (a._isDir && !b._isDir) return -1;
      if (!a._isDir && b._isDir) return 1;
      return (b.size||0) - (a.size||0);
    });
  } else if (sort === "dl") {
    entries.sort((a, b) => {
      if (a._isDir && !b._isDir) return -1;
      if (!a._isDir && b._isDir) return 1;
      return (b.downloads||0) - (a.downloads||0);
    });
  }

  const totalSize = allFiles.reduce((s, f) => s + (f.size || 0), 0);
  const totalDl   = 0;

  const dirParam = currentDir ? `&dir=${esc(currentDir)}` : "";
  const sh = (col, label) => {
    const on = sort === col;
    return `<a class="srt${on?' on':''}" href="/list?${q ? `q=${esc(q)}` : ""}${dirParam}&sort=${col}">${label}${on?" ↓":""}</a>`;
  };

  // Breadcrumb HTML
  const breadcrumb = `<div class="bc">
    <a href="/list"${!currentDir ? ' class="cur"' : ""}>📁 全部文件</a>
    ${crumbs.map((c, i) => {
      const isLast = i === crumbs.length - 1;
      return `<span class="sep">/</span><a href="/list?dir=${esc(c.key)}"${isLast ? ' class="cur"' : ""}>📁 ${esc(c.name)}</a>`;
    }).join("")}
  </div>`;

  // Build sibling list for image gallery navigation
  const fileKeys = entries.filter(e => !e._isDir).map(e => e.key);
  const siblingsStr = fileKeys.length > 1 ? `?siblings=${fileKeys.join(",")}` : "";

  // Rows
  const rows = entries.map(e => {
    if (e._isDir) {
      // Folder row
      const k = esc(e.key);
      const n = esc(e.name || "");
      return `<tr data-key="${k}" data-type="dir">
        <td colspan="4">
          <a href="/list?dir=${k}" style="display:flex;align-items:center;gap:8px;color:var(--tx);text-decoration:none;padding:2px 0">
            <span style="font-size:1.1rem">📁</span>
            <span class="mono" style="font-size:.8rem">${n}</span>
          </a>
        </td>
      </tr>`;
    }

    // File row
    const k     = esc(e.key);
    const fn    = esc(e.fileName);
    const nc    = Array.isArray(e.chunks) ? e.chunks.length : 1;
    const tgLnk = tgMsgLink(e);

    const chunkTag = nc > 1 ? `<span class="tag tag-gray" style="margin-left:5px">${nc}片</span>` : "";
    const expTag   = e.expires && e.expires - Date.now() < 86400000 && e.expires > Date.now()
      ? `<span class="tag tag-warn" style="margin-left:5px" title="即将过期">⏱快过期</span>` : "";
    const expiredTag = e.expires && e.expires < Date.now()
      ? `<span class="tag tag-gray" style="margin-left:5px">已过期</span>` : "";
    const noteHtml = e.note
      ? `<span class="sub note-text" style="display:block;font-size:.72rem;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:360px">📝 ${esc(e.note)}</span>`
      : "";
    const dlBadge  = "";

    return `<tr data-key="${k}" data-type="file">
      <td>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" class="chk" value="${k}" style="accent-color:var(--ac);width:14px;height:14px;flex-shrink:0">
          <span style="flex:1;min-width:0">
            <span class="mono" id="fn_${k}" style="word-break:break-all;font-size:.8rem">${fn}${chunkTag}${expTag}${expiredTag}</span>
            ${noteHtml}
          </span>
          ${dlBadge}
        </label>
      </td>
      <td style="white-space:nowrap;color:var(--sb);text-align:right;font-size:.82rem">${fmtSize(e.size)}</td>
      <td style="white-space:nowrap;color:var(--sb);font-size:.76rem">${fmtDate(e.timestamp)}</td>
      <td>
        <div class="flex" style="gap:3px;justify-content:flex-end">
          <button class="btn btn-default btn-sm" data-action="copy" data-url="${esc(env.BASE_LINK_URL)}/file/${k}" title="复制链接">${ic(I.copy)}</button>
          <a class="btn btn-default btn-sm" href="/view/${k}${siblingsStr}" target="_blank" title="预览">${ic(I.eye)}</a>
          <button class="btn btn-default btn-sm" data-action="note" data-key="${k}" data-note="${esc(e.note||'')}" title="备注">📝</button>
          <button class="btn btn-default btn-sm" data-action="rename" data-key="${k}" data-name="${esc(e.fileName)}" title="重命名">✏</button>
          <a class="btn btn-default btn-sm" href="/dl/${k}" title="下载">${ic(I.dl)}</a>
          ${tgLnk ? `<a class="btn btn-default btn-sm" href="${esc(tgLnk)}" target="_blank" title="查看 TG 原消息">${ic(I.tg)}</a>` : ""}
          <button class="btn btn-danger btn-sm" data-action="delete" data-key="${k}" data-name="${esc(e.fileName)}" title="删除">${ic(I.del)}</button>
        </div>
      </td>
    </tr>`;
  }).join("");

  const isEmpty = !q && entries.length === 0;

  const table = isEmpty
    ? `<div class="empty">${ic(I.file, 40)}<p>${currentDir ? "此文件夹为空" : "还没有文件，去上传第一个吧"}</p></div>`
    : `<div style="overflow-x:auto"><table class="tbl">
        <thead><tr>
          <th style="width:99%">${sh("name","文件名")}</th>
          <th style="text-align:right">${sh("size","大小")}</th>
          <th>${sh("time","时间")}</th>
          <th style="text-align:right">操作</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;

  // Move dialog — folder picker
  const allFolders = q ? [] : await getAllFolders(env);
  const folderOptions = allFolders
    .filter(f => f.key !== currentDir)
    .map(f => `<option value="${esc(f.key)}">${esc(f.name)}</option>`).join("");

  const body = `<div class="page">
    <div class="stats">
      <div class="stat-item"><div class="num">${allFiles.length}</div><div class="lbl">文件</div></div>
      <div class="stat-item"><div class="num">${fmtSize(totalSize)}</div><div class="lbl">总大小</div></div>
    </div>

    <!-- Rename Modal -->
    <div id="rnModal" class="Modal">
      <div class="Modal-box">
        <div class="Modal-title">✏ 重命名</div>
        <div class="field">
          <label>新名称</label>
          <input class="inp" type="text" id="rnInput" placeholder="输入新名称">
        </div>
        <div class="Modal-actions">
          <button class="btn btn-default" onclick="closeRn()">取消</button>
          <button class="btn btn-primary" onclick="doRn()">确认</button>
        </div>
      </div>
    </div>

    <!-- New Folder Modal -->
    <div id="nfModal" class="Modal">
      <div class="Modal-box">
        <div class="Modal-title">📁 新建文件夹</div>
        <div class="field">
          <label>文件夹名称</label>
          <input class="inp" type="text" id="nfInput" placeholder="输入文件夹名称">
        </div>
        <div class="Modal-actions">
          <button class="btn btn-default" onclick="closeNf()">取消</button>
          <button class="btn btn-primary" onclick="doNf()">创建</button>
        </div>
      </div>
    </div>

    <!-- Note Modal -->
    <div id="ntModal" class="Modal">
      <div class="Modal-box">
        <div class="Modal-title">📝 编辑备注</div>
        <div class="field">
          <label>备注文字</label>
          <input class="inp" type="text" id="ntInput" placeholder="输入备注文字">
        </div>
        <div class="Modal-actions">
          <button class="btn btn-default" onclick="closeNt()">取消</button>
          <button class="btn btn-primary" onclick="doNt()">保存</button>
        </div>
      </div>
    </div>

    <!-- Move Modal -->
    <div id="mvModal" class="Modal">
      <div class="Modal-box">
        <div class="Modal-title">📂 移动到</div>
        <div class="field">
          <label>目标文件夹</label>
          <select class="inp" id="mvTarget">
            <option value="">根目录</option>
            ${folderOptions}
          </select>
        </div>
        <div class="Modal-actions">
          <button class="btn btn-default" onclick="closeMv()">取消</button>
          <button class="btn btn-primary" onclick="doMv()">移动</button>
        </div>
      </div>
    </div>

    <!-- Batch Download Modal -->
    <div id="bdModal" class="Modal">
      <div class="Modal-box" style="max-width:520px;max-height:80vh;display:flex;flex-direction:column;padding:24px">
        <div class="Modal-title">${ic(I.dl)} 批量下载</div>
        <div style="flex:1;overflow:auto;margin-bottom:14px;font-size:.82rem" id="bdFileList"></div>
        <div class="Modal-actions">
          <button class="btn btn-default" onclick="closeBd()">取消</button>
          <button class="btn btn-default" id="bdCopyBtn" onclick="bdCopy()">${ic(I.copy)} 复制所有链接</button>
          <button class="btn btn-primary" onclick="bdAria2()">${ic(I.dl)} 导出 aria2</button>
        </div>
      </div>
    </div>

    ${!q ? breadcrumb : `<div class="bc">🔍 搜索：${esc(q)} · <a href="/list" style="margin-left:4px">清除</a></div>`}

    <div class="abar">
      <form method="GET" action="/list" class="sp" style="position:relative">
        <input type="hidden" name="sort" value="${esc(sort)}">
        ${currentDir ? `<input type="hidden" name="dir" value="${esc(currentDir)}">` : ""}
        <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--fg-subtle);pointer-events:none;line-height:1">${ic(I.srch, 14)}</span>
        <input type="search" name="q" value="${esc(q)}" placeholder="搜索文件名…" class="inp" style="padding-left:32px">
      </form>
      <button class="btn btn-default btn-sm" data-action="select-all">全选</button>
      <button class="btn btn-default btn-sm" data-action="select-none">取消</button>
      <button class="btn btn-default btn-sm" data-action="new-folder">📁 新建文件夹</button>
      <button class="btn btn-default btn-sm" id="mvbtn" data-action="move" disabled>📂 移动</button>
      <button class="btn btn-default btn-sm" id="dlbtn" data-action="batch-dl" disabled>${ic(I.dl)} 批量下载</button>
	      <button class="btn btn-danger btn-sm" id="bd" data-action="batch-delete" disabled>${ic(I.del)} <span id="bdtxt">批量删除</span></button>
      <a class="btn btn-primary btn-sm" href="/upload${currentDir ? `?dir=${esc(currentDir)}` : ""}">${ic(I.up)} 上传</a>
    </div>
    <div class="Box">${table}</div>
  </div>`;

  const foot = `<script>
function sa(v){document.querySelectorAll('.chk').forEach(c=>c.checked=v);ub();}
function ub(){
  const n=document.querySelectorAll('.chk:checked').length;
  document.getElementById('bd').disabled=n===0;
  document.getElementById('bdtxt').textContent=n?'删除('+n+')':'批量删除';
  document.getElementById('mvbtn').disabled=n===0;
  document.getElementById('dlbtn').disabled=n===0;
}
async function del(keys){
  const fd=new FormData();keys.forEach(k=>fd.append('keys',k));
  const r=await fetch('/delete',{method:'POST',body:fd});const j=await r.json();
  if(j.ok)keys.forEach(k=>{const tr=document.querySelector('tr[data-key="'+k+'"]');if(tr)tr.remove();});ub();
}
function d1(k,n){if(!confirm('确认删除：'+n+'?'))return;del([k]);}
function db(){const keys=[...document.querySelectorAll('.chk:checked')].map(c=>c.value);if(!keys.length)return;if(!confirm('确认删除 '+keys.length+' 个文件？'))return;del(keys);}
let _rnKey=null,_ntKey=null;
function openRn(key,name){_rnKey=key;document.getElementById('rnInput').value=name;document.getElementById('rnModal').style.display='flex';setTimeout(()=>document.getElementById('rnInput').focus(),50);}
function closeRn(){document.getElementById('rnModal').style.display='none';_rnKey=null;}
function openNt(key,note){_ntKey=key;document.getElementById('ntInput').value=note;document.getElementById('ntModal').style.display='flex';setTimeout(()=>document.getElementById('ntInput').focus(),50);}
function closeNt(){document.getElementById('ntModal').style.display='none';_ntKey=null;}
async function doNt(){
  const note=document.getElementById('ntInput').value.trim();
  if(!_ntKey)return;
  const r=await fetch('/note',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:_ntKey,note})});
  const j=await r.json();
  if(j.ok){
    const row=document.querySelector('tr[data-key="'+_ntKey+'"]');
    if(row){const old=row.querySelector('.note-text');if(old)old.textContent=note||'';else if(note){const fn=row.querySelector('.mono');if(fn){const s=document.createElement('span');s.className='sub note-text';s.style.cssText='display:block;font-size:.72rem;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:360px';s.innerHTML='📝 '+note;fn.parentNode.appendChild(s);}}}
    closeNt();
  }else{alert('保存失败: '+(j.error||'未知'));}
}
async function doRn(){
  const newName=document.getElementById('rnInput').value.trim();
  if(!newName||!_rnKey)return;
  const r=await fetch('/rename',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:_rnKey,newName})});
  const j=await r.json();
  if(j.ok){
    const el=document.getElementById('fn_'+_rnKey);
    if(el){const tags=el.innerHTML.match(/<span[^>]*tag[^>]*>.*?<\\/span>/g)||[];el.innerHTML=j.newName+(tags.join(''));}
    closeRn();
  }else{alert('重命名失败: '+(j.error||'未知'));}
}
function openNf(){document.getElementById('nfInput').value='';document.getElementById('nfModal').style.display='flex';setTimeout(()=>document.getElementById('nfInput').focus(),50);}
function closeNf(){document.getElementById('nfModal').style.display='none';}
async function doNf(){
  const name=document.getElementById('nfInput').value.trim();
  if(!name)return;
  const r=await fetch('/dir/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,parent:${JSON.stringify(currentDir || null)}})});
  const j=await r.json();
  if(j.ok)location.reload();else alert('创建失败: '+(j.error||'未知'));
}
let _mvKeys=[];
function openMv(){_mvKeys=[...document.querySelectorAll('.chk:checked')].map(c=>c.value);if(!_mvKeys.length)return;document.getElementById('mvModal').style.display='flex';}
function closeMv(){document.getElementById('mvModal').style.display='none';_mvKeys=[];}
async function doMv(){
  const target=document.getElementById('mvTarget').value||null;
  const r=await fetch('/batch/move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keys:_mvKeys,target})});
  const j=await r.json();
  if(j.ok)location.reload();else alert('移动失败: '+(j.error||'未知'));
}
// ── Batch download functions ──
function openBd(){
  const keys=[...document.querySelectorAll('.chk:checked')].map(c=>c.value);
  if(!keys.length)return;
  const base=location.origin;
  const rows=keys.map(k=>{
    const tr=document.querySelector('tr[data-key="'+k+'"]');
    const fn=tr?tr.querySelector('.mono')?.textContent||k:k;
    const url=base+'/file/'+k+'/'+encodeURIComponent(fn)+'?dl';
    return '<div class="flex" style="padding:4px 0;gap:6px"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.78rem">'+fn+'</span><span class="mono sub" style="font-size:.72rem;flex-shrink:0">'+url.slice(0,30)+'…</span></div>';
  }).join('');
  document.getElementById('bdFileList').innerHTML=rows;
  document.getElementById('bdModal').style.display='flex';
  window._bdKeys=keys;
}
function closeBd(){document.getElementById('bdModal').style.display='none';window._bdKeys=null;}
function bdCopy(){
  const base=location.origin;
  const links=window._bdKeys.map(k=>{
    const tr=document.querySelector('tr[data-key="'+k+'"]');
    const fn=tr?tr.querySelector('.mono')?.textContent||k:k;
    return base+'/file/'+k+'/'+encodeURIComponent(fn)+'?dl';
  }).join('\n');
  navigator.clipboard.writeText(links).then(()=>{
    const b=document.getElementById('bdCopyBtn');b.textContent='✓ 已复制';setTimeout(()=>{b.innerHTML='${ic(I.copy)} 复制所有链接';},2000);
  });
}
function bdAria2(){
  const base=location.origin;
  const lines=window._bdKeys.map(k=>{
    const tr=document.querySelector('tr[data-key="'+k+'"]');
    const fn=tr?tr.querySelector('.mono')?.textContent||k:k;
    return base+'/file/'+k+'/'+encodeURIComponent(fn)+'?dl\n  out='+fn;
  }).join('\n');
  const blob=new Blob([lines],{type:'text/plain'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='tgdrive-aria2.txt';
  document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},5000);
}
// Event delegation — no inline onclick handlers (avoids escaping issues)
document.addEventListener('click',function(e){
  var btn=e.target.closest('[data-action]');if(!btn)return;
  switch(btn.dataset.action){
    case'copy':navigator.clipboard.writeText(btn.dataset.url);var h=btn.innerHTML;btn.innerHTML='${ic(I.ok).replace(/'/g,"\\'")}';setTimeout(function(){btn.innerHTML=h},1500);break;
    case'rename':openRn(btn.dataset.key,btn.dataset.name);break;
    case'note':openNt(btn.dataset.key,btn.dataset.note);break;
    case'delete':d1(btn.dataset.key,btn.dataset.name);break;
    case'select-all':sa(true);break;
    case'select-none':sa(false);break;
    case'new-folder':openNf();break;
    case'move':openMv();break;
    case'batch-delete':db();break;
    case'batch-dl':openBd();break;
  }
});
document.addEventListener('change',function(e){if(e.target.classList.contains('chk'))ub();});
document.getElementById('rnModal').addEventListener('click',function(e){if(e.target===document.getElementById('rnModal'))closeRn();});
document.getElementById('rnInput').addEventListener('keydown',function(e){if(e.key==='Enter')doRn();if(e.key==='Escape')closeRn();});
document.getElementById('ntModal').addEventListener('click',function(e){if(e.target===document.getElementById('ntModal'))closeNt();});
document.getElementById('ntInput').addEventListener('keydown',function(e){if(e.key==='Enter')doNt();if(e.key==='Escape')closeNt();});
document.getElementById('nfModal').addEventListener('click',function(e){if(e.target===document.getElementById('nfModal'))closeNf();});
document.getElementById('nfInput').addEventListener('keydown',function(e){if(e.key==='Enter')doNf();if(e.key==='Escape')closeNf();});
document.getElementById('mvModal').addEventListener('click',function(e){if(e.target===document.getElementById('mvModal'))closeMv();});
</script>`;
  return htmlResp(layout("文件列表", "list", body, foot));
}
