/** 通知紀錄（SPEC §6.6）：時間倒序、未讀、觸發價格、各管道投遞結果、全部標為已讀。 */
import type { View } from "./types";
import type { AlertEvent } from "../types";
import { api } from "../api/watch";
import { S, setUnread, writable } from "../state";
import { empty, errorBox, skelRows } from "../ui/components";
import { esc, on } from "../ui/dom";
import { ic } from "../ui/icons";
import { toast } from "../ui/overlay";
import { backBtn, title } from "../ui/top";
import { fmtPct, fmtPrice, when } from "../lib/fmt";
import { navigate, stockHref } from "../router";

const CH = { push: "推播", telegram: "Telegram" } as const;
const ST = { sent: ["sent", "check", ""], failed: ["failed", "x", "失敗"], skipped: ["skipped", "", "略過"] } as const;

export function eventRows(rows: AlertEvent[]) {
  const now = S.boot?.market_status.now ?? new Date().toISOString();
  return rows.map((e) => {
    const o = e.observed, d = o.change_pct == null ? "" : o.change_pct > 0 ? "up" : o.change_pct < 0 ? "dn" : "flat";
    return `<div class="ev ${e.read_at ? "" : "unread"}" data-ev="${esc(e.event_id)}" data-sym="${esc(e.symbol)}" role="button" tabindex="0" aria-label="${esc(e.message.title)}${e.read_at ? "" : "，未讀"}">
      <span class="ud" aria-hidden="true"></span>
      <div style="min-width:0"><div class="t">${esc(e.message.title)}</div>
        <div class="b">${o.last != null ? `現價 <span class="num">${fmtPrice(o.last)}</span>` : ""}${o.change_pct != null ? `（<span class="chg ${d} no-glyph">${fmtPct(o.change_pct)}</span>）` : ""} · ${e.late ? '<span style="color:var(--wa)">延後補發</span>' : o.data_status === "live" ? "即時" : "稍舊"}</div>
        <div class="row wrap-row" style="margin-top:6px;gap:6px">${e.deliveries.map((x) => { const [c, i, t] = ST[x.state]; return `<span class="dv ${c}" title="${esc(x.reason ?? "")}">${i ? ic(i, "xs") : ""}${CH[x.channel]}${t}${x.reason && x.state !== "sent" ? `：${esc(x.reason)}` : ""}</span>`; }).join("")}</div></div>
      <span class="xs mu num">${when(e.fired_at, now)}</span></div>`;
  }).join("");
}

export function mountInbox(box: HTMLElement, opt: { compact?: boolean } = {}) {
  let rows: AlertEvent[] | null = null, err = "";
  const draw = () => {
    const unread = rows?.filter((r) => !r.read_at).length ?? 0;
    box.innerHTML = `<div class="sec-t"><h2 class="eyebrow">通知紀錄${unread ? ` · ${unread} 則未讀` : ""}</h2><button class="link" type="button" data-readall ${unread && writable() ? "" : "disabled"}>${ic("check", "s")}全部標為已讀</button></div>
      <div class="card">${rows == null ? (err ? errorBox(err) : skelRows(4)) : rows.length ? eventRows(rows) : empty("bell", "還沒有通知", "警報觸發後，通知會出現在這裡。", opt.compact ? "" : `<a class="btn o" href="/stocks/alerts">查看警報</a>`)}</div>`;
  };
  const load = async () => { try { const r = await api.events({ limit: 50 }); rows = r.rows; setUnread(r.unread); err = ""; } catch (e) { err = (e as Error).message; } draw(); };
  draw(); load();
  const offs = [
    on(box, "click", "[data-readall]", async () => { try { const r = await api.readEvents({ all: true }); setUnread(r.unread); rows?.forEach((x) => (x.read_at ??= new Date().toISOString())); draw(); toast("已全部標為已讀"); } catch (e) { toast((e as Error).message, { kind: "err" }); } }),
    on(box, "click", "[data-ev]", async (el) => {
      const ev = rows?.find((x) => x.event_id === el.dataset.ev);
      if (ev && !ev.read_at && writable()) api.readEvents({ ids: [ev.event_id] }).then((r) => setUnread(r.unread)).catch(() => {});
      navigate(stockHref(el.dataset.sym!) + `?event=${encodeURIComponent(el.dataset.ev!)}`);
    }),
    on(box, "click", "[data-act=retry]", () => { err = ""; draw(); load(); }),
  ];
  return () => offs.forEach((f) => f());
}

const view: View = ({ el, setTop }) => {
  setTop(backBtn("返回", "/alerts") + title("通知紀錄"));
  el.innerHTML = `<div class="narrow" data-inbox></div>`;
  return mountInbox(el.querySelector("[data-inbox]")!);
};
export default view;
