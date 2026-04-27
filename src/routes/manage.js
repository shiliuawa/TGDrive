import { KV_BATCH } from "../constants.js";
import { getOne, kvListAll, kvBatchGet } from "../kv.js";
import { jsonResp, htmlResp } from "../utils.js";
import { layout } from "../ui.js";

export async function handleDelete(req, env) {
  const fd   = await req.formData();
  const keys = fd.getAll("keys").filter(Boolean);
  if (!keys.length) return jsonResp({ ok: false, error: "no keys" }, 400);
  const allowed = keys.filter(k => k.startsWith("f_") || k.startsWith("d_"));
  await Promise.all(allowed.map(k => env.FILES_KV.delete(k)));
  return jsonResp({ ok: true, deleted: allowed.length });
}

export async function handleRename(req, env) {
  let body;
  try { body = await req.json(); } catch { return jsonResp({ error: "invalid JSON" }, 400); }
  const { key, newName } = body;
  if (!key || !newName?.trim()) return jsonResp({ error: "missing key or newName" }, 400);
  const info = await getOne(key, env);
  if (!info) return jsonResp({ error: "not found" }, 404);
  info.fileName = newName.trim();
  await env.FILES_KV.put(key, JSON.stringify(info));
  return jsonResp({ ok: true, oldName: info.fileName, newName: info.fileName });
}

export async function handleNote(req, env) {
  let body;
  try { body = await req.json(); } catch { return jsonResp({ error: "invalid JSON" }, 400); }
  const { key, note } = body;
  if (!key) return jsonResp({ error: "missing key" }, 400);
  const info = await getOne(key, env);
  if (!info) return jsonResp({ error: "not found" }, 404);
  info.note = note || "";
  await env.FILES_KV.put(key, JSON.stringify(info));
  return jsonResp({ ok: true });
}

export async function handleCleanup(env) {
  const keys = await kvListAll(env);
  const all  = await kvBatchGet(keys, env);
  all.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const seen = new Map(), toDelete = [];
  for (const f of all) {
    const id = f.fileId || (Array.isArray(f.chunks) ? f.chunks[0] : null) || f.key;
    if (seen.has(id)) toDelete.push(f.key); else seen.set(id, f.key);
  }
  for (let i = 0; i < toDelete.length; i += KV_BATCH)
    await Promise.all(toDelete.slice(i, i + KV_BATCH).map(k => env.FILES_KV.delete(k)));

  return htmlResp(layout("清理", "list", `<div class="page sm">
    <div class="Box" style="padding:24px;margin-top:40px">
      <h2 style="margin-bottom:20px;font-weight:600">🧹 清理完成</h2>
      <p>扫描总条数：<b>${all.length}</b></p>
      <p class="mt8">已删除重复：<b style="color:var(--rd)">${toDelete.length}</b></p>
      <p class="mt8">保留唯一：<b style="color:var(--gn)">${all.length - toDelete.length}</b></p>
      <div class="flex mt24"><a class="btn btn-primary" href="/list">查看文件列表</a></div>
    </div>
  </div>`));
}
