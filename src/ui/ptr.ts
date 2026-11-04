/** 下拉更新（§8）。圖表區（.chart）內的拖曳不觸發。 */
import { ic } from "./icons";

export function pullToRefresh(root: HTMLElement, run: () => Promise<unknown>) {
  const ind = document.createElement("div");
  ind.className = "ptr";
  ind.innerHTML = `${ic("refresh", "s")}<span>下拉更新</span>`;
  root.prepend(ind);
  let y0: number | null = null, dy = 0, busy = false;
  const start = (e: TouchEvent) => {
    if (busy || window.scrollY > 0 || (e.target as Element).closest(".chart, .scrim, input, textarea")) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0;
  };
  const move = (e: TouchEvent) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    if (dy > 0 && window.scrollY <= 0) {
      const d = Math.min(90, dy * 0.5);
      ind.style.height = d + "px"; ind.style.opacity = String(Math.min(1, d / 60));
      ind.querySelector("span")!.textContent = d >= 60 ? "放開更新" : "下拉更新";
    }
  };
  const end = async () => {
    if (y0 == null) return;
    y0 = null;
    if (dy * 0.5 >= 60) {
      busy = true; ind.classList.add("busy"); ind.querySelector("span")!.textContent = "更新中…"; ind.style.height = "48px";
      try { await run(); } finally { busy = false; ind.classList.remove("busy"); }
    }
    ind.style.height = "0px"; ind.style.opacity = "0";
  };
  root.addEventListener("touchstart", start, { passive: true });
  root.addEventListener("touchmove", move, { passive: true });
  root.addEventListener("touchend", end);
  return () => { root.removeEventListener("touchstart", start); root.removeEventListener("touchmove", move); root.removeEventListener("touchend", end); ind.remove(); };
}
