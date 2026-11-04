/** 極簡 DOM 工具 */
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T | null;
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll(sel)] as T[];
export function h(html: string): HTMLElement { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild as HTMLElement; }
/** 事件委派：on(root, "click", "[data-act]", (el, e) => …) */
export function on<K extends keyof HTMLElementEventMap>(root: HTMLElement | Document, type: K, sel: string, fn: (el: HTMLElement, e: HTMLElementEventMap[K]) => void) {
  const l = (e: Event) => { const t = (e.target as Element)?.closest?.(sel) as HTMLElement | null; if (t && (root as Node).contains(t)) fn(t, e as HTMLElementEventMap[K]); };
  root.addEventListener(type, l as EventListener);
  return () => root.removeEventListener(type, l as EventListener);
}
export const isWide = () => matchMedia("(min-width: 960px)").matches;
export const isThreeCol = () => matchMedia("(min-width: 1180px)").matches;
