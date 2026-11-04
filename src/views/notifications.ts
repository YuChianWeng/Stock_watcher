/** 通知設定（SPEC T-1）：權限 6 種狀態與啟用流程、裝置、測試通知、Telegram 與備援開關。 */
import type { View } from "./types";
import type { PushDevice } from "../types";
import { api } from "../api/watch";
import { S, savePrefs, sub, writable } from "../state";
import { enablePush, pushState, type PushState } from "../lib/push";
import { esc, on } from "../ui/dom";
import { ic } from "../ui/icons";
import { confirmDialog, toast } from "../ui/overlay";
import { backBtn, title } from "../ui/top";
import { when } from "../lib/fmt";

export const A2HS = `<ol class="steps"><li><span class="n">1</span><span>點 Safari 下方的 ${ic("share", "s")} <b>分享</b></span></li><li><span class="n">2</span><span>往下捲，選 ${ic("addsq", "s")} <b>加入主畫面</b></span></li><li><span class="n">3</span><span>從主畫面的「看盤」圖示開啟，再回到這裡開啟通知</span></li></ol>`;

function permCard(st: PushState, devices: PushDevice[]) {
  const now = S.boot?.market_status.now ?? new Date().toISOString();
  const devRows = devices.map((d) => `<div class="set-row"><span class="mu">${ic("phone")}</span><div class="grow"><b>${esc(d.label)} ${d.is_current ? '<span class="tag live">目前裝置</span>' : ""}${d.state === "revoked" ? '<span class="tag cut">已失效</span>' : d.state === "failing" ? '<span class="tag delayed">傳送失敗</span>' : ""}</b><small>${d.last_ok_at ? `最後成功 ${when(d.last_ok_at, now)}` : "尚未成功送達"} · 登記於 ${when(d.created_at, now)}</small></div><button class="btn sm g" type="button" data-rmdev="${esc(d.device_id)}" ${writable() ? "" : "disabled"}>移除</button></div>`).join("");
  const C: Record<PushState, [string, string, string, string]> = {
    unsupported: ["phone", "這台裝置不支援推播", "推播需要 iOS／iPadOS 16.4 以上，並從主畫面開啟。你仍然可以建立警報，通知會改送 Telegram。", ""],
    not_installed: ["addsq", "先把看盤加入主畫面", "iPhone 和 iPad 只有從主畫面開啟的 App 才能收推播。", A2HS],
    default: ["bell", "開啟警報推播", "到價、跌破成本、爆量時，鎖屏也能馬上知道。推播只含商品與價格，不含部位與金額。", `<button class="btn p wide" type="button" data-enable ${writable() ? "" : "disabled"}>${ic("bell", "s")}開啟通知</button><p class="xs mu" style="margin:0">按下後系統會詢問是否允許</p>`],
    granted: ["check", "推播已啟用", "", `<button class="btn o wide" type="button" data-test ${writable() ? "" : "disabled"}>${ic("send", "s")}傳送測試通知</button>`],
    revoked: ["refresh", "這台裝置的推播已失效", "訂閱過期或被系統撤銷，需要重新啟用才能收到警報。", `<button class="btn p wide" type="button" data-enable ${writable() ? "" : "disabled"}>重新啟用通知</button>`],
    denied: ["x", "推播已被關閉", "網頁無法再次詢問。請到 iPhone 的 <b>設定 → 通知 → 看盤</b>，開啟「允許通知」後回到這裡。", `<button class="btn wide" type="button" data-recheck>我已開啟，重新檢查</button>`],
  };
  const [i, t, d, a] = C[st];
  return `<section class="card perm perm-${st}" aria-live="polite"><div class="empty" style="padding:12px 4px"><div class="ei" ${st === "denied" || st === "revoked" ? 'style="color:var(--cut);background:var(--cut-soft);box-shadow:none"' : ""}>${ic(i, "l")}</div><h2 class="h2">${t}</h2>${d ? `<p class="sm" style="margin:0;max-width:340px">${d}</p>` : ""}${a}</div>
    ${devices.length ? `<h3 class="sec-t eyebrow">已登記的裝置 · ${devices.filter((x) => x.state === "active").length} 台可接收</h3>${devRows}` : st === "granted" ? "" : ""}</section>`;
}

