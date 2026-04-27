export const KV_BATCH       = 50;
export const DEDUP_TTL      = 86400;
export const CHUNK_SIZE     = 19.5 * 1024 * 1024; // 19.5 MB
export const MAX_TG_SIZE    = 20   * 1024 * 1024;
export const CONCURRENCY    = 3;
export const DL_RETRY       = 3;
export const TEXT_PREVIEW   = 102400; // 100 KB
export const LOGIN_MAX      = 5;
export const LOGIN_LOCK     = 900;   // 15 min
export const PARALLEL_DL_MAX= 80 * 1024 * 1024; // 80 MB
export const DL_CONCURRENCY = 4;
export const TG_PUBLIC      = "https://api.telegram.org";

export const PREVIEW_TYPES = {
  img:   new Set(["png","jpg","jpeg","gif","webp","svg","bmp"]),
  video: new Set(["mp4","webm","mov"]),
  audio: new Set(["mp3","wav","ogg","flac","m4a"]),
  pdf:   new Set(["pdf"]),
  text:  new Set(["txt","md","json","csv","xml","yaml","yml","log","js","ts","css","html"]),
};
