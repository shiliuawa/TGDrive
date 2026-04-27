import { redir, jsonResp, txt } from "../utils.js";
import { getOne } from "../kv.js";
import { checkAccess } from "../kv.js";

/**
 * Short link support.
 *
 * Generate: short link is returned alongside the regular link on upload commit.
 * KV: s_<code> → f_<uuid> (or just the file key)
 */

/** Generate a short code (base62 from random bytes) */
export function genShortCode() {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let result = "";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 6; i++) {
    result += chars[bytes[i] % 62];
  }
  return result;
}

/** Create a short link mapping in KV */
export async function createShortLink(fileKey, env) {
  const code = genShortCode();
  // Check for collision (very unlikely with 6 chars base62 = ~56B combinations)
  const existing = await env.FILES_KV.get("s_" + code);
  if (existing) return createShortLink(fileKey, env); // retry
  await env.FILES_KV.put("s_" + code, fileKey);
  return code;
}

/** Handle /s/<code> — redirect to the full file URL */
export async function handleShortLink(code, env, req) {
  if (!code) return txt("404 Not Found", 404);

  const fileKey = await env.FILES_KV.get("s_" + code);
  if (!fileKey) return txt("链接不存在或已过期", 404);

  const info = await getOne(fileKey, env);
  if (!info) return txt("文件不存在", 404);

  const deny = checkAccess(info);
  if (deny) return txt(deny.msg, deny.status);

  // Redirect to the file page
  return redir("/file/" + fileKey);
}
