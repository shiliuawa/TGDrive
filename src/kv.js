import { KV_BATCH } from "./constants.js";

export async function kvListAll(env) {
  const keys = [];
  let cursor;
  do {
    const r = await env.FILES_KV.list({ limit: 1000, cursor });
    keys.push(...r.keys);
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  return keys;
}

export async function kvBatchGet(keys, env) {
  const out = [];
  for (let i = 0; i < keys.length; i += KV_BATCH) {
    const vals = await Promise.all(
      keys.slice(i, i + KV_BATCH).map(k => env.FILES_KV.get(k.name))
    );
    for (const v of vals) {
      if (!v) continue;
      try { out.push(JSON.parse(v)); } catch {}
    }
  }
  return out;
}

export async function getAllFiles(env) {
  const keys = (await kvListAll(env)).filter(k => k.name.startsWith("f_"));
  return (await kvBatchGet(keys, env)).sort((a, b) => b.timestamp - a.timestamp);
}

export async function getOne(key, env) {
  const raw = await env.FILES_KV.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Download counter increment */
export async function incDownloads(key, env) {
  try {
    const info = await getOne(key, env);
    if (!info) return;
    info.downloads = (info.downloads || 0) + 1;
    await env.FILES_KV.put(info.key, JSON.stringify(info));
  } catch {}
}

/** Returns null if accessible, or { msg, status } if denied */
export function checkAccess(info) {
  if (info.expires && Date.now() > info.expires)
    return { msg: "🔒 链接已过期", status: 410 };
  if (info.maxDl != null && (info.downloads || 0) >= info.maxDl)
    return { msg: `🔒 已达下载次数上限（${info.maxDl} 次）`, status: 403 };
  return null;
}
