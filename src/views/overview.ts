/** 總覽（SPEC §6.2）：市場狀態、大盤、持倉摘要、持倉清單、自選清單。 */
import type { View } from "./types";
import type { Holding, Overview, Quote } from "../types";
import { api } from "../api/watch";
import * as store from "../lib/store";
import { Poller } from "../poll";
import { S, savePrefs, setUnread, writable } from "../state";
import { bell, empty, errorBox, idxCard, marketBar, qrow, skelRows } from "../ui/components";
import { esc, on } from "../ui/dom";
import { ic } from "../ui/icons";
import { pullToRefresh } from "../ui/ptr";
import { openSearch } from "../ui/search";
import { title } from "../ui/top";
import { decToBig, decDir, fmtMoney, fmtPct } from "../lib/fmt";
import { dirCls } from "../ui/components";
import { href } from "../router";

type Sort = "chg" | "pnl" | "mv" | "sym";
const SORTS: [Sort, string][] = [["chg", "漲跌"], ["pnl", "損益"], ["mv", "市值"], ["sym", "代號"]];
const prefKey = "sw-ov";
const loadUi = () => { try { return JSON.parse(localStorage.getItem(prefKey) || "{}"); } catch { return {}; } };
const saveUi = (o: object) => { try { localStorage.setItem(prefKey, JSON.stringify(o)); } catch { /* */ } };

export function sortHoldings(hs: Holding[], s: Sort): Holding[] {
  const big = (v: string | null) => (v == null ? -(10n ** 30n) : decToBig(v));
  const cmpBig = (a: bigint, b: bigint) => (a < b ? 1 : a > b ? -1 : 0);
  return [...hs].sort((a, b) => {
    if (s === "sym") return a.symbol.localeCompare(b.symbol);
    if (s === "pnl") return cmpBig(big(a.unrealized_pnl), big(b.unrealized_pnl));
    if (s === "mv") return cmpBig(big(a.market_value), big(b.market_value));
    return (b.quote.change_pct ?? -1e9) - (a.quote.change_pct ?? -1e9);
  });
}

