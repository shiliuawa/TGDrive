import { getOne, kvListAll } from "../kv.js";
import { jsonResp } from "../utils.js";

export async function handleBatchUpdate(req, env) {
  let body;
  try { body = await req.json(); } catch { return jsonResp({ error: "invalid JSON" }, 400); }

  const { keys, expires, maxDl } = body;
  if (!Array.isArray(keys) || !keys.length) return jsonResp({ error: "缺少 keys" }, 400);

  let updated = 0;
  for (const key of keys) {
    const info = await getOne(key, env);
    if (!info) continue;
    if (expires !== undefined) info.expires = expires || null;
    if (maxDl !== undefined) info.maxDl = maxDl || null;
    await env.FILES_KV.put(key, JSON.stringify(info));
    updated++;
  }

  return jsonResp({ ok: true, updated });
}

export async function handleBatchMove(req, env) {
  let body;
  try { body = await req.json(); } catch { return jsonResp({ error: "invalid JSON" }, 400); }

  const { keys, target } = body;
  if (!Array.isArray(keys) || !keys.length) return jsonResp({ error: "缺少 keys" }, 400);

  // Prevent folder self-move
  for (const k of keys) {
    if (!k.startsWith("d_")) continue;
    if (k === target) return jsonResp({ error: "不能将文件夹移入自身" }, 400);
  }

  let moved = 0;
  for (const key of keys) {
    const info = await getOne(key, env);
    if (!info) continue;
    info.parent = target || null;
    await env.FILES_KV.put(key, JSON.stringify(info));
    moved++;
  }

  return jsonResp({ ok: true, moved });
}

/** Get all file & folder keys (for populating move target list) */
export async function handleListFolders(req, env) {
  const keys = await kvListAll(env);
  const dkeys = keys.filter(k => k.name.startsWith("d_"));
  const folders = await Promise.all(
    dkeys.map(async k => {
      const raw = await env.FILES_KV.get(k.name);
      if (!raw) return null;
      try { const d = JSON.parse(raw); return { key: d.key, name: d.name }; }
      catch { return null; }
    })
  );
  return jsonResp(folders.filter(Boolean));
}
