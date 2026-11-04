/** 個股頁與指數頁（SPEC §6.3）。≥1180px 三欄：清單｜圖表｜部位、報價、警報。 */
import type { View } from "./types";
import type { Alert, Bar, Holding, InstrumentDetail, Interval, Overview, Quote, Trade } from "../types";
import { api } from "../api/watch";
import { WatchError } from "../api/client";
import * as store from "../lib/store";
import { Poller } from "../poll";
import { S, savePrefs, sub, writable } from "../state";
import { Chart, type ChartData, type Overlays } from "../ui/chart";
import { chg, dirCls, errorBox, pill, priceEl, qrow, RULE_ICON, ruleText, statusTag, bell, STATUS_TEXT } from "../ui/components";
import { $, esc, isThreeCol, isWide, on } from "../ui/dom";
import { ic } from "../ui/icons";
import { confirmDialog, openSheet, toast } from "../ui/overlay";
import { backBtn } from "../ui/top";
import { decDir, fmtInt, fmtLots, fmtMoney, fmtPct, fmtPrice, fmtShares, fmtTwdShort, hhmm, hhmmss, mmdd, ymd } from "../lib/fmt";
import { href, navigate, stockHref, canGoBack } from "../router";
import { snapPrice } from "../lib/ticks";
import { mountAlertForm } from "./alert-edit";

type Period = "intraday" | Interval;
const PERIODS: [Period, string][] = [["intraday", "分時"], ["1d", "日"], ["1w", "週"], ["1M", "月"]];
const LIMIT: Record<Interval, number> = { "1d": 300, "1w": 150, "1M": 48 };
const SUBS = [["none", "量"], ["kd", "KD"], ["macd", "MACD"], ["rsi", "RSI"]] as const;
const LS = "sw-chart";
const loadLs = () => { try { return JSON.parse(localStorage.getItem(LS) || "{}"); } catch { return {}; } };

