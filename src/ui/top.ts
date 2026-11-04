/** 頂部列的共用片段 */
import { back } from "../router";
import { esc } from "./dom";
import { ic } from "./icons";

export const backBtn = (label = "返回", fallback = "/") => `<button class="back" type="button" data-back="${esc(fallback)}" aria-label="返回${esc(label)}">${ic("chevl")}<span>${esc(label)}</span></button>`;
export const title = (t: string, eyebrow = "") => `<div class="ttl">${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ""}<h1 class="h1">${t}</h1></div>`;
export const centerTitle = (t: string) => `<div class="ttl"><h1 class="h1" style="font-size:18px;text-align:center">${t}</h1></div>`;
if (typeof document !== "undefined") document.addEventListener("click", (e) => { const b = (e.target as Element).closest?.("[data-back]") as HTMLElement | null; if (b) { e.preventDefault(); back(b.dataset.back || "/"); } });
