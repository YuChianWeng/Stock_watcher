// 由 design/icon.svg 產生 PNG 圖示（用預裝的 Playwright Chromium）：node scripts/icons.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const svg = readFileSync("design/icon.svg", "utf8");
const out = [["public/icon-192.png", 192, 0], ["public/icon-512.png", 512, 0], ["public/apple-touch-icon.png", 180, 0], ["public/favicon-64.png", 64, 0], ["public/icon-maskable-512.png", 512, 0.1]];
const b = await chromium.launch();
for (const [path, size, pad] of out) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  const inner = Math.round(size * (1 - pad * 2));
  // maskable：滿版底色＋安全區內的圖示；apple-touch：iOS 會自己裁圓角，所以不留透明角
  const bg = pad || path.includes("apple") ? "#05070D" : "transparent";
  await p.setContent(`<html><body style="margin:0;background:${bg};display:grid;place-items:center;width:${size}px;height:${size}px">${svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</body></html>`);
  await p.screenshot({ path, omitBackground: bg === "transparent" });
  await p.close();
}
await b.close();
console.log("icons ok");
