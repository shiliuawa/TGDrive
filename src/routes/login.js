import { authed, checkRateLimit, recordFailedLogin, clearRateLimit, makeAuthToken } from "../auth.js";
import { htmlResp, esc, redir } from "../utils.js";
import { layout, ic, I } from "../ui.js";

export async function handleRoot(req, env, url) {
  if (await authed(req, env)) return redir("/upload");
  const EC = url.searchParams.get("err");
  const errMsg = EC === "1" ? "密码错误，请重试"
               : EC === "2" ? "登录过于频繁，请 15 分钟后再试" : "";
  const body = `<div class="page sm vcenter">
    <div style="text-align:center;margin-bottom:40px">
      <div class="login-logo" style="font-family:var(--mono);font-size:2.8rem;font-weight:800;letter-spacing:-2px;line-height:1">TG<em style="color:var(--ac);font-style:normal">Drive</em></div>
      <p class="sub mt4" style="font-size:.88rem">基于 Telegram 的私有云盘</p>
    </div>
    <div class="Box" style="padding:24px">
      ${errMsg ? `<div class="flash flash-err" style="margin-bottom:18px">${ic(I.warn)}<span>${esc(errMsg)}</span></div>` : ""}
      <form method="POST" action="/login">
        <div class="field">
          <label>${ic(I.lock)} 访问密码</label>
          <input class="inp" type="password" name="pw" placeholder="输入密码" autofocus required>
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center">进入</button>
      </form>
    </div>
  </div>`;
  return htmlResp(layout("登录", "", body));
}

export async function handleLogin(req, env) {
  const ip = req.headers.get("CF-Connecting-IP")
    || req.headers.get("X-Forwarded-For")?.split(",")[0].trim()
    || "unknown";

  const rl = await checkRateLimit(ip, env);
  if (rl.blocked) return redir("/?err=2");

  const fd = await req.formData();
  if ((fd.get("pw") || "") !== env.WEB_PASSWORD) {
    await recordFailedLogin(ip, env);
    return redir("/?err=1");
  }

  await clearRateLimit(ip, env);
  const token = await makeAuthToken(env);
  return new Response(null, {
    status: 302,
    headers: {
      Location:    "/upload",
      "Set-Cookie": `TGD_AUTH=${token}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=2592000`,
    },
  });
}
