/** 列表左滑露出刪除（.swipe > .swipe-bg + 內容）。點其他地方收回。 */
export function swipeRows(root: HTMLElement) {
  let row: HTMLElement | null = null, x0 = 0, y0 = 0, dx = 0, horiz: boolean | null = null;
  const content = (r: HTMLElement) => r.lastElementChild as HTMLElement;
  const closeAll = (except?: HTMLElement) => root.querySelectorAll<HTMLElement>(".swipe.open").forEach((r) => { if (r !== except) { r.classList.remove("open"); content(r).style.transform = ""; } });
  const start = (e: TouchEvent) => {
    const r = (e.target as Element).closest(".swipe") as HTMLElement | null;
    if (!r || (e.target as Element).closest("input,.tg,[data-drag]")) { if (!r) closeAll(); row = null; return; }
    row = r; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; horiz = null; closeAll(r);
  };
  const move = (e: TouchEvent) => {
    if (!row) return;
    const ddx = e.touches[0].clientX - x0, ddy = e.touches[0].clientY - y0;
    if (horiz == null && (Math.abs(ddx) > 8 || Math.abs(ddy) > 8)) horiz = Math.abs(ddx) > Math.abs(ddy);
    if (!horiz) return;
    e.preventDefault();
    dx = Math.min(0, Math.max(-110, ddx + (row.classList.contains("open") ? -92 : 0)));
    content(row).style.transition = "none"; content(row).style.transform = `translateX(${dx}px)`;
  };
  const end = () => {
    if (!row || !horiz) { row = null; return; }
    const c = content(row); c.style.transition = "";
    const open = dx < -50; row.classList.toggle("open", open); c.style.transform = open ? "translateX(-92px)" : "";
    row = null;
  };
  root.addEventListener("touchstart", start, { passive: true });
  root.addEventListener("touchmove", move, { passive: false });
  root.addEventListener("touchend", end);
  return () => { root.removeEventListener("touchstart", start); root.removeEventListener("touchmove", move); root.removeEventListener("touchend", end); };
}
