/** 面板（手機底部、桌面置中或右側）、確認對話框、toast。 */
import { h } from "./dom";
import { ic } from "./icons";

export type Sheet = { el: HTMLElement; body: HTMLElement; close: () => void };
let stack: Sheet[] = [];

export function openSheet(title: string, html: string, opt: { side?: boolean; onClose?: () => void; wide?: boolean } = {}): Sheet {
  const scrim = h(`<div class="scrim ${opt.side ? "side" : ""}" role="dialog" aria-modal="true" aria-label="${title}">
    <div class="sheet" ${opt.wide ? 'style="max-width:720px"' : ""}><div class="grab" aria-hidden="true"></div>
      <div class="sheet-h"><h2 class="h2">${title}</h2><button class="ibtn bare" data-close aria-label="關閉">${ic("x")}</button></div>
      <div class="sheet-b">${html}</div></div></div>`);
  document.body.appendChild(scrim);
  const prevFocus = document.activeElement as HTMLElement | null;
  const close = () => {
    scrim.remove(); stack = stack.filter((s) => s.el !== scrim);
    document.removeEventListener("keydown", key);
    opt.onClose?.(); prevFocus?.focus?.();
  };
  const key = (e: KeyboardEvent) => { if (e.key === "Escape" && stack.at(-1)?.el === scrim) close(); };
  document.addEventListener("keydown", key);
  scrim.addEventListener("click", (e) => { if (e.target === scrim || (e.target as Element).closest("[data-close]")) close(); });
  // 手機：從把手往下拖關閉
  const sheet = scrim.querySelector(".sheet") as HTMLElement;
  let y0: number | null = null;
  sheet.querySelector(".grab")!.addEventListener("pointerdown", (e) => { y0 = (e as PointerEvent).clientY; });
  window.addEventListener("pointerup", (e) => { if (y0 != null && e.clientY - y0 > 60) close(); y0 = null; }, { once: false });
  const s: Sheet = { el: scrim, body: scrim.querySelector(".sheet-b") as HTMLElement, close };
  stack.push(s);
  setTimeout(() => (scrim.querySelector("input,button:not([data-close])") as HTMLElement | null)?.focus?.({ preventScroll: true }), 30);
  return s;
}
export const closeAllSheets = () => [...stack].forEach((s) => s.close());

export function confirmDialog(title: string, body: string, ok = "確定", danger = false): Promise<boolean> {
  return new Promise((res) => {
    const el = h(`<div class="scrim" role="alertdialog" aria-modal="true"><div class="dialog"><h2 class="h2">${title}</h2><p class="sm mu">${body}</p>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn g" data-no>取消</button><button class="btn ${danger ? "d" : "p"}" data-yes>${ok}</button></div></div></div>`);
    document.body.appendChild(el);
    const done = (v: boolean) => { el.remove(); res(v); };
    el.addEventListener("click", (e) => { const t = e.target as Element; if (t === el || t.closest("[data-no]")) done(false); else if (t.closest("[data-yes]")) done(true); });
    (el.querySelector("[data-yes]") as HTMLElement).focus();
  });
}

let toastEl: HTMLElement | null = null, toastT = 0;
export function toast(msg: string, opt: { action?: string; onAction?: () => void; ms?: number; kind?: "ok" | "err" } = {}) {
  toastEl?.remove();
  toastEl = h(`<div class="toast" role="status" ${opt.kind === "err" ? 'style="border-color:var(--cut)"' : ""}>${opt.kind === "err" ? `<span style="color:var(--cut)">${ic("warn", "s")}</span>` : `<span style="color:var(--ac)">${ic("check", "s")}</span>`}<span>${msg}</span>${opt.action ? `<button class="btn sm o">${opt.action}</button>` : ""}</div>`);
  document.body.appendChild(toastEl);
  toastEl.querySelector("button")?.addEventListener("click", () => { opt.onAction?.(); toastEl?.remove(); });
  clearTimeout(toastT);
  const el = toastEl;
  toastT = window.setTimeout(() => el.remove(), opt.ms ?? 3200);
}
