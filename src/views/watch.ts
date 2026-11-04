/** 自選清單管理（SPEC §6.4）：多份清單、搜尋新增、拖曳排序（儲存）、左滑刪除、顯示用排序。 */
import type { View } from "./types";
import type { Quote, SearchRow, Watchlist } from "../types";
import { api } from "../api/watch";
import { WatchError } from "../api/client";
import { Poller } from "../poll";
import { S, writable } from "../state";
import { empty, errorBox, qrow, skelRows } from "../ui/components";
import { esc, on } from "../ui/dom";
import { ic } from "../ui/icons";
import { confirmDialog, openSheet, toast } from "../ui/overlay";
import { title } from "../ui/top";
import { searchRows } from "../ui/search";
import { swipeRows } from "../ui/swipe";

type Sort = "custom" | "chg" | "sym" | "vol";
const SORTS: [Sort, string][] = [["custom", "自訂"], ["chg", "漲跌幅"], ["sym", "代號"], ["vol", "成交量"]];

const view: View = ({ el, setTop }) => {
  let lists: Watchlist[] | null = null, err = "", cur = "", sort: Sort = "custom", q = "", results: SearchRow[] = [], held = new Set<string>();
  setTop(title("自選") + `<button class="ibtn" type="button" data-act="lists" aria-label="管理清單">${ic("edit")}</button>`);
  const wl = () => lists?.find((w) => w.watchlist_id === cur) ?? lists?.[0];
  const total = () => lists?.reduce((a, w) => a + w.items.length, 0) ?? 0;
  const caps = () => S.boot?.capabilities ?? { max_watch_items: 200, max_watchlists: 10 };

  const draw = () => {
    if (!lists) { el.innerHTML = `<div class="narrow"><div class="card">${err ? errorBox(err) : skelRows(5)}</div></div>`; return; }
    const w = wl()!;
    el.innerHTML = `<div class="narrow stack">
      <div class="seg" role="tablist" aria-label="自選清單" style="align-self:flex-start">${lists.map((x) => `<button type="button" data-wl="${esc(x.watchlist_id)}" aria-pressed="${x === w}">${esc(x.name)} <span class="num mu">${x.items.length}</span></button>`).join("")}</div>
      <div class="field"><div style="position:relative"><input class="input" type="search" data-q placeholder="搜尋代號或名稱，加入「${esc(w.name)}」" value="${esc(q)}" style="padding-left:40px" autocomplete="off" aria-label="搜尋並加入自選" ${writable() ? "" : "disabled"}><span class="mu" style="position:absolute;left:12px;top:12px">${ic("search")}</span></div></div>
      <div data-res></div>
      <div class="between"><div class="seg" role="group" aria-label="排序">${SORTS.map(([k, t]) => `<button type="button" data-sort="${k}" aria-pressed="${sort === k}">${t}</button>`).join("")}</div><span class="xs mu">${sort === "custom" ? "拖曳 ⋮⋮ 排序，左滑刪除" : "顯示用排序，不會儲存"}</span></div>
      <div class="card flush list-card" data-items>${itemsHtml(w)}</div>
      <p class="xs mu" style="text-align:center">${total()} / ${caps().max_watch_items} 檔 · 清單 ${lists.length} / ${caps().max_watchlists}</p></div>`;
    drawRes();
  };
  const itemsHtml = (w: Watchlist) => {
    if (!w.items.length) return empty("star", "這份清單是空的", "在上面搜尋代號或名稱加入。");
    let items = [...w.items];
    if (sort === "chg") items.sort((a, b) => (b.quote.change_pct ?? -1e9) - (a.quote.change_pct ?? -1e9));
    if (sort === "sym") items.sort((a, b) => a.symbol.localeCompare(b.symbol));
    if (sort === "vol") items.sort((a, b) => (b.quote.volume_lots ?? -1) - (a.quote.volume_lots ?? -1));
    return `<div class="qlist">${items.map((i) => `<div class="swipe" data-swipe="${esc(i.symbol)}"><div class="swipe-bg"><button class="btn sm d" type="button" data-rm="${esc(i.symbol)}" ${writable() ? "" : "disabled"}>${ic("trash", "s")}刪除</button></div>${qrow(i.symbol, i.name, i.quote, i.spark, { drag: sort === "custom" && writable(), badge: held.has(i.symbol) ? '<span class="tag acc">已持有</span>' : "" })}</div>`).join("")}</div>`;
  };
  const drawRes = () => {
    const box = el.querySelector("[data-res]"); if (!box) return;
    const w = wl();
    box.innerHTML = q.trim() ? `<div class="card flush list-card">${results.length ? `<div class="qlist">${searchRows(results, { inList: new Set(w?.items.map((i) => i.symbol)), addLabel: "加入" })}</div>` : `<p class="sm mu" style="padding:16px;margin:0">找不到「${esc(q)}」</p>`}</div>` : "";
  };
  const load = async () => {
    try { const [r, p] = await Promise.all([api.watchlists(), api.portfolio().catch(() => null)]); lists = r.rows.sort((a, b) => a.position - b.position); if (p) held = new Set(p.holdings.map((h) => h.symbol)); if (!lists.some((x) => x.watchlist_id === cur)) cur = lists[0]?.watchlist_id ?? ""; err = ""; }
    catch (e) { err = (e as Error).message; }
    draw();
  };
  load();
  const setList = (w: Watchlist) => { lists = lists!.map((x) => (x.watchlist_id === w.watchlist_id ? w : x)); };
  const poller = new Poller(async () => {
    const w = wl(); if (!w?.items.length || dragging) return;
    const r = await api.quotes(w.items.map((i) => i.symbol), true);
    const m = new Map(r.quotes.map((x) => [x.symbol, x]));
    w.items.forEach((i) => { const n = m.get(i.symbol); if (n) { const { spark, ...qq } = n; i.quote = qq as Quote; if (spark !== undefined) i.spark = spark ?? null; } });
    if (!el.querySelector(".swipe.open")) { const box = el.querySelector("[data-items]"); if (box) box.innerHTML = itemsHtml(w); }
  });
  const err409 = (e: unknown) => { toast((e as Error).message, { kind: "err" }); if (e instanceof WatchError && e.code === "VERSION_CONFLICT") load(); };

  // 搜尋
  let st = 0;
  const search = () => { clearTimeout(st); st = window.setTimeout(async () => { if (!q.trim()) { results = []; drawRes(); return; } try { results = (await api.search(q.trim(), 20)).rows.filter((r) => r.kind !== "index"); } catch { results = []; } drawRes(); }, 180); };

  // 拖曳排序
  let dragging = false;
  const onDown = (e: PointerEvent) => {
    const h = (e.target as Element).closest("[data-drag]"); if (!h || sort !== "custom" || !writable()) return;
    e.preventDefault();
    const rowEl = h.closest(".swipe") as HTMLElement, box = rowEl.parentElement!;
    dragging = true; rowEl.classList.add("dragging");
    const move = (ev: PointerEvent) => {
      const sibs = [...box.children] as HTMLElement[];
      for (const s of sibs) { if (s === rowEl) continue; const r = s.getBoundingClientRect(); if (ev.clientY > r.top && ev.clientY < r.bottom) { const before = ev.clientY < r.top + r.height / 2; box.insertBefore(rowEl, before ? s : s.nextSibling); break; } }
    };
    const up = async () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      rowEl.classList.remove("dragging"); dragging = false;
      const block = (ce: Event) => { ce.preventDefault(); ce.stopPropagation(); };
      window.addEventListener("click", block, { capture: true, once: true }); setTimeout(() => window.removeEventListener("click", block, { capture: true }), 50);
      const w = wl()!; const order = [...box.children].map((c) => (c as HTMLElement).dataset.swipe!);
      if (order.join() === w.items.map((i) => i.symbol).join()) return;
      try { setList(await api.reorder(w.watchlist_id, w.version, order)); toast("已更新排序"); } catch (e2) { err409(e2); draw(); }
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  el.addEventListener("pointerdown", onDown);

  const listsSheet = () => {
    const s = openSheet("管理清單", "<div data-l></div>");
    const d = () => {
      s.body.querySelector("[data-l]")!.innerHTML = `<div class="stack" style="gap:8px">${lists!.map((w) => `<div class="set-row"><input class="input" value="${esc(w.name)}" maxlength="20" data-name="${esc(w.watchlist_id)}" aria-label="清單名稱" ${writable() ? "" : "disabled"}>${w === lists![0] ? '<span class="tag ghost" style="flex:none">預設</span>' : `<button class="ibtn bare" type="button" data-delwl="${esc(w.watchlist_id)}" aria-label="刪除清單" ${writable() ? "" : "disabled"}>${ic("trash")}</button>`}</div>`).join("")}</div>
        <div class="row" style="margin-top:12px"><input class="input" data-newname maxlength="20" placeholder="新清單名稱（最多 20 字）" ${writable() ? "" : "disabled"}><button class="btn o" type="button" data-newwl ${writable() && lists!.length < caps().max_watchlists ? "" : "disabled"}>${ic("plus", "s")}新增</button></div>
        <p class="xs mu">${lists!.length} / ${caps().max_watchlists} 份 · 預設清單不可刪除</p>`;
    };
    d();
    s.body.addEventListener("change", async (e) => {
      const t = e.target as HTMLInputElement; if (!t.dataset.name) return;
      const w = lists!.find((x) => x.watchlist_id === t.dataset.name)!; const name = t.value.trim();
      if (!name || name === w.name) { t.value = w.name; return; }
      try { setList(await api.patchWatchlist(w.watchlist_id, { expected_version: w.version, name })); toast("已重新命名"); draw(); } catch (e2) { t.value = w.name; err409(e2); }
    });
    s.body.addEventListener("click", async (e) => {
      const b = (e.target as Element).closest("button"); if (!b) return;
      if (b.dataset.delwl) { const w = lists!.find((x) => x.watchlist_id === b.dataset.delwl)!; if (!(await confirmDialog(`刪除「${esc(w.name)}」？`, `清單裡的 ${w.items.length} 檔會一起移除（不影響持倉與警報）。`, "刪除", true))) return; try { await api.deleteWatchlist(w.watchlist_id); lists = lists!.filter((x) => x !== w); if (cur === w.watchlist_id) cur = lists[0].watchlist_id; d(); draw(); } catch (e2) { err409(e2); } }
      if (b.dataset.newwl != null) { const inp = s.body.querySelector("[data-newname]") as HTMLInputElement; const name = inp.value.trim(); if (!name) { inp.focus(); return; } try { const w = await api.createWatchlist(name); lists = [...lists!, w]; cur = w.watchlist_id; d(); draw(); toast(`已新增「${esc(name)}」`); } catch (e2) { err409(e2); } }
    });
  };

  const offs = [
    on(el, "click", "[data-wl]", (b) => { cur = b.dataset.wl!; draw(); }),
    on(el, "click", "[data-sort]", (b) => { sort = b.dataset.sort as Sort; draw(); }),
    on(el, "input", "[data-q]", (i) => { q = (i as HTMLInputElement).value; search(); }),
    on(el, "click", "[data-add]", async (b) => { const w = wl()!; (b as HTMLButtonElement).disabled = true; try { setList(await api.addItem(w.watchlist_id, b.dataset.add!)); toast(`已加入「${esc(w.name)}」`); const box = el.querySelector("[data-items]"); if (box) box.innerHTML = itemsHtml(wl()!); drawRes(); } catch (e) { (b as HTMLButtonElement).disabled = false; err409(e); } }),
    on(el, "click", "[data-go]", (r, e) => { if ((e.target as Element).closest("[data-add]")) return; import("../router").then((m) => m.navigate(m.stockHref(r.dataset.go!))); }),
    on(el, "click", "[data-rm]", async (b) => { const w = wl()!; try { setList(await api.removeItem(w.watchlist_id, b.dataset.rm!)); draw(); toast("已移出清單"); } catch (e) { err409(e); } }),
    on(document, "click", "[data-act=lists]", () => lists && listsSheet()),
    on(el, "click", "[data-act=retry]", () => { err = ""; draw(); load(); }),
    swipeRows(el),
  ];
  return () => { poller.stop(); offs.forEach((f) => f()); el.removeEventListener("pointerdown", onDown); };
};
export default view;
