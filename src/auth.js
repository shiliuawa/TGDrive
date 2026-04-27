import { LOGIN_MAX, LOGIN_LOCK } from "./constants.js";

async function getSignKey(env) {
  const secret = env.COOKIE_SECRET || (env.WEB_PASSWORD + "_tgdrive_v2");
  return crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
}

async function makeToken(env) {
  const key = await getSignKey(env);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("auth:" + env.WEB_PASSWORD));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export async function authed(req, env) {
  const m = (req.headers.get("Cookie") || "").match(/TGD_AUTH=([^;]+)/);
  if (!m) return false;
  return m[1] === (await makeToken(env));
}

function getClientIP(req) {
  return req.headers.get("CF-Connecting-IP")
    || req.headers.get("X-Forwarded-For")?.split(",")[0].trim()
    || "unknown";
}

export async function checkRateLimit(ip, env) {
  const raw = await env.FILES_KV.get("rl_" + ip);
  if (!raw) return { blocked: false, count: 0 };
  const d = JSON.parse(raw);
  if (d.until && Date.now() < d.until) return { blocked: true };
  return { blocked: false, count: d.count || 0 };
}

export async function recordFailedLogin(ip, env) {
  const key  = "rl_" + ip;
  const raw  = await env.FILES_KV.get(key);
  const prev = raw ? JSON.parse(raw) : { count: 0 };
  const count = (prev.count || 0) + 1;
  const value = count >= LOGIN_MAX
    ? { count, until: Date.now() + LOGIN_LOCK * 1000 }
    : { count };
  await env.FILES_KV.put(key, JSON.stringify(value), { expirationTtl: LOGIN_LOCK });
}

export async function clearRateLimit(ip, env) {
  await env.FILES_KV.delete("rl_" + ip);
}

/** Returns the signed cookie token — used at login */
export async function makeAuthToken(env) {
  return makeToken(env);
}
