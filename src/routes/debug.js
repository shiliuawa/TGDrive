import { kvListAll, kvBatchGet } from "../kv.js";
import { esc, htmlResp, txt } from "../utils.js";

export async function pageDebug(req, env) {
  const url      = new URL(req.url);
  const debugKey = env.COOKIE_SECRET || env.WEB_PASSWORD;
  if (url.searchParams.get("key") !== debugKey)
    return txt("403 Forbidden：需提供 ?key=<COOKIE_SECRET>", 403);

  // Raw JSON output (for scripting)
  if (url.searchParams.get("raw") === "1") {
    const keys = await kvListAll(env);
    const all  = await kvBatchGet(keys, env);
    return new Response(JSON.stringify(all, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const keys = await kvListAll(env);
  const all  = await kvBatchGet(keys, env);
  return htmlResp(`<html><body style="background:#0a0c10;color:#e6edf3;font-family:'JetBrains Mono',monospace;padding:24px">
    <pre style="font-size:.78rem;line-height:1.6;white-space:pre-wrap">${esc(JSON.stringify(all, null, 2))}</pre>
  </body></html>`);
}