const view: View = ({ el, setTop, alive }) => {
  let data: Overview | null = null, cachedAt: string | null = null, err: string | null = null;
  const ui = { sort: "chg" as Sort, wl: "", ...loadUi() };
  const basis = () => S.prefs?.pnl_basis ?? "gross";
  const head = () => setTop(title("總覽", "看盤 · QUANT GRID") + `<button class="ibtn" type="button" data-search aria-label="搜尋">${ic("search")}</button>${bell(S.unread)}`);
  head();

  el.innerHTML = skeleton();
  const render = () => {
    if (!alive()) return;
    if (!data) { el.innerHTML = err ? `<div class="card">${errorBox(err)}</div>` : skeleton(); return; }
    const d = data;
    const wls = [...d.watchlists].sort((a, b) => a.position - b.position);
    const wl = wls.find((w) => w.watchlist_id === ui.wl) ?? wls[0];
    el.innerHTML = `<div class="ov">
      <div class="full">${marketBar(d.market_status, d.as_of, cachedAt)}</div>
      <div class="ov-l">
        <div class="ov-idx">${d.indices.map((i) => idxCard(i.symbol, i.name, i.quote, i.spark, i.quote.status === "no_data" && i.symbol === "TPEX")).join("")}</div>
        ${summaryCard(d)}
        ${holdingsCard(d.holdings)}
      </div>
      <div class="ov-r">${watchCard(wls, wl)}</div>
    </div>`;
  };
  const summaryCard = (d: Overview) => {
    const p = d.portfolio;
    if (!p) return "";
    const net = basis() === "net_est";
    const un = net ? p.unrealized_pnl_net_est ?? p.unrealized_pnl : p.unrealized_pnl;
    const unPct = net && p.unrealized_pnl_net_est != null && decToBig(p.cost) !== 0n ? Number((decToBig(p.unrealized_pnl_net_est) * 10000n) / decToBig(p.cost)) / 100 : p.unrealized_pnl_pct;
    const warn: string[] = [];
    if (p.unpriced_count) warn.push(`${p.unpriced_count} 檔沒有報價，未計入市值`);
    if (p.stale_count) warn.push(`${p.stale_count} 檔報價過期，損益以最後價格估算`);
    return `<section class="card hl" aria-label="持倉摘要"><span class="corner tl"></span><span class="corner br"></span>
      <div class="card-h"><h2 class="h2">持倉摘要</h2><div class="seg" role="group" aria-label="損益基準"><button type="button" data-basis="gross" aria-pressed="${!net}">毛額</button><button type="button" data-basis="net_est" aria-pressed="${net}">扣稅費</button></div></div>
      <div class="kpis">
        <div class="kpi lead"><div class="lb">總市值</div><div class="v num">NT$ ${fmtMoney(p.market_value)}</div></div>
        <div class="kpi"><div class="lb">今日損益</div><div class="v num ${dirCls(decDir(p.day_pnl))}">${fmtMoney(p.day_pnl, { signed: true })}</div><div class="chg ${dirCls(decDir(p.day_pnl))} sm">${fmtPct(p.day_pnl_pct)}</div></div>
        <div class="kpi"><div class="lb">未實現損益${net ? " · 預估淨額" : ""}</div><div class="v num ${dirCls(decDir(un))}">${fmtMoney(un, { signed: true })}</div><div class="chg ${dirCls(decDir(un))} sm">${fmtPct(unPct)}</div></div>
      </div>
      ${warn.length ? `<div class="hint wa" style="margin-top:12px">${ic("clock", "s")}<span>${warn.join("；")}</span></div>` : ""}
      ${net ? `<p class="xs mu" style="margin:10px 0 0">預估淨額＝再扣賣出手續費與證交稅（股票 0.3%、ETF 0.1%）</p>` : ""}
    </section>`;
  };
  const holdingsCard = (hs: Holding[]) => {
    if (!hs.length) return `<section class="card">${empty("brief", "還沒有持倉資料", "持倉由後端從成交信件匯入，匯入後會出現在這裡。先把想看的股票加入自選吧。", `<button class="btn p" type="button" data-search>${ic("search", "s")}搜尋股票</button>`)}</section>`;
    const rows = sortHoldings(hs, ui.sort);
    return `<section class="card list-card" aria-label="持倉"><div class="card-h"><h2 class="h2"><a href="${href("/holdings")}" style="color:inherit">持倉</a> <span class="tag ghost num">${hs.length}</span></h2>
      <div class="seg" role="group" aria-label="排序">${SORTS.map(([k, t]) => `<button type="button" data-sort="${k}" aria-pressed="${ui.sort === k}">${t}</button>`).join("")}</div></div>
      <div class="qhead hold-h"><span>名稱</span><span class="ext">市值</span><span class="ext">今日損益</span><span></span><span style="text-align:right">現價 · 未實現損益</span></div>
      <div class="qlist">${rows.map((h) => qrow(h.symbol, h.name, h.quote, h.spark, { holding: h, basis: basis() })).join("")}</div></section>`;
  };
  const watchCard = (wls: Overview["watchlists"], wl: Overview["watchlists"][number] | undefined) => {
    const items = wl?.items ?? [];
    return `<section class="card list-card" aria-label="自選"><div class="card-h"><h2 class="h2">自選</h2><a class="ibtn bare" href="${href("/watch")}" aria-label="管理自選">${ic("edit")}</a></div>
      ${wls.length > 1 ? `<div class="seg" role="group" aria-label="自選清單" style="margin-bottom:8px">${wls.map((w) => `<button type="button" data-wl="${esc(w.watchlist_id)}" aria-pressed="${w === wl}">${esc(w.name)}</button>`).join("")}</div>` : ""}
      ${items.length ? `<div class="qlist">${items.map((i) => qrow(i.symbol, i.name, i.quote, i.spark)).join("")}</div>` : empty("star", "這份清單是空的", "用代號或名稱搜尋，加入想看的商品。", `<button class="btn o" type="button" data-search>${ic("plus", "s")}加入自選</button>`)}</section>`;
  };

  const load = async () => {
    try {
      const d = await api.overview();
      data = d; cachedAt = null; err = null;
      store.put("overview", d);
      setUnread(d.unread_alert_events); head();
      if (S.boot) S.boot.market_status = d.market_status;
    } catch (e) {
      const c = await store.get<Overview>("overview");
      if (c && !data) { data = c.data; cachedAt = c.at; }
      else if (data && !S.online) cachedAt = cachedAt ?? S.lastOkAt;
      if (!data) err = (e as Error).message;
      render(); throw e;
    }
    render();
  };
  // 輪詢：只更新畫面上看得到的商品（§5）；每 6 次重抓總覽以更新摘要
  let n = 0;
  const tick = async () => {
    if (!data || ++n % 6 === 0 || !S.online) return load();
    const syms = [...data.indices.map((i) => i.symbol), ...data.holdings.map((h) => h.symbol), ...(data.watchlists.find((w) => w.watchlist_id === ui.wl) ?? [...data.watchlists].sort((a, b) => a.position - b.position)[0])?.items.map((i) => i.symbol) ?? []];
    const r = await api.quotes([...new Set(syms)], true);
    const map = new Map(r.quotes.map((q) => [q.symbol, q]));
    const patch = <T extends { symbol: string; quote: Quote; spark: unknown }>(x: T) => { const q = map.get(x.symbol); if (q) { const { spark, ...quote } = q; x.quote = quote as Quote; if (spark !== undefined) (x as { spark: unknown }).spark = spark; } };
    data.indices.forEach(patch); data.holdings.forEach(patch); data.watchlists.forEach((w) => w.items.forEach(patch));
    render();
  };
  const poller = new Poller(tick);
  load().catch(() => {});

  const offs = [
    on(el, "click", "[data-sort]", (b) => { ui.sort = b.dataset.sort as Sort; saveUi(ui); render(); }),
    on(el, "click", "[data-wl]", (b) => { ui.wl = b.dataset.wl!; saveUi(ui); render(); }),
    on(el, "click", "[data-basis]", (b) => { const v = b.dataset.basis as "gross" | "net_est"; if (writable()) savePrefs({ pnl_basis: v }).then(render).catch(render); else if (S.prefs) { S.prefs.pnl_basis = v; } render(); }),
    on(el, "click", "[data-act=retry]", () => { err = null; render(); load().catch(() => {}); }),
    on(el, "click", "[data-search]", () => openSearch()),
    pullToRefresh(el, () => load().catch(() => {})),
  ];
  return () => { poller.stop(); offs.forEach((f) => f()); };
};
export default view;

function skeleton() {
  const card = `<div class="card"><div class="sk" style="height:12px;width:60%"></div><div class="sk" style="height:26px;width:80%;margin-top:10px"></div><div class="sk" style="height:34px;margin-top:14px"></div></div>`;
  return `<div class="ov" aria-busy="true"><div class="full"><div class="sk" style="height:40px;border-radius:12px"></div></div><div class="ov-l"><div class="ov-idx">${card}${card}</div>
    <div class="card"><div class="sk" style="height:16px;width:30%"></div><div class="sk" style="height:32px;width:70%;margin-top:14px"></div><div class="kpis" style="margin-top:14px"><div class="sk" style="height:40px"></div><div class="sk" style="height:40px"></div></div></div>
    <div class="card">${skelRows(3)}</div></div><div class="ov-r"><div class="card">${skelRows(4)}</div></div></div>`;
}
