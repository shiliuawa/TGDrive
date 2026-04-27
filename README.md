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
   TELEGRAM_BOT_TOKEN=你的Bot Token
   WEB_PASSWORD=登录密码
   ```

4. **设置 Secrets**

   敏感变量通过 wrangler secret 写入，不出现在代码中：

   ```bash
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put WEB_PASSWORD
   ```

   按提示输入即可。

5. **部署**

   ```bash
   npx wrangler deploy
   ```

6. **访问**

   打开 Worker 域名，输入密码登录即可使用。

### 可选：配置 Webhook

设置 Telegram Webhook 后可自动索引发到群组的文件：

```bash
curl -F "url=https://你的域名/webhook" \
     -F "secret_token=你的WEBHOOK_SECRET" \
     https://api.telegram.org/bot<你的TOKEN>/setWebhook
```

## 配置说明

### 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `KV_ID` | 是 | KV 命名空间 ID |
| `CHAT_ID` | 是 | Telegram 群组 ID（如 `-1001234567890`） |
| `BASE_LINK_URL` | 是 | 部署后的公开访问地址 |
| `TELEGRAM_BOT_TOKEN` | 是 | Bot Token（建议 secret 方式） |
| `WEB_PASSWORD` | 是 | 登录密码（建议 secret 方式） |
| `COOKIE_SECRET` | 否 | Cookie 签名密钥，默认从 `WEB_PASSWORD` 派生 |
| `WEBHOOK_SECRET` | 否 | Webhook 验证密钥 |
| `MTPROXY_URL` | 否 | MTProto 下载代理地址，用于大文件加速 |

### 文件大小限制

- Telegram Bot API 单文件上限 50MB（通过 `sendDocument`）
- 大于 20MB 的文件会被分片上传（每片 ~19.5MB），下载时自动合并
- 超大单文件（>20MB、webhook 索引）通过 MTProto 代理下载

## 功能

- **文件管理**：上传、下载、删除、重命名、移动
- **在线预览**：图片、视频、音频、PDF、文本（前 100KB）
- **视频流播放**：分片视频支持 HLS m3u8 流式播放
- **目录管理**：虚拟文件夹，面包屑导航
- **文件分享**：生成分享链接，可选过期时间和下载次数限制
- **短链接**：自动生成 6 位短码，方便分享
- **公开上传**：生成令牌，允许他人无需登录上传文件
- **加密存储**：AES-256-GCM 客户端加密，密码派生密钥（PBKDF2）
- **批量操作**：批量设置过期时间、下载限制
- **Webhook 自动索引**：直接发文件到 Telegram 群组自动入库
- **Telegram Bot 指令**：`/list` 查看文件，`/del <key>` 删除

## 项目结构

```
src/
  index.js              — 入口 + 路由
  constants.js          — 常量配置（分片大小、预览类型等）
  auth.js               — 登录认证（HMAC-SHA256 Cookie）
  kv.js                 — KV 操作（CRUD、列表、权限检查）
  telegram.js           — Telegram Bot API 封装
  utils.js              — 工具函数
  ui.js                 — UI 模板（暗色主题 CSS + SVG 图标）
  routes/
    login.js            — 登录页面
    upload.js           — 文件上传（分片、并发）
    list.js             — 文件列表（排序、搜索、文件夹导航）
    download.js         — 文件下载（单文件直链、多分片流式合并）
    preview.js          — 在线预览（图片/视频/音频/PDF/文本）
    stream.js           — HLS 流式播放
    manage.js           — 删除、重命名
    webhook.js          — Telegram Webhook 自动索引
    folders.js          — 目录管理
    batch.js            — 批量操作
    shortlink.js        — 短链接生成与跳转
    public_upload.js    — 公开上传
    crypto_utils.js     — AES-256-GCM 客户端加密 JS
    debug.js            — KV 调试页面
```

## AI 辅助

本项目代码由 AI 辅助编写（基于 DeepSeek 模型）。

## 技术特点

- 零依赖，纯 ES Module Worker
- 客户端分片上传（19.5MB/片，3 并发）
- TransformStream 流式下载，支持 Range 断点续传
- 下载地址预解析 + 数据预取，消除分片播放卡顿
