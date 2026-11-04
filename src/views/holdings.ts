/** 持倉清單與成交紀錄（/stocks/holdings）。持倉唯讀，資料由後端匯入。 */
import type { View } from "./types";
import type { Holding, PortfolioSummary, Trade } from "../types";
import { api } from "../api/watch";
import { Poller } from "../poll";
import { S } from "../state";
import { dirCls, empty, errorBox, qrow, skelRows } from "../ui/components";
import { esc, on } from "../ui/dom";
import { backBtn, title } from "../ui/top";
import { decDir, fmtMoney, fmtPct, fmtShares, ymd } from "../lib/fmt";
import { sortHoldings } from "./overview";
import { stockHref } from "../router";

const view: View = ({ el, setTop }) => {
  setTop(backBtn("總覽", "/") + title("持倉"));
  let data: { summary: PortfolioSummary; holdings: Holding[] } | null = null, trades: Trade[] = [], err = "", tab: "hold" | "trades" = "hold";
  const draw = () => {
    if (!data) { el.innerHTML = `<div class="narrow"><div class="card">${err ? errorBox(err) : skelRows(4)}</div></div>`; return; }
    const s = data.summary, basis = S.prefs?.pnl_basis ?? "gross";
    el.innerHTML = `<div class="narrow stack">
      ${s ? `<section class="card hl"><dl class="dl"><div><dt>總市值</dt><dd>${fmtMoney(s.market_value)}</dd></div><div><dt>總成本</dt><dd>${fmtMoney(s.cost)}</dd></div>
        <div><dt>未實現損益</dt><dd class="chg ${dirCls(decDir(s.unrealized_pnl))}">${fmtMoney(s.unrealized_pnl, { signed: true })}</dd></div><div><dt>報酬率</dt><dd class="chg ${dirCls(decDir(s.unrealized_pnl))}">${fmtPct(s.unrealized_pnl_pct)}</dd></div>
        <div><dt>預估淨額</dt><dd>${fmtMoney(s.unrealized_pnl_net_est, { signed: true })}</dd></div><div><dt>今年已實現</dt><dd>${fmtMoney(s.realized_pnl_ytd, { signed: true })}</dd></div></dl></section>` : ""}
      <div class="seg wide" role="tablist"><button type="button" data-tab="hold" aria-pressed="${tab === "hold"}">持倉 <span class="num">${data.holdings.length}</span></button><button type="button" data-tab="trades" aria-pressed="${tab === "trades"}">成交紀錄</button></div>
      ${tab === "hold" ? `<div class="card flush list-card">${data.holdings.length ? `<div class="qlist">${sortHoldings(data.holdings, "mv").map((h) => qrow(h.symbol, h.name, h.quote, h.spark, { holding: h, basis })).join("")}</div>` : empty("brief", "還沒有持倉", "持倉由後端從成交信件匯入。")}</div>`
        : `<div class="card">${trades.length ? trades.map((t) => `<a class="set-row" href="${stockHref(t.symbol)}" style="color:inherit"><span class="tag ${t.side === "buy" ? "acc" : "delayed"}">${t.side === "buy" ? "買進" : "賣出"}</span><div class="grow"><b>${esc(t.name)} <span class="code">${esc(t.symbol)}</span></b><small class="num">${ymd(t.trade_date)} · ${fmtShares(t.qty_shares)} @ ${fmtMoney(t.price, { decimals: 2 })}</small></div><span class="num">${fmtMoney(t.net_amount, { signed: true })}</span></a>`).join("") : empty("brief", "沒有成交紀錄", "")}</div>
          <p class="xs mu" style="text-align:center">成交資料由後端匯入，App 內不能新增或修改。</p>`}</div>`;
  };
  const load = async () => { try { const [p, t] = await Promise.all([api.portfolio(), api.trades({ limit: 100 })]); data = p; trades = t.rows; err = ""; } catch (e) { err = (e as Error).message; } draw(); };
  draw(); load();
  const poller = new Poller(async () => { data = await api.portfolio(); if (tab === "hold") draw(); });
  const offs = [on(el, "click", "[data-tab]", (b) => { tab = b.dataset.tab as typeof tab; draw(); }), on(el, "click", "[data-act=retry]", () => { err = ""; draw(); load(); })];
  return () => { poller.stop(); offs.forEach((f) => f()); };
};
export default view;
