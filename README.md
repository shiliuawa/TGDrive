# TGDrive

一个基于 Telegram 的个人云盘，部署在 Cloudflare Workers 上。

## 原理

利用 Telegram Bot API 的 `sendDocument` 接口将文件存储到 Telegram 群组中，通过 Cloudflare KV 记录文件索引。上传下载走 Worker，文件本体存在 Telegram 的 CDN 上。

```
浏览器 ──上传──▶ CF Worker ──sendDocument──▶ Telegram 群组
浏览器 ──下载──▶ CF Worker ──getFile──▶ Telegram CDN ──流式传输──▶ 浏览器
```

## 部署

### 前置条件

- Cloudflare 账号
- Telegram Bot Token（通过 [@BotFather](https://t.me/BotFather) 创建）
- 一个 Telegram 群组或频道（用于存储文件）

### 步骤

1. **Clone 仓库**

   ```bash
   git clone https://github.com/你的用户名/TGDrive.git
   cd TGDrive
   ```

2. **创建 KV 命名空间**

   ```bash
   npx wrangler kv:namespace create FILES_KV
   ```

   将返回的 ID 填入 `.env` 的 `KV_ID`，同时填入 `wrangler.toml` 的 `kv_namespaces[0].id`。

3. **配置 `.env`**

   ```env
   KV_ID=你的KV命名空间ID
   CHAT_ID=你的Telegram群组ID（如 -1001234567890）
   BASE_LINK_URL=你的Worker域名（如 https://tgdrive.example.com）
   ```

4. **设置 Secrets**

   ```bash
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put WEB_PASSWORD
   ```

   按照提示输入值。

5. **部署**

   ```bash
   npx wrangler deploy
   ```

6. **访问**

   打开 Worker 域名，输入 `WEB_PASSWORD` 登录即可使用。

## 主要功能

- 文件上传/下载/分享
- 在线预览（图片、视频、音频、PDF、文本）
- 目录管理
- 加密存储（AES-256-GCM，客户端加密）
- 短链接分享
- 公开上传（令牌鉴权）
- 到期时间/下载次数限制
- Telegram Bot 指令管理

## 项目结构

```
src/
  index.js        — 入口 + 路由
  constants.js    — 常量配置
  auth.js         — 认证
  kv.js           — KV 操作
  telegram.js     — Telegram API 封装
  utils.js        — 工具函数
  ui.js           — UI 模板
  routes/
    login.js      — 登录
    upload.js     — 上传
    list.js       — 文件列表
    download.js   — 下载
    preview.js    — 预览
    stream.js     — 流式播放
    manage.js     — 删除/重命名
    webhook.js    — Webhook 自动索引
    folders.js    — 目录管理
    batch.js      — 批量操作
    shortlink.js  — 短链接
    public_upload.js — 公开上传
    crypto_utils.js  — 加密工具
    debug.js      — 调试页面
```

## 环境变量

参见 `.env` 和 `wrangler.toml`。