const view: View = ({ el, setTop }) => {
  setTop(backBtn("設定", "/settings") + title("通知"));
  let devices: PushDevice[] = [], loaded = false;
  const draw = () => {
    const st = pushState(loaded ? devices : null), p = S.prefs!, tg = S.boot?.channels.telegram.connected;
    el.innerHTML = `<div class="narrow stack">${loaded ? permCard(st, devices) : `<div class="card"><div class="sk" style="height:200px"></div></div>`}
      <h2 class="sec-t eyebrow">Telegram（備援）</h2><section class="card">
        <div class="set-row"><span style="color:${tg ? "var(--ac)" : "var(--mu)"}">${ic("send")}</span><div class="grow"><b>Telegram ${tg ? '<span class="tag live">已連線</span>' : '<span class="tag nodata">未連線</span>'}</b><small>連線由後端設定，App 只顯示狀態</small></div></div>
        <div class="set-row"><div class="grow"><b>推播失敗時改送 Telegram</b><small>沒有可用裝置或推播送不出去時</small></div><label class="tg"><input type="checkbox" data-pref="telegram_fallback" ${p.telegram_fallback ? "checked" : ""} ${writable() ? "" : "disabled"}><span></span></label></div>
        <div class="set-row"><div class="grow"><b>所有警報同時送 Telegram</b><small>推播是盡力送達，重要警報建議開啟</small></div><label class="tg"><input type="checkbox" data-pref="telegram_always" ${p.telegram_always ? "checked" : ""} ${writable() ? "" : "disabled"}><span></span></label></div></section>
      <p class="xs mu">推播內容只有商品、規則與價格，不含持有數量與金額。</p></div>`;
  };
  const load = async () => { try { devices = (await api.devices()).rows; } catch { devices = []; } loaded = true; draw(); };
  draw(); load();
  const offs = [
    on(el, "click", "[data-enable]", async (b) => { (b as HTMLButtonElement).disabled = true; try { await enablePush(); toast("推播已啟用"); await load(); } catch (e) { toast((e as Error).message, { kind: "err" }); await load(); } }),
    on(el, "click", "[data-test]", async (b) => { (b as HTMLButtonElement).disabled = true; try { const r = await api.pushTest(); toast(`已送出測試通知：${r.sent} 台成功${r.failed ? `，${r.failed} 台失敗` : ""}`); } catch (e) { toast((e as Error).message, { kind: "err" }); } (b as HTMLButtonElement).disabled = false; }),
    on(el, "click", "[data-recheck]", () => load()),
    on(el, "click", "[data-rmdev]", async (b) => { const d = devices.find((x) => x.device_id === b.dataset.rmdev)!; if (!(await confirmDialog(`移除「${esc(d.label)}」？`, "這台裝置將不再收到警報推播。", "移除", true))) return; try { await api.deleteDevice(d.device_id); devices = devices.filter((x) => x !== d); draw(); } catch (e) { toast((e as Error).message, { kind: "err" }); } }),
    on(el, "change", "[data-pref]", async (t) => { const i = t as HTMLInputElement; try { await savePrefs({ [i.dataset.pref!]: i.checked }); } catch (e) { toast((e as Error).message, { kind: "err" }); } draw(); }),
    sub("online", draw), sub("auth", draw),
  ];
  const onVis = () => { if (document.visibilityState === "visible") load(); };
  document.addEventListener("visibilitychange", onVis);
  return () => { offs.forEach((f) => f()); document.removeEventListener("visibilitychange", onVis); };
};
export default view;
