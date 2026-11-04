/** 設定（SPEC §6.7）。 */
import type { View } from "./types";
import type { Prefs, StatusResp } from "../types";
import { api } from "../api/watch";
import { S, savePrefs, sub, writable } from "../state";
import { pushState } from "../lib/push";
import { esc, on } from "../ui/dom";
import { ic } from "../ui/icons";
import { openSheet, toast } from "../ui/overlay";
import { title } from "../ui/top";
import { when } from "../lib/fmt";
import { href } from "../router";
import { A2HS } from "./notifications";

const seg = (key: keyof Prefs, opts: [string, string][], cur: string) => `<div class="seg" role="group">${opts.map(([v, t]) => `<button type="button" data-set="${key}" data-v="${v}" aria-pressed="${cur === v}" ${writable() ? "" : "disabled"}>${t}</button>`).join("")}</div>`;
const PS_TEXT = { unsupported: "不支援", not_installed: "尚未加入主畫面", default: "尚未開啟", granted: "已啟用", revoked: "需要重新啟用", denied: "已關閉" } as const;

const view: View = ({ el, setTop }) => {
  setTop(title("設定"));
  let status: StatusResp | null = null, devCount: number | null = null, devices: Awaited<ReturnType<typeof api.devices>>["rows"] | null = null;
  const draw = () => {
    const p = S.prefs!, caps = S.boot?.capabilities, now = S.boot?.market_status.now ?? new Date().toISOString();
    const ps = pushState(devices);
    el.innerHTML = `<div class="two"><div>
      <h2 class="sec-t eyebrow">通知</h2><section class="card"><a class="set-row" href="${href("/settings/notifications")}" style="color:inherit"><span style="color:var(--ac)">${ic("bell")}</span><div class="grow"><b>推播通知</b><small>${PS_TEXT[ps]}${devCount != null ? ` · ${devCount} 台裝置` : ""} · Telegram ${S.boot?.channels.telegram.connected ? "已連線" : "未連線"}</small></div><span class="tag ${ps === "granted" ? "live" : ps === "denied" || ps === "revoked" ? "cut" : "delayed"}">${PS_TEXT[ps]}</span>${ic("chevr", "s")}</a></section>
      <h2 class="sec-t eyebrow">外觀</h2><section class="card">
        <div class="set-row"><div class="grow"><b>漲跌顏色</b><small>任何情況都有 ▲▼／＋－</small></div><div class="seg" role="group"><button type="button" data-set="color_convention" data-v="tw_red_up" aria-pressed="${p.color_convention === "tw_red_up"}" ${writable() ? "" : "disabled"}><span style="color:var(--rise)">紅漲</span><span style="color:var(--fall)">綠跌</span></button><button type="button" data-set="color_convention" data-v="intl_green_up" aria-pressed="${p.color_convention === "intl_green_up"}" ${writable() ? "" : "disabled"}><span style="color:var(--fall)">綠漲</span><span style="color:var(--rise)">紅跌</span></button></div></div>
        <div class="set-row"><div class="grow"><b>主題</b></div>${seg("theme", [["system", "系統"], ["dark", "深色"], ["light", "淺色"]], p.theme)}</div></section>
      <h2 class="sec-t eyebrow">圖表預設</h2><section class="card">
        <div class="set-row"><div class="grow"><b>預設週期</b></div>${seg("default_view", [["intraday", "分時"], ["1d", "日"], ["1w", "週"], ["1M", "月"]], p.default_view)}</div>
        <div class="set-row"><div class="grow"><b>均線</b></div><div class="chips">${[5, 10, 20, 60].map((m) => `<button class="chip" type="button" data-ma="${m}" aria-pressed="${p.ma_periods.includes(m)}" ${writable() ? "" : "disabled"}><i class="sw" style="background:var(--ma${m})"></i>${m}</button>`).join("")}</div></div>
        <div class="set-row"><div class="grow"><b>副圖</b></div>${seg("sub_indicator", [["none", "無"], ["kd", "KD"], ["macd", "MACD"], ["rsi", "RSI"]], p.sub_indicator)}</div>
        <div class="set-row"><div class="grow"><b>成交量</b></div><label class="tg"><input type="checkbox" data-bool="volume_pane" ${p.volume_pane ? "checked" : ""} ${writable() ? "" : "disabled"}><span></span></label></div>
        ${caps?.adjusted_bars ? `<div class="set-row"><div class="grow"><b>還原權息</b><small>向前還原；預設不還原（與券商 App 一致）</small></div><label class="tg"><input type="checkbox" data-adj ${p.adjust_default === "forward" ? "checked" : ""} ${writable() ? "" : "disabled"}><span></span></label></div>` : ""}</section>
    </div><div>
      <h2 class="sec-t eyebrow">損益基準</h2><section class="card"><div class="set-row"><div class="grow"><b>損益顯示</b><small>扣除預估賣出手續費與證交稅（股票 0.3%、ETF 0.1%）</small></div>${seg("pnl_basis", [["gross", "毛額"], ["net_est", "扣稅費"]], p.pnl_basis)}</div></section>
      <h2 class="sec-t eyebrow">資料來源</h2><section class="card">${status ? status.sources.map((s) => `<div class="set-row"><span style="color:${s.ok ? "var(--ac)" : "var(--cut)"}">${ic("db")}</span><div class="grow"><b>${esc(s.name)}</b><small>${s.note ? esc(s.note) + " · " : ""}${s.last_ok_at ? "最後正常 " + when(s.last_ok_at, now) : "—"}</small></div><span class="tag ${s.ok ? "live" : "cut"}">${s.ok ? "正常" : "異常"}</span></div>`).join("") + `<p class="xs mu" style="margin:8px 0 0">盤中 ≤ 15 秒為即時、15–60 秒稍舊、超過 60 秒過期；收盤後顯示收盤價。這不是交易所逐筆行情，不適合作為下單依據。</p>` : `<div class="sk" style="height:120px"></div>`}</section>
      <h2 class="sec-t eyebrow">關於</h2><section class="card"><div class="set-row"><div class="grow"><b>版本</b><small class="num">${esc(S.boot?.app_version ?? "—")}</small></div></div><button class="set-row" type="button" data-a2hs style="width:100%;background:none;border-left:0;border-right:0;border-top:0;color:inherit;text-align:left;cursor:pointer"><div class="grow"><b>如何加入主畫面</b><small>iPhone／iPad 從主畫面開啟才能收推播</small></div>${ic("chevr", "s")}</button></section>
      ${import.meta.env.VITE_USE_MOCK === "1" ? '<div data-dev></div>' : ""}
    </div></div>`;
    if (import.meta.env.VITE_USE_MOCK === "1") import("./dev-panel").then((m) => { const d = el.querySelector("[data-dev]") as HTMLElement | null; if (d) m.devPanel(d); });
  };
  draw();
  api.status().then((s) => { status = s; draw(); }).catch(() => {});
  api.devices().then((r) => { devices = r.rows; devCount = r.rows.filter((d) => d.state === "active").length; draw(); }).catch(() => {});
  const save = async (patch: Partial<Prefs>) => { try { await savePrefs(patch); } catch (e) { toast((e as Error).message, { kind: "err" }); } draw(); };
  const offs = [
    on(el, "click", "[data-set]", (b) => save({ [b.dataset.set!]: b.dataset.v } as Partial<Prefs>)),
    on(el, "click", "[data-ma]", (b) => { const m = Number(b.dataset.ma), cur = S.prefs!.ma_periods; save({ ma_periods: cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m].sort((a, c) => a - c) }); }),
    on(el, "change", "[data-bool]", (t) => save({ [t.dataset.bool!]: (t as HTMLInputElement).checked } as Partial<Prefs>)),
    on(el, "change", "[data-adj]", (t) => save({ adjust_default: (t as HTMLInputElement).checked ? "forward" : "none" })),
    on(el, "click", "[data-a2hs]", () => openSheet("加入主畫面", `${A2HS}<p class="xs mu">加入後，看盤會像一般 App 一樣全螢幕開啟，並可以接收警報推播。</p>`)),
    sub("online", draw), sub("auth", draw),
  ];
  return () => offs.forEach((f) => f());
};
export default view;
