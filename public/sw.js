/*
 * 看盤 service worker（契約 §6.2、§6.4）
 * - scope /stocks/。快取 App shell（頁面與靜態檔），先走網路、離線時回快取。
 * - /api/watch/* 不經過 service worker 快取（資料新鮮度由前端管理，前端用 IndexedDB 保留最後資料）。
 * - push：無論如何都要 showNotification（否則 Safari 會撤銷權限）。
 * - notificationclick：App 已開著就聚焦並 postMessage 導向，否則開新視窗。
 */
const VERSION = "stocks-v1";
const SHELL = `${VERSION}-shell`;
const BASE = "/stocks/";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll([BASE, BASE + "manifest.webmanifest", BASE + "icon.svg", BASE + "icon-192.png", BASE + "apple-touch-icon.png"]).catch(() => {})));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// 新版本在背景下載；前端提示「有新版本，重新開啟套用」，下次開啟時生效
self.addEventListener("message", (e) => { if (e.data === "skip-waiting") self.skipWaiting(); });

async function shellNetworkFirst(req) {
  const cache = await caches.open(SHELL);
  const key = req.mode === "navigate" ? BASE : req;
  try {
    const res = await fetch(req);
    if (res.ok && res.type === "basic" && !res.redirected) cache.put(key, res.clone());
    return res;
  } catch (err) {
    return (await cache.match(key)) || Promise.reject(err);
  }
}
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith(BASE) && !url.pathname.endsWith("/sw.js")) e.respondWith(shellNetworkFirst(req));
});

self.addEventListener("push", (e) => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch { p = {}; }
  const title = typeof p.title === "string" && p.title ? p.title : "看盤警報";
  const opts = {
    body: typeof p.body === "string" ? p.body : "有新的警報通知",
    tag: typeof p.tag === "string" ? p.tag : undefined,
    renotify: !!p.tag,
    icon: BASE + "icon-192.png",
    badge: BASE + "icon-192.png",
    data: { url: typeof p.url === "string" && p.url.startsWith(BASE) ? p.url : BASE + "inbox" },
  };
  e.waitUntil(Promise.all([
    self.registration.showNotification(title, opts),
    self.clients.matchAll({ type: "window" }).then((cs) => cs.forEach((c) => c.postMessage({ type: "unread" }))),
  ]));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || BASE;
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const c = cs.find((x) => new URL(x.url).pathname.startsWith(BASE));
    if (c) { await c.focus(); c.postMessage({ type: "navigate", url }); return; }
    await self.clients.openWindow(url);
  })());
});

// 訂閱被瀏覽器更換或撤銷：通知開著的 App，下次開啟時提示重新啟用
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => cs.forEach((c) => c.postMessage({ type: "push-changed" }))));
});
