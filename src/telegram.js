import { TG_PUBLIC, DL_RETRY } from "./constants.js";
import { sleep } from "./utils.js";

export async function tgFileUrl(fileId, env) {
  try {
    const r = await fetch(`${TG_PUBLIC}/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`)
                .then(r => r.json());
    if (!r.ok) {
      const desc = r.description || "未知错误";
      return { error: desc };
    }
    if (!r.result?.file_path) return { error: "getFile 返回无效" };
    return { url: `${TG_PUBLIC}/file/bot${env.TELEGRAM_BOT_TOKEN}/${r.result.file_path}` };
  } catch (e) {
    return { error: "连接失败: " + e.message };
  }
}

export async function tgFileUrlWithRetry(fileId, env, retries = 2) {
  for (let i = 0; i < retries; i++) {
    const res = await tgFileUrl(fileId, env);
    if (res.url) return res;
    if (i < retries - 1) await sleep(1000);
  }
  return await tgFileUrl(fileId, env);
}

export const tgSend = (chatId, text, env) =>
  fetch(`${TG_PUBLIC}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  }).catch(() => {});

export async function tgSendDoc(chatId, file, fileName, env) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", file, fileName);
  try {
    const resp = await fetch(`${TG_PUBLIC}/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`, { method: "POST", body: form });
    const body = await resp.text();
    try { return JSON.parse(body); }
    catch { return { ok: false, description: `非 JSON (HTTP ${resp.status}): ${body.slice(0, 200)}` }; }
  } catch (e) {
    return { ok: false, description: "连接失败: " + e.message };
  }
}

export async function fetchWithRetry(url, rangeHeader, retries = DL_RETRY) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, rangeHeader ? { headers: { Range: rangeHeader } } : {});
      if (res.ok || res.status === 206) return res;
      if (res.status === 416) throw new Error("Range Not Satisfiable");
      lastErr = new Error("HTTP " + res.status);
    } catch (e) {
      lastErr = e;
      if (e.message === "Range Not Satisfiable") throw e;
    }
    if (i < retries - 1) await sleep(600 * 2 ** i);
  }
  throw lastErr;
}

/** Concurrently resolve all chunk TG URLs */
export async function resolveChunkUrls(ids, env) {
  const results = await Promise.all(ids.map(id => tgFileUrlWithRetry(id, env)));
  for (let i = 0; i < results.length; i++) {
    if (!results[i].url)
      throw new Error(`第 ${i + 1} 片 URL 解析失败：${results[i].error || "未知"}`);
  }
  return results.map(r => r.url);
}
