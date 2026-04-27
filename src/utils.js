export const redir = (loc) => new Response(null, { status: 302, headers: { Location: loc } });

export const txt = (s, status = 200) => new Response(s, { status });

export const esc = (s) =>
  String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#x27;");

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export const genKey = () => "f_" + crypto.randomUUID().replace(/-/g, "");

export const extOf = (fn) => (fn.split(".").pop() || "").toLowerCase();

export function fmtSize(b) {
  if (!b) return "—";
  if (b < 1024)       return b + " B";
  if (b < 1048576)    return (b / 1024).toFixed(1)    + " KB";
  if (b < 1073741824) return (b / 1048576).toFixed(2) + " MB";
  return (b / 1073741824).toFixed(2) + " GB";
}

export const fmtDate = (ts) =>
  ts ? new Date(ts).toLocaleString("zh-CN", { hour12: false }) : "—";

export const fmtNum  = (n) =>
  n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n || 0);

export function htmlResp(body, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/html;charset=utf-8" } });
}

export function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

/** From file metadata, generate a TG message link */
export function tgMsgLink(info) {
  if (!info.msgId) return null;
  const cid = String(info.fromChat || "");
  return cid.startsWith("-100") ? `https://t.me/c/${cid.slice(4)}/${info.msgId}` : null;
}