const view: View = ({ route, el, setTop, alive }) => {
  const sym = (route.params.symbol || "TAIEX").toUpperCase();
  const isIndexRoute = route.name === "market";
  const eventId = route.query.get("event");
  let det: InstrumentDetail | null = null, err: WatchError | null = null, trades: Trade[] = [];
  const P = S.prefs!;
  const ls = loadLs();
  let period: Period = (route.query.get("view") as Period) || P.default_view;
  if (period === "intraday" && S.boot && !S.boot.capabilities.intraday) period = "1d";
  const ov: Overlays = { cost: null, alerts: [], trades: [], showCost: ls.cost ?? true, showAlerts: ls.alerts ?? true, showTrades: ls.trades ?? true, mas: P.ma_periods, volume: P.volume_pane, sub: P.sub_indicator, weak: false };
  let adjust: "none" | "forward" = S.boot?.capabilities.adjusted_bars ? P.adjust_default : "none";
  let chart: Chart | null = null, chartNote = "", bars: Bar[] = [], fs = false;
  let listTab: "hold" | "watch" = "hold", listData: Overview | null = null;
  const fromBack = canGoBack() ? "返回" : "總覽";

  const head = () => {
    const inWl = (det?.watchlist_ids.length ?? 0) > 0;
    setTop(backBtn(fromBack, "/") + `<div class="ttl top-sym" aria-hidden="true">${det ? `<b>${esc(det.instrument.name)}</b> ${priceEl(det.quote)}` : ""}</div>`
      + (det && det.instrument.kind !== "index" ? `<button class="ibtn ${inWl ? "on" : ""}" type="button" data-act="watch" aria-label="${inWl ? "已在自選，管理" : "加入自選"}" aria-pressed="${inWl}">${ic("star")}</button><button class="ibtn" type="button" data-act="new-alert" aria-label="設警報">${ic("plus")}</button>` : "")
      + bell(S.unread));
  };
  head();
  el.innerHTML = `<div class="stk"><aside class="stk-list card flush" data-list></aside><div class="stk-mid"><div class="sk" style="height:110px"></div><div class="sk" style="height:340px;margin-top:16px"></div></div><div class="stk-side"></div></div>`;

  const q = () => det!.quote;
  const isIdx = () => det?.instrument.kind === "index";
  const weakQuote = (x: Quote) => x.status === "stale" || x.status === "disconnected";

  function headHtml() {
    const d = det!, x = d.quote, ins = d.instrument;
    const tags = [statusTag(x, { showLive: true, closedFull: true })];
    if (x.as_of && x.status !== "closed" && x.status !== "no_data") tags.push(`<span class="num">${hhmmss(x.as_of)}</span>`);
    if (x.limit_state === "limit_up") tags.push(`<span class="tag lim-up">漲停</span>`);
    if (x.limit_state === "limit_down") tags.push(`<span class="tag lim-dn">跌停</span>`);
    if (ins.flags.includes("halted")) tags.push(`<span class="tag halt">暫停交易</span>`);
    if (!isIdx() && x.limit_up != null) tags.push(`<span>漲停 <span class="num">${fmtPrice(x.limit_up)}</span></span><span>跌停 <span class="num">${fmtPrice(x.limit_down)}</span></span>`);
    if (isIdx()) tags.push(`<span>每分鐘更新</span>`);
    const board = { tse: "上市", otc: "上櫃", index: "指數" }[ins.board] + (ins.kind === "etf" ? " · ETF" : "");
    return `<div class="stk-head ${x.status === "stale" ? "is-stale" : x.status === "disconnected" ? "is-cut" : ""}" aria-live="polite">
      <div class="row" style="min-width:0"><h1 class="h1 trunc">${esc(ins.name)}</h1><span class="code" style="flex:none">${esc(ins.symbol)} · ${board}</span></div>
      <div class="pxl">${x.last == null ? `<span class="huge px mu2">—</span>` : `<span class="huge px ${x.direction === "flat" ? "flat" : dirCls(x.direction)}">${fmtPrice(x.last)}</span>`}${chg(x)}${pill(x)}</div>
      <div class="row xs mu wrap-row">${tags.join("")}</div></div>`;
  }
  function staleBanner() {
    const x = q();
    if (x.status === "disconnected") return `<div class="banner cut">${ic("cut", "s")}<span class="grow">行情來源中斷，顯示 <span class="num">${hhmm(x.as_of)}</span> 的最後資料，警報暫停判斷</span><button class="btn sm" type="button" data-act="refresh">重試</button></div>`;
    if (x.status === "stale") return `<div class="banner wa">${ic("clock", "s")}<span class="grow">報價過期（最後更新 <span class="num">${hhmm(x.as_of)}</span>），不是現價</span></div>`;
    if (x.status === "no_data") return `<div class="banner">${ic("info", "s")}<span class="grow">這檔目前沒有行情資料（新上市、暫停交易或代號沒有行情）</span></div>`;
    return "";
  }
  function eventBanner() {
    if (!eventId || !det) return "";
    const a = det.alerts.find((x) => x.last_triggered_at) ?? det.alerts[0];
    return `<div class="banner ac" data-event>${ic("bell", "s")}<span class="grow">由警報開啟${a ? `：${esc(ruleText(a.rule))}` : ""}</span><button class="ibtn bare" type="button" data-act="close-event" aria-label="關閉">${ic("x", "s")}</button></div>`;
  }
  function chartCard() {
    return `<section class="card chart-card ${fs ? "fs" : ""}" data-chartcard>
      ${fs ? `<div class="between"><div class="row" style="min-width:0"><button class="ibtn bare" type="button" data-act="fs" aria-label="離開全螢幕">${ic("x")}</button><b class="trunc">${esc(det!.instrument.name)}</b><span class="code">${esc(sym)}</span>${priceEl(q())}${pill(q())}</div>${periodSeg()}</div>` : ""}
      <div class="between ch-top" style="padding:2px 6px 6px"><div class="legend" data-legend></div><div class="ch-note" data-note>${chartNote}</div></div>
      <div class="chart-main" data-chart></div>
      ${period !== "intraday" ? `<div class="between" style="padding:6px 6px 0"><div class="seg" role="group" aria-label="副圖">${SUBS.map(([k, t]) => `<button type="button" data-sub="${k}" aria-pressed="${ov.sub === k}">${t}</button>`).join("")}</div><span class="legend" data-sublegend></span></div>` : ""}
    </section>`;
  }
  const periodSeg = () => `<div class="seg" role="group" aria-label="週期">${PERIODS.filter(([p]) => p !== "intraday" || S.boot?.capabilities.intraday !== false).map(([p, t]) => `<button type="button" data-period="${p}" aria-pressed="${p === period}">${t}</button>`).join("")}</div>`;
  function quoteCard() {
    const x = q(), st = det!.stats;
    const rows: [string, string][] = isIdx()
      ? [["開", fmtPrice(x.open)], ["高", fmtPrice(x.high)], ["低", fmtPrice(x.low)], ["昨收", fmtPrice(x.prev_close)], ["成交金額", fmtTwdShort(x.turnover_twd)], ["52 週高", fmtPrice(st.high_52w)], ["52 週低", fmtPrice(st.low_52w)], ["資料來源", x.source.toUpperCase()]]
      : [["開", fmtPrice(x.open)], ["高", fmtPrice(x.high)], ["低", fmtPrice(x.low)], ["昨收", fmtPrice(x.prev_close)], ["漲停", fmtPrice(x.limit_up)], ["跌停", fmtPrice(x.limit_down)], ["成交量", fmtLots(x.volume_lots)], ["成交金額", fmtTwdShort(x.turnover_twd)], ["五日均量", fmtLots(st.avg_volume_5d_lots)], ["52 週高", fmtPrice(st.high_52w)], ["52 週低", fmtPrice(st.low_52w)], ["資料", STATUS_TEXT[x.status]]];
    return `<section class="card ${weakQuote(x) ? "is-stale" : ""}" aria-label="報價資訊"><div class="card-h"><h2 class="h2">報價資訊</h2><span class="xs mu">來源 ${esc(x.source.toUpperCase())}${x.as_of ? ` · ${hhmm(x.as_of)}` : ""}</span></div><dl class="dl">${rows.map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join("")}</dl></section>`;
  }
  function posCard(h: Holding) {
    const basisNet = S.prefs?.pnl_basis === "net_est";
    const un = basisNet ? h.unrealized_pnl_net_est ?? h.unrealized_pnl : h.unrealized_pnl;
    return `<section class="card hl" aria-label="我的部位"><div class="card-h"><h2 class="h2">我的部位</h2>${h.weight_pct != null ? `<span class="tag acc">占比 <span class="num">${h.weight_pct.toFixed(1)}%</span></span>` : ""}</div>
      <div class="kpis"><div class="kpi"><div class="lb">未實現損益${basisNet ? "（淨）" : ""}</div><div class="v num ${dirCls(decDir(un))}">${fmtMoney(un, { signed: true })}</div><div class="chg ${dirCls(decDir(un))} sm">${fmtPct(h.unrealized_pnl_pct)}</div></div>
      <div class="kpi"><div class="lb">今日損益</div><div class="v num ${dirCls(decDir(h.day_pnl))}">${fmtMoney(h.day_pnl, { signed: true })}</div><div class="chg ${dirCls(decDir(h.day_pnl))} sm">${fmtPct(h.day_pnl_pct)}</div></div></div>
      <dl class="dl" style="margin-top:8px"><div><dt>持有</dt><dd>${fmtShares(h.qty_shares)}</dd></div><div><dt>平均成本</dt><dd>${fmtMoney(h.avg_cost, { decimals: 2 })}</dd></div><div><dt>市值</dt><dd>${fmtMoney(h.market_value)}</dd></div><div><dt>成本</dt><dd>${fmtMoney(h.cost)}</dd></div><div><dt>首次買進</dt><dd>${ymd(h.first_buy_date)}</dd></div><div><dt>股數</dt><dd>${fmtInt(h.qty_shares)}</dd></div></dl>
      <button class="link" type="button" data-act="trades" style="margin-top:8px">成交紀錄${trades.length ? ` ${trades.length} 筆` : ""} ${ic("chevr", "s")}</button></section>`;
  }
  function alertsCard() {
    const al = det!.alerts;
    return `<section class="card" aria-label="這檔的警報"><div class="card-h"><h2 class="h2">警報 <span class="tag ghost num">${al.length}</span></h2>${isIdx() ? "" : `<button class="btn sm o" type="button" data-act="new-alert" ${writable() ? "" : "disabled"}>${ic("plus", "s")}新增</button>`}</div>
      ${al.length ? al.map(alertMini).join("") : `<p class="sm mu" style="margin:0">${isIdx() ? "指數的警報可在警報頁建立（到價、漲跌幅、均線）。" : "還沒有警報。長按圖表上的價位，也可以直接設警報。"}</p>`}</section>`;
  }
  function alertMini(a: Alert) {
    const dist = a.live?.distance_pct != null && a.rule.type !== "limit" ? `<span class="dist">距離 ${fmtPct(a.live.distance_pct)}</span>` : "";
    const st = { active: "", paused: "已暫停", triggered: "已觸發", expired: "已到期", error: a.status_reason ?? "錯誤" }[a.status];
    return `<div class="al ${a.status}" style="padding:10px 0"><a class="ai" href="${href("/alerts/" + a.alert_id)}" aria-label="編輯">${ic(RULE_ICON[a.rule.type])}</a><a href="${href("/alerts/" + a.alert_id)}" style="min-width:0;color:inherit"><div class="t">${esc(ruleText(a.rule))}</div><div class="d">${a.live?.met && a.status === "active" ? '<span style="color:var(--wa)">已滿足 · 等待離開</span>' : dist}${st ? `<span>${esc(st)}</span>` : ""}<span>${{ once: "一次", daily: "每日一次", every: `每次 · ${a.cooldown_minutes} 分` }[a.frequency]}</span></div></a>
      ${a.status === "active" || a.status === "paused" ? `<label class="tg"><input type="checkbox" data-toggle="${a.alert_id}" ${a.status === "active" ? "checked" : ""} ${writable() ? "" : "disabled"} aria-label="啟用"><span></span></label>` : ""}</div>`;
  }
  function listCol() {
    const box = $("[data-list]", el); if (!box) return;
    if (!isThreeCol()) { box.innerHTML = ""; return; }
    if (!listData) { box.innerHTML = ""; return; }
    const hs = listData.holdings, wl = [...listData.watchlists].sort((a, b) => a.position - b.position).flatMap((w) => w.items);
    const seen = new Set<string>(); const wlU = wl.filter((i) => (seen.has(i.symbol) ? false : (seen.add(i.symbol), true)));
    box.innerHTML = `<div style="padding:12px 12px 0"><div class="seg wide" role="group"><button type="button" data-tab="hold" aria-pressed="${listTab === "hold"}">持倉</button><button type="button" data-tab="watch" aria-pressed="${listTab === "watch"}">自選</button></div></div>
      <div class="qlist list-card" style="padding:4px 0">${listTab === "hold" ? (hs.length ? hs.map((h) => qrow(h.symbol, h.name, h.quote, h.spark, { holding: h, sel: h.symbol === sym, right: `${priceEl(h.quote)}${pill(h.quote)}` })).join("") : `<p class="sm mu" style="padding:16px">沒有持倉</p>`)
        : wlU.length ? wlU.map((i) => qrow(i.symbol, i.name, i.quote, i.spark, { sel: i.symbol === sym })).join("") : `<p class="sm mu" style="padding:16px">自選是空的</p>`}</div>`;
  }

  function render() {
    if (!alive()) return;
    if (!det) {
      $(".stk-mid", el)!.innerHTML = err?.code === "SYMBOL_UNKNOWN" || err?.code === "NOT_FOUND"
        ? `<div class="card"><div class="empty"><h2 class="h2">找不到「${esc(sym)}」</h2><p class="sm">這個代號沒有資料。</p><a class="btn o" href="${href("/")}">回總覽</a></div></div>`
        : `<div class="card">${errorBox(err?.message ?? "載入失敗")}</div>`;
      return;
    }
    head();
    const mid = $(".stk-mid", el)!, side = $(".stk-side", el)!;
    chart?.destroy(); chart = null;
    mid.innerHTML = `${eventBanner()}${staleBanner()}${headHtml()}
      <div class="between">${periodSeg()}<div class="row">${!isIdx() || true ? `<button class="ibtn bare" type="button" data-act="layers" aria-label="圖表設定與疊加層">${ic("layers")}</button>` : ""}<button class="ibtn bare" type="button" data-act="fs" aria-label="全螢幕">${ic("expand")}</button></div></div>
      ${chartCard()}
      <div class="stk-phone-side"></div>`;
    const sideHtml = `${det.position ? posCard(det.position) : ""}${quoteCard()}${alertsCard()}`;
    if (isWide()) { side.innerHTML = sideHtml; } else { side.innerHTML = ""; $(".stk-phone-side", mid)!.innerHTML = `<div class="stack" style="gap:16px">${sideHtml}</div>`; }
    listCol();
    mountChart();
  }
  function patchQuote() {
    if (!det) return;
    const hd = $(".stk-head", el); if (hd) hd.outerHTML = headHtml();
    const qc = $('[aria-label="報價資訊"]', el); if (qc) qc.outerHTML = quoteCard();
    head();
    ov.weak = weakQuote(q());
    chart?.setOverlays({ weak: ov.weak });
    const x = q();
    if (chart && x.last != null && (x.status === "live" || x.status === "delayed")) chart.updateLast(x.last, x.as_of ?? undefined, x.volume_lots);
  }

  function mountChart() {
    const box = $("[data-chart]", el); if (!box || !det) return;
    chart = new Chart(box, {
      snap: (p) => snapPrice(p, det!.instrument.kind),
      onAlertAt: isIdx() ? undefined : (p) => openAlert(p),
      onNeedMore: period === "intraday" ? undefined : loadMore,
    });
    ov.cost = det.position ? Number(det.position.avg_cost) : null;
    ov.alerts = det.alerts.filter((a) => a.rule.type === "price" && (a.status === "active" || a.status === "paused")).map((a) => (a.rule as { value: number }).value);
    ov.trades = trades.map((t) => ({ date: t.trade_date, side: t.side }));
    ov.weak = weakQuote(q());
    chart.setOverlays({ ...ov });
    loadChart();
  }
  function legend() {
    const lg = $("[data-legend]", el); if (!lg) return;
    if (period === "intraday") lg.innerHTML = `<span><i style="background:var(--ch-line)"></i>價格</span><span><i style="background:var(--ch-prev)"></i>昨收</span>${ov.cost != null && ov.showCost ? `<span><i style="background:var(--ch-cost)"></i>成本 ${fmtPrice(ov.cost)}</span>` : ""}${ov.alerts.length && ov.showAlerts ? `<span><i style="background:var(--ch-alert)"></i>警報</span>` : ""}`;
    else { const cl = bars.map((b) => b.c); lg.innerHTML = ov.mas.map((m) => { const v = cl.length >= m ? cl.slice(-m).reduce((a, b) => a + b, 0) / m : null; return `<span><i style="background:var(--ma${m})"></i>MA${m}${v != null ? ` <span class="num">${fmtPrice(v)}</span>` : ""}</span>`; }).join("") + (adjust === "forward" ? `<span class="tag ghost">還原權息</span>` : ""); }
    const sl = $("[data-sublegend]", el);
    if (sl) sl.innerHTML = ov.sub === "kd" ? `<span><i style="background:var(--ind1)"></i>K</span><span><i style="background:var(--ind2)"></i>D</span>` : ov.sub === "macd" ? `<span><i style="background:var(--ind1)"></i>DIF</span><span><i style="background:var(--ind2)"></i>DEA</span><span>柱 OSC</span>` : ov.sub === "rsi" ? `<span><i style="background:var(--ind3)"></i>RSI14</span>` : isIdx() ? "<span>成交金額</span>" : "<span>成交量（張）</span>";
  }
  const setNote = (s: string) => { chartNote = s; const n = $("[data-note]", el); if (n) n.innerHTML = s; };
  async function loadChart() {
    const my = period;
    setNote(`<span class="mu">載入中…</span>`);
    try {
      let d: ChartData;
      if (period === "intraday") {
        const r = await api.intraday(sym);
        const notes: string[] = [];
        if (!r.points.length) notes.push(S.boot?.market_status.session === "pre_open" ? "尚未開盤" : "尚無分時資料");
        else if (!r.coverage.complete && r.coverage.from && hhmm(r.coverage.from) !== hhmm(r.session_start)) notes.push(`分時線自 ${hhmm(r.coverage.from)} 起`);
        for (const g of r.coverage.gaps) notes.push(`${hhmm(g.from)}–${hhmm(g.to)} 無資料`);
        if (r.coverage.reason && !notes.length && !r.coverage.complete) notes.push(esc(r.coverage.reason));
        if (r.date !== (S.boot?.market_status.now ?? "").slice(0, 10)) notes.push(`${mmdd(r.date)} 的分時`);
        d = { kind: "intraday", points: r.points, prevClose: r.prev_close, limitUp: r.limit_up, limitDown: r.limit_down, start: r.session_start, end: r.session_end, gaps: r.coverage.gaps, complete: r.coverage.complete, isIndex: isIdx() };
        if (my !== period) return;
        setNote(notes.length ? `${ic("info", "s")}${notes.join(" · ")}` : "");
      } else {
        const iv = period;
        let r;
        try { r = await api.bars(sym, { interval: iv, limit: LIMIT[iv], adjust }); }
        catch (e) {
          if (e instanceof WatchError && e.code === "INSUFFICIENT_HISTORY") r = await api.bars(sym, { interval: iv, limit: LIMIT[iv], adjust, allow_partial: true });
          else throw e;
        }
        if (my !== period) return;
        bars = r.bars;
        setNote(r.coverage.truncated && r.coverage.actual_from ? `${ic("info", "s")}資料自 ${ymd(r.coverage.actual_from)} 起` : "");
        d = { kind: "kline", bars: r.bars, isIndex: isIdx(), hasMoreBefore: r.has_more_before, interval: iv };
      }
      chart?.setData(d); legend();
      store.put(`chart:${sym}:${period}`, d);
    } catch (e) {
      const c = await store.get<ChartData>(`chart:${sym}:${period}`);
      if (c && my === period) { chart?.setData(c.data); if (c.data.kind === "kline") bars = c.data.bars; legend(); setNote(`${ic("clock", "s")}顯示 ${hhmm(c.at)} 的快取資料`); }
      else setNote(`<span style="color:var(--cut)">${esc((e as Error).message)}</span> <button class="link" type="button" data-act="chart-retry">重試</button>`);
    }
  }
  async function loadMore(): Promise<boolean> {
    if (period === "intraday" || !bars.length) return false;
    const first = new Date(bars[0].t + "T00:00:00Z"); first.setUTCDate(first.getUTCDate() - 1);
    const r = await api.bars(sym, { interval: period, to: first.toISOString().slice(0, 10), limit: LIMIT[period], adjust });
    if (!r.bars.length) return false;
    bars = [...r.bars.filter((b) => b.t < bars[0].t), ...bars];
    chart?.setData({ kind: "kline", bars, isIndex: isIdx(), hasMoreBefore: r.has_more_before, interval: period }, true);
    if (!r.has_more_before) setNote(`${ic("info", "s")}資料自 ${ymd(bars[0].t)} 起`);
    return r.has_more_before;
  }

  async function load() {
    try {
      const d = await api.instrument(sym);
      if (isIndexRoute !== (d.instrument.kind === "index")) { navigate(stockHref(sym), { replace: true }); return; }
      det = d; err = null;
      store.put("inst:" + sym, d);
      if (d.position && !trades.length) api.trades({ symbol: sym, limit: 100 }).then((r) => { trades = r.rows; if (chart) chart.setOverlays({ trades: trades.map((t) => ({ date: t.trade_date, side: t.side })) }); const b = $("[data-act=trades]", el); if (b) b.innerHTML = `成交紀錄 ${trades.length} 筆 ${ic("chevr", "s")}`; }).catch(() => {});
    } catch (e) {
      const c = await store.get<InstrumentDetail>("inst:" + sym);
      if (c) { det = c.data; det.quote = { ...det.quote, status: det.quote.status === "closed" ? "closed" : "stale" }; }
      else err = e as WatchError;
    }
    render();
  }
  load();
  if (isThreeCol()) store.get<Overview>("overview").then((c) => { if (c) { listData = c.data; listCol(); } api.overview().then((d) => { listData = d; listCol(); }).catch(() => {}); });

  const poller = new Poller(async () => {
    if (!det) return load();
    const r = await api.quotes([sym]);
    const nq = r.quotes[0];
    if (nq) { const { spark: _s, ...rest } = nq as Quote & { spark?: unknown }; void _s; det.quote = rest; patchQuote(); }
  });

  // 互動
  function openAlert(price?: number) {
    if (!det) return;
    if (!writable()) { toast("離線或登入過期時無法新增警報", { kind: "err" }); return; }
    if (isWide()) {
      const s = openSheet("新增警報", `<div data-form></div>`, { side: true });
      mountAlertForm(s.body.querySelector("[data-form]")!, { symbol: sym, price, detail: det, onDone: (a) => { s.close(); if (a) { det!.alerts = [a, ...det!.alerts.filter((x) => x.alert_id !== a.alert_id)]; render(); toast("警報已建立"); } }, inSheet: true });
    } else navigate(href(`/alerts/new?symbol=${encodeURIComponent(sym)}${price != null ? `&price=${price}` : ""}`));
  }
  async function watchSheet() {
    if (!det) return;
    let rows = (await api.watchlists().catch(() => ({ rows: [] }))).rows.sort((a, b) => a.position - b.position);
    const s = openSheet("加入自選", `<div data-wls class="stack" style="gap:8px"></div><p class="xs mu" style="margin:12px 0 0">可同時放在多份清單</p>`);
    const draw = () => { s.body.querySelector("[data-wls]")!.innerHTML = rows.map((w) => { const has = w.items.some((i) => i.symbol === sym); return `<button class="opt ${has ? "on" : ""}" type="button" data-wl="${w.watchlist_id}" aria-pressed="${has}" ${writable() ? "" : "disabled"}><span class="grow"><b>${esc(w.name)}</b> <span class="xs mu num">${w.items.length} 檔</span></span>${has ? ic("check") : ic("plus")}</button>`; }).join(""); };
    draw();
    s.body.addEventListener("click", async (e) => {
      const b = (e.target as Element).closest("[data-wl]") as HTMLButtonElement | null; if (!b) return;
      const w = rows.find((x) => x.watchlist_id === b.dataset.wl)!; const has = w.items.some((i) => i.symbol === sym);
      b.disabled = true;
      try { const nw = has ? await api.removeItem(w.watchlist_id, sym) : await api.addItem(w.watchlist_id, sym); rows = rows.map((x) => (x.watchlist_id === nw.watchlist_id ? nw : x)); det!.watchlist_ids = rows.filter((x) => x.items.some((i) => i.symbol === sym)).map((x) => x.watchlist_id); draw(); head(); toast(has ? `已移出「${esc(w.name)}」` : `已加入「${esc(w.name)}」`); }
      catch (err) { b.disabled = false; toast((err as Error).message, { kind: "err" }); }
    });
  }
  function layersSheet() {
    const adj = S.boot?.capabilities.adjusted_bars;
    const s = openSheet("圖表", `<div class="stack">
      <div class="set-row"><div class="grow"><b>平均成本線</b><small>${ov.cost != null ? fmtPrice(ov.cost) : "沒有持倉"}</small></div><label class="tg"><input type="checkbox" data-ov="showCost" ${ov.showCost ? "checked" : ""} ${ov.cost == null ? "disabled" : ""}><span></span></label></div>
      <div class="set-row"><div class="grow"><b>警報價位線</b><small>${ov.alerts.length ? ov.alerts.map((v) => fmtPrice(v)).join("、") : "沒有到價警報"}</small></div><label class="tg"><input type="checkbox" data-ov="showAlerts" ${ov.showAlerts ? "checked" : ""}><span></span></label></div>
      <div class="set-row"><div class="grow"><b>買賣點 B／S</b><small>${trades.length ? trades.length + " 筆成交" : "沒有成交紀錄"}</small></div><label class="tg"><input type="checkbox" data-ov="showTrades" ${ov.showTrades ? "checked" : ""}><span></span></label></div>
      <div class="set-row"><div class="grow"><b>均線</b></div><div class="chips">${[5, 10, 20, 60].map((m) => `<button class="chip" type="button" data-ma="${m}" aria-pressed="${ov.mas.includes(m)}"><i class="sw" style="background:var(--ma${m})"></i>${m}</button>`).join("")}</div></div>
      <div class="set-row"><div class="grow"><b>${isIdx() ? "成交金額" : "成交量"}副圖</b></div><label class="tg"><input type="checkbox" data-ov="volume" ${ov.volume ? "checked" : ""}><span></span></label></div>
      ${adj ? `<div class="set-row"><div class="grow"><b>還原權息</b><small>向前還原</small></div><label class="tg"><input type="checkbox" data-adj ${adjust === "forward" ? "checked" : ""}><span></span></label></div>` : ""}
      <p class="xs mu" style="margin:0">這裡的開關只影響這次瀏覽；預設值在「設定 › 圖表預設」。</p></div>`);
    s.body.addEventListener("change", (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.ov) { (ov as any)[t.dataset.ov] = t.checked; try { localStorage.setItem(LS, JSON.stringify({ cost: ov.showCost, alerts: ov.showAlerts, trades: ov.showTrades })); } catch { /* */ } chart?.setOverlays({ ...ov }); legend(); }
      if (t.dataset.adj != null) { adjust = t.checked ? "forward" : "none"; loadChart(); }
    });
    s.body.addEventListener("click", (e) => { const b = (e.target as Element).closest("[data-ma]") as HTMLElement | null; if (!b) return; const m = Number(b.dataset.ma); ov.mas = ov.mas.includes(m) ? ov.mas.filter((x) => x !== m) : [...ov.mas, m].sort((a, b2) => a - b2); b.setAttribute("aria-pressed", String(ov.mas.includes(m))); chart?.setOverlays({ mas: ov.mas }); legend(); });
  }
  function tradesSheet() {
    openSheet("成交紀錄", trades.length ? `<div class="qlist">${trades.map((t) => `<div class="set-row"><span class="tag ${t.side === "buy" ? "acc" : "delayed"}">${t.side === "buy" ? "買進" : "賣出"}</span><div class="grow"><b class="num">${fmtShares(t.qty_shares)} @ ${fmtMoney(t.price, { decimals: 2 })}</b><small>${ymd(t.trade_date)} · 手續費 ${fmtMoney(t.fee)}${t.tax !== "0.00" ? ` · 稅 ${fmtMoney(t.tax)}` : ""}</small></div><span class="num">${fmtMoney(t.net_amount, { signed: true })}</span></div>`).join("")}</div><p class="xs mu">成交資料由後端匯入，App 內不能新增或修改。</p>` : `<p class="sm mu">沒有成交紀錄</p>`);
  }
  const setFs = (v: boolean) => { fs = v; document.body.classList.toggle("chart-fs", v); render(); };
  const land = matchMedia("(orientation: landscape) and (max-height: 520px)");
  const onLand = () => { if (land.matches !== fs) setFs(land.matches); };
  land.addEventListener("change", onLand);
  let lastWide = isWide(), last3 = isThreeCol();
  const onResize = () => { if (isWide() !== lastWide || isThreeCol() !== last3) { lastWide = isWide(); last3 = isThreeCol(); render(); if (last3 && !listData) api.overview().then((d) => { listData = d; listCol(); }).catch(() => {}); } };
  window.addEventListener("resize", onResize);
  const offTheme = sub("prefs", () => requestAnimationFrame(() => chart?.readColors()));
  const mq = matchMedia("(prefers-color-scheme: dark)"); const onMq = () => requestAnimationFrame(() => chart?.readColors()); mq.addEventListener("change", onMq);

  const offs = [
    on(el, "click", "[data-period]", (b) => { period = b.dataset.period as Period; bars = []; const u = new URL(location.href); render(); void u; }),
    on(document, "click", "[data-act]", async (b) => {
      if (!alive()) return;
      const a = b.dataset.act;
      if (a === "new-alert") openAlert();
      else if (a === "watch") watchSheet();
      else if (a === "layers") layersSheet();
      else if (a === "trades") tradesSheet();
      else if (a === "fs") setFs(!fs);
      else if (a === "refresh" || a === "retry") { poller.kick(); load(); }
      else if (a === "chart-retry") loadChart();
      else if (a === "close-event") b.closest(".banner")?.remove();
    }),
    on(el, "click", "[data-sub]", (b) => { ov.sub = b.dataset.sub as Overlays["sub"]; el.querySelectorAll("[data-sub]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); chart?.setOverlays({ sub: ov.sub }); legend(); }),
    on(el, "click", "[data-tab]", (b) => { listTab = b.dataset.tab as "hold" | "watch"; listCol(); }),
    on(el, "change", "[data-toggle]", async (t) => {
      const inp = t as HTMLInputElement, a = det!.alerts.find((x) => x.alert_id === inp.dataset.toggle)!;
      inp.disabled = true;
      try { const n = inp.checked ? await api.resumeAlert(a.alert_id, a.version) : await api.pauseAlert(a.alert_id, a.version); det!.alerts = det!.alerts.map((x) => (x.alert_id === n.alert_id ? n : x)); render(); }
      catch (e) { inp.checked = !inp.checked; inp.disabled = false; toast((e as Error).message, { kind: "err" }); if (e instanceof WatchError && e.code === "VERSION_CONFLICT") load(); }
    }),
  ];
  if (land.matches) setTimeout(() => setFs(true), 0);
  void confirmDialog; void savePrefs;
  return () => { poller.stop(); chart?.destroy(); offs.forEach((f) => f()); land.removeEventListener("change", onLand); window.removeEventListener("resize", onResize); offTheme(); mq.removeEventListener("change", onMq); document.body.classList.remove("chart-fs"); };
};
export default view;
