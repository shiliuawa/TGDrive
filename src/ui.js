import { esc } from "./utils.js";
import { CHUNK_SIZE, CONCURRENCY, DL_CONCURRENCY, PARALLEL_DL_MAX } from "./constants.js";

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">`;

const CSS = `<style>
:root {
  --bg: #0d1117;
  --bg-card: #151b23;
  --bg-subtle: #161b22;
  --bg-input: #010409;
  --bg-btn: #21262d;
  --bg-btn-hover: #30363d;
  --bd: #30363d;
  --bd-muted: #21262d;
  --fg: #e6edf3;
  --fg-muted: #8b949e;
  --fg-subtle: #6e7681;
  --ac: #58a6ff;
  --ac-emphasis: #1f6feb;
  --gn: #3fb950;
  --rd: #f85149;
  --yn: #d29922;
  --pri-bg: #238636;
  --pri-hover: #2ea043;
  --r: 6px;
  --mono: 'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;
  --sans: -apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0}
::selection{background:rgba(88,166,255,.3);color:#fff}
body{font-family:var(--sans);background:var(--bg);color:var(--fg);min-height:100vh;line-height:1.5}
a{color:var(--ac);text-decoration:none}
a:hover{text-decoration:underline;color:#79c0ff}
input,button,select,textarea{font-family:inherit}

/* Navigation */
.nav{display:flex;align-items:center;gap:12px;padding:0 24px;height:64px;background:var(--bg-subtle);border-bottom:1px solid var(--bd-muted);position:sticky;top:0;z-index:100}
.logo{font-weight:700;font-size:1rem;color:var(--fg);letter-spacing:-.3px}
.logo em{color:var(--ac);font-style:normal}
.nbadge{font-size:.68rem;padding:1px 8px;border-radius:20px;background:rgba(88,166,255,.12);color:var(--ac);border:1px solid rgba(88,166,255,.25);font-weight:500;line-height:1.6}
.nlinks{display:flex;gap:4px;margin-left:auto}
.nlinks a{display:flex;align-items:center;gap:6px;padding:8px 12px;border-radius:var(--r);font-size:.875rem;color:var(--fg-muted);font-weight:500;transition:background .12s,color .12s}
.nlinks a:hover,.nlinks a.on{background:rgba(177,186,196,.12);color:var(--fg);text-decoration:none}
.nlinks a svg{width:16px;height:16px}

/* Layout */
.page{max-width:960px;margin:0 auto;padding:32px 24px}
.page-sm{max-width:480px;margin:0 auto}
.vcenter{display:flex;flex-direction:column;justify-content:center;min-height:calc(100vh - 64px)}

/* Box container (GitHub-style) */
.Box{background:var(--bg-card);border:1px solid var(--bd);border-radius:8px;overflow:hidden}
.Box-header{padding:16px;background:var(--bg-subtle);border-bottom:1px solid var(--bd-muted);display:flex;align-items:center;gap:8px}
.Box-body>:last-child>:last-child{border-bottom:none}

/* Stats bar */
.stats{display:flex;border:1px solid var(--bd);border-radius:8px;overflow:hidden;margin-bottom:24px}
.stat-item{flex:1;padding:16px 20px;background:var(--bg-card);border-right:1px solid var(--bd-muted);min-width:100px}
.stat-item:last-child{border-right:none}
.stat-item .num{font-size:1.5rem;font-weight:600;font-family:var(--mono);color:var(--fg);line-height:1.2}
.stat-item .lbl{font-size:.75rem;color:var(--fg-muted);margin-top:4px}

/* Buttons */
.btn{display:inline-flex;align-items:center;gap:6px;padding:5px 16px;font-size:.875rem;font-weight:500;line-height:1.5;border-radius:var(--r);border:1px solid;cursor:pointer;text-decoration:none;white-space:nowrap;transition:background .12s,border-color .12s;font-family:inherit;color:var(--fg)}
.btn:hover{text-decoration:none}
.btn svg{width:16px;height:16px;flex-shrink:0}
.btn-default{background:var(--bg-btn);border-color:rgba(240,246,252,.1)}.btn-default:hover{background:var(--bg-btn-hover)}
.btn-primary{background:var(--pri-bg);border-color:rgba(240,246,252,.1);color:#fff}.btn-primary:hover{background:var(--pri-hover)}
.btn-danger{background:transparent;border-color:rgba(248,81,73,.3);color:var(--rd)}.btn-danger:hover{background:rgba(248,81,73,.1)}
.btn:disabled{opacity:.4;cursor:not-allowed}
.btn-sm{padding:3px 10px;font-size:.78rem}.btn-sm svg{width:14px;height:14px}
.btn-lg{padding:9px 20px;font-size:.9rem}

/* Forms */
.field{margin-bottom:16px}
.field label{display:block;font-size:.75rem;color:var(--fg-muted);margin-bottom:6px;font-weight:500}
.inp{width:100%;padding:8px 12px;background:var(--bg-input);border:1px solid var(--bd);border-radius:var(--r);color:var(--fg);font-size:.875rem;outline:none;transition:border .15s,box-shadow .15s}
.inp:focus{border-color:var(--ac);box-shadow:0 0 0 3px rgba(88,166,255,.15)}
.inp::placeholder{color:var(--fg-subtle)}

/* Table */
.tbl{width:100%;border-collapse:collapse}
.tbl th{padding:8px 16px;text-align:left;font-size:.75rem;font-weight:600;color:var(--fg-muted);border-bottom:1px solid var(--bd-muted);background:var(--bg-subtle)}
.tbl td{padding:10px 16px;border-bottom:1px solid var(--bd-muted);vertical-align:middle}
.tbl tr td{transition:background .12s}
.tbl tr:hover td{background:rgba(177,186,196,.06)}
.tbl .srt{color:var(--fg-muted);text-decoration:none}.tbl .srt:hover{color:var(--fg);text-decoration:none}
.tbl .srt.on{color:var(--fg)}

/* Flash messages */
.flash{padding:12px 16px;border-radius:var(--r);font-size:.875rem;display:flex;align-items:flex-start;gap:10px}
.flash svg{width:16px;height:16px;flex-shrink:0;margin-top:1px}
.flash-err{background:rgba(248,81,73,.1);border:1px solid rgba(248,81,73,.3);color:#ff7b72}
.flash-ok{background:rgba(63,185,80,.1);border:1px solid rgba(63,185,80,.3);color:#7ee787}
.flash-warn{background:rgba(210,153,34,.1);border:1px solid rgba(210,153,34,.3);color:var(--yn)}

/* Tags */
.Tag{display:inline-flex;align-items:center;padding:0 8px;height:20px;border-radius:20px;font-size:.68rem;font-weight:500;border:1px solid;line-height:1}
.Tag-default,.tag-gray{color:var(--fg-muted);background:var(--bg-subtle);border-color:var(--bd)}
.Tag-warning,.tag-warn{color:var(--yn);background:rgba(210,153,34,.1);border-color:rgba(210,153,34,.3)}
.Tag-danger{color:var(--rd);background:rgba(248,81,73,.1);border-color:rgba(248,81,73,.3)}

/* Utilities */
.mono{font-family:var(--mono);font-size:.82rem}
.sub{color:var(--fg-muted)}
.flex{display:flex;align-items:center;gap:8px}
.mt4{margin-top:4px}.mt8{margin-top:8px}.mt12{margin-top:12px}.mt16{margin-top:16px}.mt24{margin-top:24px}

/* Dropzone */
#drop{border:2px dashed var(--bd);border-radius:8px;padding:48px 24px;cursor:pointer;transition:border-color .2s,background .2s;text-align:center}
#drop:hover,#drop.over{border-color:var(--ac);background:rgba(88,166,255,.05)}
#drop svg{display:block;margin:0 auto 12px;opacity:.35}

/* Progress */
.pbar-wrap{height:6px;background:var(--bd-muted);border-radius:8px;overflow:hidden}
.pbar{height:100%;width:0;background:linear-gradient(90deg,var(--pri-bg),var(--gn));border-radius:8px;transition:width .15s}

/* Chunk grid */
.chunk-grid{display:flex;gap:4px;flex-wrap:wrap;margin-top:12px}
.chunk-cell{width:14px;height:14px;border-radius:3px;background:var(--bd-muted);transition:background .2s}
.chunk-cell.uploading{background:rgba(88,166,255,.45)}
.chunk-cell.done{background:var(--gn)}
.chunk-cell.error{background:var(--rd)}

/* Modal */
.Modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:200;align-items:center;justify-content:center}
.Modal.open{display:flex}
.Modal-box{background:var(--bg-card);border:1px solid var(--bd);border-radius:8px;padding:24px;width:90%;max-width:420px;box-shadow:0 16px 32px rgba(0,0,0,.3)}
.Modal-title{font-size:1rem;font-weight:600;margin-bottom:16px;display:flex;align-items:center;gap:6px}
.Modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px;padding-top:16px;border-top:1px solid var(--bd-muted)}

/* Empty state */
.empty{padding:80px 20px;text-align:center}
.empty svg{display:block;margin:0 auto 16px;opacity:.2}
.empty p{font-size:.875rem;color:var(--fg-muted)}

/* File view (preview) */
.fh{padding:16px;background:var(--bg-subtle);border-bottom:1px solid var(--bd-muted);display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
.fh-info{flex:1;min-width:0}
.fh-name{font-size:.875rem;font-weight:600;word-break:break-all}
.fh-meta{font-size:.75rem;color:var(--fg-muted);margin-top:2px}
.fh-actions{display:flex;gap:4px;flex-wrap:wrap}
.preview-box{line-height:0}.preview-box img,.preview-box video{max-width:100%}

/* Breadcrumb */
.bc{display:flex;align-items:center;gap:4px;font-size:.875rem;flex-wrap:wrap}
.bc a{color:var(--fg-muted)}.bc a:hover{color:var(--ac)}
.bc .sep{color:var(--fg-subtle);margin:0 2px}
.bc .cur{color:var(--fg);font-weight:600}

/* Action bar */
.abar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px}
.abar .sp{flex:1;min-width:120px}

/* Sortable header */
.srt{cursor:pointer}
/* Gallery nav */
.gal-nav{display:flex;gap:6px;justify-content:center;margin-bottom:12px;align-items:center}
</style>`;

export function ic(d, s = 16) {
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" `
    + `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
}

export const I = {
  up:   '<polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  dl:   '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  eye:  '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  del:  '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  srch: '<circle cx="11" cy="11" r="6"/><path d="M21 21l-4-4"/>',
  ok:   '<polyline points="20 6 9 17 4 12"/>',
  warn: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  tg:   '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
};

const navbar = (active) => `
<nav class="nav">
  <span class="logo">TG<em>Drive</em></span><span class="nbadge">v2.3</span>
  <div class="nlinks">
    <a href="/upload" class="${active === "up"   ? "on" : ""}">${ic(I.up)}   上传</a>
    <a href="/list"   class="${active === "list" ? "on" : ""}">${ic(I.list)} 文件</a>
  </div>
</nav>`;

export const layout = (title, active, body, foot = "") =>
  `<!DOCTYPE html><html lang="zh"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · TGDrive</title>${FONTS}${CSS}
</head><body>${navbar(active)}${body}${foot}</body></html>`;
