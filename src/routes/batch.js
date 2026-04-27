import { getOne, kvListAll, kvBatchGet } from "../kv.js";
import { getAllFolders } from "./folders.js";
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

  // Prevent folder self-move and circular references
  const foldersToMove = keys.filter(k => k.startsWith("d_"));
  if (foldersToMove.length > 0 && target) {
    const allKeys = await kvListAll(env);
    const dKeys = allKeys.filter(k => k.name.startsWith("d_"));
    const entries = await kvBatchGet(dKeys, env);
    const childMap = {};
    for (const e of entries) {
      const p = e.parent || null;
      if (!childMap[p]) childMap[p] = [];
      childMap[p].push(e.key);
    }
    for (const k of foldersToMove) {
      if (k === target) return jsonResp({ error: "不能将文件夹移入自身" }, 400);
      const queue = [k];
      while (queue.length) {
        const cur = queue.shift();
        for (const ck of (childMap[cur] || [])) {
          if (ck === target) return jsonResp({ error: "不能将文件夹移入其子目录" }, 400);
          queue.push(ck);
        }
      }
    }
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
  const folders = await getAllFolders(env);
  return jsonResp(folders.map(f => ({ key: f.key, name: f.name })));
}
