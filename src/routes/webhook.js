import { DEDUP_TTL } from "../constants.js";
import { getAllFiles, getOne } from "../kv.js";
import { genKey, fmtSize, txt } from "../utils.js";
import { tgSend } from "../telegram.js";

export async function handleWebhook(req, env, ctx) {
  if (env.WEBHOOK_SECRET && req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET)
    return txt("Unauthorized", 401);

  let body;
  try { body = await req.json(); } catch { return txt("ok"); }
  const msg = body.message || body.channel_post;
  if (!msg) return txt("ok");

  const chatId   = msg.chat.id;
  if (String(chatId) !== env.CHAT_ID) return txt("ok");

  const dedupKey = "dedup_" + body.update_id;
  if (await env.FILES_KV.get(dedupKey)) return txt("ok");
  // Best-effort dedup: Telegram webhooks per chat are sequential, but cross-chat races are possible
  await env.FILES_KV.put(dedupKey, "1", { expirationTtl: DEDUP_TTL });

  const cap = (msg.caption || "").trim();
  let fileId = null, fileName = "", size = 0, mimeType = "";

  const pick = (src, defName, defMime) => {
    fileId = src.file_id; size = src.file_size || 0; mimeType = src.mime_type || defMime;
    fileName = (cap && cap.includes(".")) ? cap : (src.file_name || defName);
  };

  if      (msg.document)    pick(msg.document,  "file_"      + msg.document.file_unique_id,     "");
  else if (msg.video)       pick(msg.video,     "video_"     + msg.video.file_unique_id     + ".mp4", "video/mp4");
  else if (msg.audio)       pick(msg.audio,     "audio_"     + msg.audio.file_unique_id     + ".mp3", "audio/mpeg");
  else if (msg.animation)   pick(msg.animation, "animation_" + msg.animation.file_unique_id + ".gif", "image/gif");
  else if (msg.photo) {
    const ph = msg.photo[msg.photo.length - 1];
    fileId = ph.file_id; size = ph.file_size || 0; mimeType = "image/jpeg";
    fileName = (cap && cap.includes(".")) ? cap : "photo_" + ph.file_unique_id + ".jpg";
  } else if (msg.voice) {
    fileId = msg.voice.file_id; size = msg.voice.file_size || 0; mimeType = "audio/ogg";
    fileName = cap || "voice_" + msg.voice.file_unique_id + ".ogg";
  } else if (msg.video_note) {
    fileId = msg.video_note.file_id; size = msg.video_note.file_size || 0; mimeType = "video/mp4";
    fileName = cap || "videonote_" + msg.video_note.file_unique_id + ".mp4";
  } else if (msg.sticker) {
    fileId = msg.sticker.file_id; size = msg.sticker.file_size || 0; mimeType = "image/webp";
    fileName = cap || "sticker_" + msg.sticker.file_unique_id + ".webp";
  }

  if (fileId) {
    const key = genKey();
    await env.FILES_KV.put(key, JSON.stringify({
      key, fileId, fileName, size, mimeType,
      fromChat: chatId, msgId: msg.message_id,
      timestamp: Date.now(), downloads: 0,
    }));

    await tgSend(chatId,
      `✅ 已索引：${fileName}\n📦 ${fmtSize(size)}\n\n`
      + `🔗 ${env.BASE_LINK_URL}/file/${key}\n`
      + `👁 ${env.BASE_LINK_URL}/view/${key}\n🗑 /del ${key}`, env);
    return txt("ok");
  }

  const t = (msg.text || "").trim();
  if (t === "/start" || t === "/help") {
    await tgSend(chatId,
      `📂 TGDrive Bot\n\n📤 发送文件/图片/视频/音频 → 自动索引\n`
      + `🏷 发送时附 caption（如 report.pdf）可自定义文件名\n\n`
      + `📋 /list  — 最近 20 个文件\n🗑 /del <key>  — 删除文件\n\n`
      + `🌐 ${env.BASE_LINK_URL}`, env);
  } else if (t === "/list") {
    const files = await getAllFiles(env);
    if (!files.length) { await tgSend(chatId, "📭 暂无文件", env); return txt("ok"); }
    const lines = files.slice(0, 20).map((f, i) =>
      `${i+1}. ${f.fileName} [${fmtSize(f.size)}] ↓${f.downloads||0}\n   🔗 ${env.BASE_LINK_URL}/file/${f.key}`
    );
    await tgSend(chatId, `📋 最近 ${lines.length} 个（共 ${files.length}）：\n\n${lines.join("\n\n")}`, env);
  } else if (t.startsWith("/del ")) {
    const dk   = t.slice(5).trim();
    const info = await getOne(dk, env);
    if (!info) await tgSend(chatId, "❌ 未找到：" + dk, env);
    else { await env.FILES_KV.delete(dk); await tgSend(chatId, "🗑 已删除：" + info.fileName, env); }
  }
  return txt("ok");
}
