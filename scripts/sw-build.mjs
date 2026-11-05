// 產生 dist/sw.js：把 public/sw.js 的 __BUILD_ID__ 與 SHELL_FILES 換成這次建置的值（issue #3）
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** 不放進 shell 預先快取的檔案 */
const SKIP = /(^|\/)(sw\.js|.*\.map|stats\.html)$/;

export function listFiles(dir) {
  const out = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else out.push(relative(dir, p).split(sep).join("/")); } };
  walk(dir);
  return out.sort();
}

/** build id = 所有輸出檔（不含 sw.js）內容的 sha256 前 12 碼：內容不變則 id 不變 */
export function buildIdOf(dir, files) {
  const h = createHash("sha256");
  for (const f of files) { h.update(f); h.update("\0"); h.update(readFileSync(join(dir, f))); h.update("\0"); }
  return h.digest("hex").slice(0, 12);
}

export function renderSw(src, buildId, files) {
  if (!src.includes("__BUILD_ID__") || !src.includes("/*__SHELL_FILES__*/[]")) throw new Error("sw.js placeholders missing");
  return src.replace("__BUILD_ID__", buildId).replace("/*__SHELL_FILES__*/[]", JSON.stringify(files));
}

export function writeSw(outDir) {
  const swPath = join(outDir, "sw.js");
  const files = listFiles(outDir).filter((f) => !SKIP.test(f) && f !== "index.html");
  const id = buildIdOf(outDir, [...files, "index.html"]);
  writeFileSync(swPath, renderSw(readFileSync(swPath, "utf8"), id, files));
  return { id, files };
}
