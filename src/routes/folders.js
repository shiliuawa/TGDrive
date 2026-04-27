import { genKey, jsonResp } from "../utils.js";
import { getOne, kvListAll, kvBatchGet } from "../kv.js";

/** Get all folders (d_ keys) sorted by name */
export async function getAllFolders(env) {
  const keys = await kvListAll(env);
  const dkeys = keys.filter(k => k.name.startsWith("d_"));
  const list = await kvBatchGet(dkeys, env);
  return list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

/** Get all files and folders whose parent matches */
export async function listByParent(parent, env) {
  const keys = await kvListAll(env);
  const allKeys = keys.filter(k => k.name.startsWith("f_") || k.name.startsWith("d_"));
  const entries = await kvBatchGet(allKeys, env);
  const filtered = entries.filter(e => (e.parent || null) === (parent || null));
  // folders first, then by name
  return filtered.sort((a, b) => {
    const aIsDir = a.name && !a.fileName; // d_ entries have .name, f_ have .fileName
    const bIsDir = b.name && !b.fileName;
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    return (a.name || a.fileName || "").localeCompare(b.name || b.fileName || "");
  });
}

/** Build breadcrumb path from a folder key up to root */
export async function getBreadcrumbs(dirKey, env) {
  const crumbs = [];
  let current = dirKey;
  while (current) {
    const folder = await getOne(current, env);
    if (!folder) break;
    crumbs.unshift({ key: folder.key, name: folder.name });
    current = folder.parent || null;
  }
  return crumbs;
}

export async function handleCreateDir(req, env) {
  let body;
  try { body = await req.json(); } catch { return jsonResp({ error: "invalid JSON" }, 400); }
  const { name, parent } = body;
  if (!name?.trim()) return jsonResp({ error: "缺少文件夹名称" }, 400);

  const key = genKey().replace("f_", "d_");
  const data = {
    key,
    name: name.trim(),
    parent: parent || null,
    timestamp: Date.now(),
  };
  await env.FILES_KV.put(key, JSON.stringify(data));
  return jsonResp({ ok: true, key, name: data.name });
}

export async function handleRenameDir(req, env) {
  let body;
  try { body = await req.json(); } catch { return jsonResp({ error: "invalid JSON" }, 400); }
  const { key, newName } = body;
  if (!key || !newName?.trim()) return jsonResp({ error: "缺少参数" }, 400);
  const info = await getOne(key, env);
  if (!info) return jsonResp({ error: "文件夹不存在" }, 404);
  info.name = newName.trim();
  await env.FILES_KV.put(key, JSON.stringify(info));
  return jsonResp({ ok: true, name: info.name });
}

export async function handleDeleteDir(req, env) {
  let body;
  try { body = await req.json(); } catch { return jsonResp({ error: "invalid JSON" }, 400); }
  const { key } = body;
  if (!key) return jsonResp({ error: "缺少文件夹 key" }, 400);

  const info = await getOne(key, env);
  if (!info) return jsonResp({ error: "文件夹不存在" }, 404);

  // Collect all descendants (files + sub-folders) recursively
  const toDelete = [key];
  const allKeys = (await kvListAll(env)).filter(k => k.name.startsWith("f_") || k.name.startsWith("d_"));
  const allEntries = await kvBatchGet(allKeys, env);

  const childMap = {};
  for (const e of allEntries) {
    const p = e.parent || null;
    if (!childMap[p]) childMap[p] = [];
    childMap[p].push(e.key);
  }

  // BFS to find all descendants
  const queue = [key];
  while (queue.length) {
    const current = queue.shift();
    const children = childMap[current] || [];
    for (const ck of children) {
      toDelete.push(ck);
      queue.push(ck);
    }
  }

  await Promise.all(toDelete.map(k => env.FILES_KV.delete(k)));
  return jsonResp({ ok: true, deleted: toDelete.length });
}

export async function handleMove(req, env) {
  let body;
  try { body = await req.json(); } catch { return jsonResp({ error: "invalid JSON" }, 400); }

  const { keys, target } = body;
  if (!Array.isArray(keys) || !keys.length) return jsonResp({ error: "缺少要移动的文件" }, 400);
  // target can be null (root) or a folder key

  // Prevent moving a folder into itself or its own descendants
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

  const items = await Promise.all(keys.map(k => getOne(k, env)));
  const updated = [];
  for (const item of items) {
    if (!item) continue;
    item.parent = target || null;
    await env.FILES_KV.put(item.key, JSON.stringify(item));
    updated.push(item.key);
  }

  return jsonResp({ ok: true, moved: updated.length });
}
