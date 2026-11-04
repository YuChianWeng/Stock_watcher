/**
 * 新增／編輯警報（SPEC §6.5，設計稿 §5.5）。手機全頁、桌面右側面板，共用 mountAlertForm。
 * - 建立前呼叫 /alerts/preview 顯示距離與「目前已滿足條件」。
 * - 登入過期時保留表單（sessionStorage 草稿）；POST 帶 Idempotency-Key（同一次編輯重送沿用）。
 */
import type { View } from "./types";
import type { Alert, AlertChannel, AlertFrequency, AlertRule, InstrumentDetail, PushDevice, RuleType } from "../types";
import { api } from "../api/watch";
import { newIdempotencyKey, WatchError } from "../api/client";
import { S, sub, writable } from "../state";
import { chg, pill, priceEl, RULE_ICON, ruleText } from "../ui/components";
import { esc } from "../ui/dom";
import { ic } from "../ui/icons";
import { confirmDialog, toast } from "../ui/overlay";
import { backBtn, centerTitle } from "../ui/top";
import { fmtPct, fmtPrice } from "../lib/fmt";
import { snapPrice, stepPrice, tickSize } from "../lib/ticks";
import { back, href, navigate, stockHref } from "../router";
import { pushState } from "../lib/push";
import { searchRows } from "../ui/search";

const RULES: [RuleType, string, string, string][] = [
  ["price", "到價", "成交價 ≥ 或 ≤ 某價", "≥ 105"],
  ["change_pct", "漲跌幅", "今日相對昨收", "≤ −5%"],
  ["pnl_pct", "持倉損益", "未實現損益％（持有時）", "≥ +20%"],
  ["volume_ratio", "爆量", "今日量 ÷ 近 5 日均量", "≥ 2 倍"],
  ["ma_cross", "均線突破", "現價上穿／下穿日線", "下穿 20 日線"],
  ["limit", "漲跌停", "成交價到達漲停或跌停", "漲停"],
];
const FREQ: [AlertFrequency, string][] = [["once", "一次"], ["daily", "每日一次"], ["every", "每次"]];

type Form = { symbol: string | null; type: RuleType; op: "gte" | "lte"; value: number; period: 5 | 10 | 20 | 60; dir: "above" | "below" | "up" | "down"; frequency: AlertFrequency; cooldown: number; channels: AlertChannel[]; note: string; expires: string };
type Opt = { symbol?: string; price?: number; alert?: Alert; detail?: InstrumentDetail | null; onDone: (a: Alert | null) => void; inSheet?: boolean };

const DRAFT = (id: string) => "sw-alert-draft:" + id;
function ruleFromForm(f: Form): AlertRule {
  switch (f.type) {
    case "price": case "change_pct": case "pnl_pct": return { type: f.type, op: f.op, value: f.value };
    case "volume_ratio": return { type: "volume_ratio", value: f.value };
    case "ma_cross": return { type: "ma_cross", period: f.period, direction: f.dir === "above" ? "above" : "below" };
    case "limit": return { type: "limit", direction: f.dir === "down" ? "down" : "up" };
  }
}
const r2 = (v: number) => Math.round(v * 100) / 100;

export function mountAlertForm(root: HTMLElement, o: Opt) {
  const draftKey = DRAFT(o.alert?.alert_id ?? "new");
  let det: InstrumentDetail | null = o.detail ?? null;
  let devices: PushDevice[] | null = null;
  const idem = newIdempotencyKey();
  let errors: Record<string, string> = {};
  let preview: Awaited<ReturnType<typeof api.preview>> | null = null;
  let busy = false;
  const defaults = (type: RuleType, last: number | null): Partial<Form> => {
    switch (type) {
      case "price": return { op: o.price != null && last != null && o.price < last ? "lte" : "gte", value: o.price ?? (last != null ? stepPrice(snapPrice(last * 1.03, det?.instrument.kind), 1, det?.instrument.kind) : 0) };
      case "change_pct": return { op: "lte", value: -5 };
      case "pnl_pct": return { op: "gte", value: 20 };
      case "volume_ratio": return { value: 2 };
      case "ma_cross": return { period: 20, dir: "below" };
      case "limit": return { dir: "up" };
    }
  };
  let f: Form;
  const a = o.alert;
  if (a) {
    const r = a.rule;
    f = { symbol: a.symbol, type: r.type, op: "op" in r ? r.op : "gte", value: "value" in r ? r.value : 0, period: r.type === "ma_cross" ? r.period : 20, dir: r.type === "ma_cross" ? r.direction : r.type === "limit" ? r.direction : "up", frequency: a.frequency, cooldown: a.cooldown_minutes, channels: [...a.channels], note: a.note ?? "", expires: a.expires_at ? a.expires_at.slice(0, 16) : "" };
  } else {
    f = { symbol: o.symbol ?? null, type: "price", op: "gte", value: 0, period: 20, dir: "up", frequency: "every", cooldown: 30, channels: S.prefs?.telegram_always ? ["push", "telegram"] : ["push"], note: "", expires: "" };
  }
  try { const d = sessionStorage.getItem(draftKey); if (d) { const saved = JSON.parse(d) as Form; if (!o.symbol || saved.symbol === o.symbol) f = saved; } } catch { /* */ }
  const saveDraft = () => { try { sessionStorage.setItem(draftKey, JSON.stringify(f)); } catch { /* */ } };
  const clearDraft = () => { try { sessionStorage.removeItem(draftKey); } catch { /* */ } };

  const isIdx = () => det?.instrument.kind === "index";
  const last = () => det?.quote.last ?? null;
  const allowed = (t: RuleType) => !(isIdx() && (t === "volume_ratio" || t === "limit" || t === "pnl_pct")) && !(t === "pnl_pct" && det && !det.position);

  async function loadDet() {
    if (!f.symbol) return;
    try { det = await api.instrument(f.symbol); if (!a && f.value === 0) Object.assign(f, defaults(f.type, last())); } catch (e) { errors.symbol = (e as Error).message; }
    draw(); runPreview();
  }
  api.devices().then((r) => { devices = r.rows; draw(); }).catch(() => {});

  let pt = 0;
  function runPreview() {
    clearTimeout(pt);
    if (!f.symbol || !det) return;
    pt = window.setTimeout(async () => {
      try { preview = await api.preview(f.symbol!, ruleFromForm(f)); errors = Object.fromEntries(preview.errors.map((e) => [e.field, e.reason])); }
      catch { preview = null; }
      drawLive();
    }, 220);
  }

  const stepVal = (dir: 1 | -1) => {
    if (f.type === "price") f.value = f.value ? stepPrice(f.value, dir, det?.instrument.kind) : last() ?? 0;
    else if (f.type === "volume_ratio") f.value = Math.max(1.5, r2(f.value + dir * 0.5));
    else if (f.type === "change_pct") { f.value = r2(Math.max(-10, Math.min(10, f.value + dir * 0.5))); if (f.value === 0) f.value = dir * 0.5; }
    else f.value = r2(f.value + dir * 1);
  };
  const valueText = () => (f.type === "price" ? fmtPrice(f.value) : f.type === "volume_ratio" ? String(f.value) : (f.value > 0 ? "+" : f.value < 0 ? "−" : "") + Math.abs(f.value));
  const unit = () => ({ price: "元", change_pct: "%", pnl_pct: "%", volume_ratio: "倍", ma_cross: "", limit: "" })[f.type];

  function symbolBlock() {
    if (det && f.symbol) return `<div class="field"><span class="lb">商品</span><div class="opt on" style="cursor:default"><div class="grow" style="min-width:0"><b class="trunc">${esc(det.instrument.name)}</b> <span class="code">${esc(det.instrument.symbol)}</span></div>${priceEl(det.quote)}${pill(det.quote)}${a ? "" : `<button class="btn sm g" type="button" data-f="change-symbol">更換</button>`}</div></div>`;
    return `<div class="field"><label class="lb" for="al-sym">商品</label><input id="al-sym" class="input" type="search" placeholder="搜尋代號或名稱" autocomplete="off" data-f="sym-q"><div class="qlist" data-symres></div>${errors.symbol ? `<span class="ferr">${ic("warn", "xs")}${esc(errors.symbol)}</span>` : ""}</div>`;
  }
  function ruleBlock() {
    return `<div class="field"><span class="lb">規則</span><div class="rules">${RULES.map(([t, n, d, e]) => { const ok = allowed(t); return `<button class="opt ${f.type === t ? "on" : ""}" type="button" data-rule="${t}" aria-pressed="${f.type === t}" ${ok ? "" : "disabled style=\"opacity:.4\""}><span class="oi">${ic(RULE_ICON[t])}</span><span class="grow" style="min-width:0"><b class="h3">${n}</b><br><span class="xs mu">${d}</span><br><span class="xs mu2">例：${e}${!ok && t === "pnl_pct" ? "（未持有）" : ""}</span></span></button>`; }).join("")}</div>${errors["rule.type"] ? `<span class="ferr">${ic("warn", "xs")}${esc(errors["rule.type"])}</span>` : ""}</div>`;
  }
  function condBlock() {
    const t = f.type;
    if (t === "ma_cross") return `<div class="field"><span class="lb">條件</span><div class="seg wide">${[5, 10, 20, 60].map((p) => `<button type="button" data-period="${p}" aria-pressed="${f.period === p}">${p} 日</button>`).join("")}</div><div class="seg wide" style="margin-top:6px"><button type="button" data-dir="above" aria-pressed="${f.dir === "above"}">↗ 上穿</button><button type="button" data-dir="below" aria-pressed="${f.dir !== "above"}">↘ 下穿</button></div><div data-live></div></div>`;
    if (t === "limit") return `<div class="field"><span class="lb">條件</span><div class="seg wide"><button type="button" data-dir="up" aria-pressed="${f.dir !== "down"}">▲ 漲停 ${fmtPrice(det?.quote.limit_up)}</button><button type="button" data-dir="down" aria-pressed="${f.dir === "down"}">▼ 跌停 ${fmtPrice(det?.quote.limit_down)}</button></div><div data-live></div></div>`;
    const opSeg = t === "volume_ratio" ? "" : `<div class="seg wide"><button type="button" data-op="gte" aria-pressed="${f.op === "gte"}">≥ ${t === "price" ? "漲到" : t === "change_pct" ? "漲幅達" : "損益達"}</button><button type="button" data-op="lte" aria-pressed="${f.op === "lte"}">≤ ${t === "price" ? "跌到" : t === "change_pct" ? "跌幅達" : "虧損達"}</button></div>`;
    const tick = t === "price" && f.value ? tickSize(f.value, det?.instrument.kind) : null;
    return `<div class="field"><span class="lb">條件</span>${opSeg}
      <div class="stepper" style="margin-top:6px"><button class="ibtn" type="button" data-step="-1" aria-label="減少">${ic("minus")}</button><input class="input ${errors["rule.value"] ? "err" : ""}" inputmode="decimal" data-f="value" value="${esc(valueText())}" aria-label="門檻（${unit()}）"><button class="ibtn" type="button" data-step="1" aria-label="增加">${ic("plus")}</button></div>
      <div data-live></div>
      ${t === "price" && det?.quote.limit_up != null ? `<div class="hint ac">${ic("info", "s")}<span>可設定範圍 <span class="num">${fmtPrice(det.quote.limit_down)}</span>（跌停）～ <span class="num">${fmtPrice(det.quote.limit_up)}</span>（漲停）${tick ? ` · 跳動 ${tick}` : ""}</span></div>` : ""}
      ${t === "change_pct" ? `<p class="xs mu" style="margin:0">今日相對昨收；範圍 ±10%</p>` : ""}${t === "volume_ratio" ? `<p class="xs mu" style="margin:0">今日累計量 ≥ 近 5 日平均量 × 倍數；至少 1.5 倍</p>` : ""}</div>`;
  }
  function liveHtml() {
    const cur = preview?.current ?? null, dist = preview?.distance_pct ?? null;
    const t = f.type;
    const curText = cur == null ? "—" : t === "price" || t === "limit" ? `現價 <span class="num">${fmtPrice(cur)}</span>` : t === "ma_cross" ? `MA${f.period} <span class="num">${fmtPrice(cur)}</span> · 現價 <span class="num">${fmtPrice(last())}</span>` : t === "volume_ratio" ? `目前 <span class="num">${cur}</span> 倍` : `目前 <span class="num">${fmtPct(cur)}</span>`;
    const distText = dist == null ? "" : t === "change_pct" || t === "pnl_pct" ? `距離門檻 ${fmtPct(dist)}` : t === "ma_cross" ? `現價距均線 ${fmtPct(dist)}` : `距離現價 ${fmtPct(dist)}`;
    const err = errors["rule.value"];
    return `<div class="between xs" style="margin-top:4px"><span class="mu">${curText}</span><span class="dist">${preview?.already_met ? "已滿足" : distText}</span></div>
      ${err ? `<span class="ferr">${ic("warn", "xs")}${esc(err)}</span>` : ""}
      ${preview?.already_met ? `<div class="hint wa" role="status" style="margin-top:6px">${ic("info", "s")}<span><b>目前已滿足條件，不會立刻通知。</b>需先離開條件，再次觸及時才會通知。</span></div>` : ""}`;
  }
  function freqBlock() {
    return `<div class="field"><span class="lb">頻率</span><div class="seg wide">${FREQ.map(([k, t]) => `<button type="button" data-freq="${k}" aria-pressed="${f.frequency === k}">${t}</button>`).join("")}</div>
      <span class="xs mu">${f.frequency === "once" ? "通知一次後自動停用（狀態變成「已觸發」）" : f.frequency === "daily" ? "每個交易日最多通知一次" : `條件離開後再次成立就通知，兩次至少間隔 <b class="num">${f.cooldown}</b> 分鐘`}</span>
      ${f.frequency === "every" ? `<div class="row"><span class="sm mu grow">冷卻時間</span><div class="stepper" style="grid-template-columns:44px 90px 44px"><button class="ibtn" type="button" data-cool="-5" aria-label="減少冷卻">${ic("minus")}</button><input class="input ${errors.cooldown_minutes ? "err" : ""}" inputmode="numeric" data-f="cooldown" value="${f.cooldown}" aria-label="冷卻分鐘" style="font-size:18px;min-height:44px"><button class="ibtn" type="button" data-cool="5" aria-label="增加冷卻">${ic("plus")}</button></div></div>${errors.cooldown_minutes ? `<span class="ferr">${esc(errors.cooldown_minutes)}</span>` : ""}` : ""}</div>`;
  }
  function chanBlock() {
    const ps = pushState(devices);
    const activeDevs = devices?.filter((d) => d.state === "active").length ?? null;
    const noPush = f.channels.includes("push") && (activeDevs === 0 || ps === "unsupported" || ps === "denied");
    const tg = S.boot?.channels.telegram.connected;
    return `<div class="field"><span class="lb">通知管道</span><div class="row">
      <button class="chip ${f.channels.includes("push") ? "on" : ""}" type="button" data-chan="push" aria-pressed="${f.channels.includes("push")}">${ic("phone", "s")}推播</button>
      <button class="chip ${f.channels.includes("telegram") ? "on" : ""}" type="button" data-chan="telegram" aria-pressed="${f.channels.includes("telegram")}">${ic("send", "s")}Telegram${tg ? "" : "（未連線）"}</button></div>
      ${errors.channels ? `<span class="ferr">${ic("warn", "xs")}${esc(errors.channels)}</span>` : ""}
      ${noPush ? `<div class="hint wa">${ic("warn", "s")}<span>目前沒有可接收推播的裝置。<a href="${href("/settings/notifications")}">到通知設定啟用</a>，或同時勾選 Telegram。</span></div>` : ""}
      ${S.prefs?.telegram_always ? `<p class="xs mu" style="margin:0">設定為「所有警報同時送 Telegram」</p>` : ""}</div>`;
  }
  function extraBlock() {
    return `<div class="field"><label class="lb" for="al-note">備註（選填）</label><input id="al-note" class="input ${errors.note ? "err" : ""}" data-f="note" maxlength="60" placeholder="例如：突破前高再加碼" value="${esc(f.note)}">${errors.note ? `<span class="ferr">${esc(errors.note)}</span>` : `<span class="xs mu2" style="text-align:right">${f.note.length}/60</span>`}</div>
      <div class="field"><label class="lb" for="al-exp">到期（選填）</label><input id="al-exp" class="input" type="datetime-local" data-f="expires" value="${esc(f.expires)}"></div>`;
  }
  function draw() {
    const ro = !writable();
    root.innerHTML = `<form class="stack alert-form" novalidate>
      ${symbolBlock()}
      ${f.symbol && det ? ruleBlock() + condBlock() + freqBlock() + chanBlock() + extraBlock() : ""}
      ${errors._ ? `<div class="hint cut">${ic("warn", "s")}<span>${esc(errors._)}</span></div>` : ""}
      ${ro ? `<div class="hint cut">${ic("wifioff", "s")}<span>${S.authExpired ? "登入已過期，表單內容已保留。重新登入後再送出。" : "離線中，無法建立警報。表單內容已保留。"}</span></div>` : ""}
      <div class="row form-actions" style="${o.inSheet ? "" : "position:sticky;bottom:calc(8px + var(--sab));"}">
        ${a ? `<button class="btn d" type="button" data-f="delete" ${ro ? "disabled" : ""}>${ic("trash", "s")}刪除</button>` : ""}
        <span class="grow"></span>
        ${o.inSheet ? `<button class="btn g" type="button" data-f="cancel">取消</button>` : ""}
        <button class="btn p" type="submit" ${ro || !f.symbol || busy ? "disabled" : ""}>${ic("check", "s")}${a ? "儲存" : "建立警報"}</button>
      </div></form>`;
    drawLive();
  }
  function drawLive() { const l = root.querySelector("[data-live]"); if (l) l.innerHTML = liveHtml(); const inp = root.querySelector('[data-f="value"]') as HTMLInputElement | null; if (inp) inp.classList.toggle("err", !!errors["rule.value"]); }

  // 事件
  root.addEventListener("click", async (e) => {
    const t = e.target as Element, b = t.closest("button") as HTMLButtonElement | null;
    if (!b) { const go = t.closest("[data-go]") as HTMLElement | null; if (go) { f.symbol = go.dataset.go!; det = null; saveDraft(); draw(); loadDet(); } return; }
    if (b.dataset.add) { e.preventDefault(); f.symbol = b.dataset.add; det = null; draw(); loadDet(); return; }
    if (b.dataset.rule) { f.type = b.dataset.rule as RuleType; Object.assign(f, defaults(f.type, last())); errors = {}; }
    else if (b.dataset.op) { f.op = b.dataset.op as "gte" | "lte"; if (f.type === "change_pct" || f.type === "pnl_pct") f.value = (f.op === "gte" ? 1 : -1) * Math.abs(f.value); }
    else if (b.dataset.step) stepVal(Number(b.dataset.step) as 1 | -1);
    else if (b.dataset.period) f.period = Number(b.dataset.period) as Form["period"];
    else if (b.dataset.dir) f.dir = b.dataset.dir as Form["dir"];
    else if (b.dataset.freq) f.frequency = b.dataset.freq as AlertFrequency;
    else if (b.dataset.cool) f.cooldown = Math.max(5, f.cooldown + Number(b.dataset.cool));
    else if (b.dataset.chan) { const c = b.dataset.chan as AlertChannel; f.channels = f.channels.includes(c) ? f.channels.filter((x) => x !== c) : [...f.channels, c]; }
    else if (b.dataset.f === "change-symbol") { f.symbol = null; det = null; }
    else if (b.dataset.f === "cancel") { clearDraft(); o.onDone(null); return; }
    else if (b.dataset.f === "delete") { if (a && (await confirmDialog("刪除警報？", `${esc(a.name)}｜${esc(ruleText(a.rule))}`, "刪除", true))) { try { await api.deleteAlert(a.alert_id); clearDraft(); toast("已刪除"); o.onDone(null); } catch (err) { toast((err as Error).message, { kind: "err" }); } } return; }
    else return;
    saveDraft(); draw(); runPreview();
  });
  root.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.f === "sym-q") { symSearch(t.value); return; }
    if (t.dataset.f === "value") { const v = Number(t.value.replace(/[−–]/g, "-").replace(/[^\d.+-]/g, "")); if (Number.isFinite(v)) { f.value = v; saveDraft(); runPreview(); } }
    if (t.dataset.f === "cooldown") { f.cooldown = Math.max(0, Math.round(Number(t.value) || 0)); saveDraft(); }
    if (t.dataset.f === "note") { f.note = t.value; saveDraft(); }
    if (t.dataset.f === "expires") { f.expires = t.value; saveDraft(); }
  });
  root.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.f === "value" && f.type === "price" && f.value > 0) { f.value = snapPrice(f.value, det?.instrument.kind); t.value = valueText(); runPreview(); }
    if (t.dataset.f === "cooldown") { if (f.cooldown < 5) errors.cooldown_minutes = "冷卻時間至少 5 分鐘"; else delete errors.cooldown_minutes; draw(); }
  });
  let st = 0;
  function symSearch(q: string) {
    clearTimeout(st);
    st = window.setTimeout(async () => {
      const box = root.querySelector("[data-symres]"); if (!box) return;
      if (!q.trim()) { box.innerHTML = ""; return; }
      try { const r = await api.search(q.trim(), 10); box.innerHTML = searchRows(r.rows, { addLabel: "選擇", inList: new Set() }); }
      catch (e) { box.innerHTML = `<p class="ferr">${esc((e as Error).message)}</p>`; }
    }, 180);
  }
  root.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!f.symbol || busy || !writable()) return;
    // 前端先擋（伺服器仍會驗證）
    errors = {};
    if (!f.channels.length) errors.channels = "至少選一個通知管道";
    if (f.frequency === "every" && f.cooldown < 5) errors.cooldown_minutes = "冷卻時間至少 5 分鐘";
    if (f.type === "price" && det?.quote.limit_up != null && (f.value > det.quote.limit_up || f.value < (det.quote.limit_down ?? 0))) errors["rule.value"] = "超出漲跌停範圍";
    if (f.type === "change_pct" && (Math.abs(f.value) > 10 || f.value === 0)) errors["rule.value"] = "漲跌幅需在 ±10% 之間";
    if (f.type === "volume_ratio" && f.value < 1.5) errors["rule.value"] = "倍數至少 1.5";
    if (Object.keys(errors).length) { draw(); return; }
    busy = true; draw();
    const body = { symbol: f.symbol, rule: ruleFromForm(f), frequency: f.frequency, cooldown_minutes: f.frequency === "every" ? f.cooldown : undefined, channels: f.channels, note: f.note.trim() || undefined, expires_at: f.expires ? new Date(f.expires).toISOString() : undefined };
    try {
      const res = a ? await api.patchAlert(a.alert_id, { ...body, note: f.note.trim() || undefined, expected_version: a.version }) : await api.createAlert(body, idem);
      clearDraft(); busy = false; o.onDone(res);
    } catch (err) {
      busy = false;
      if (err instanceof WatchError) {
        if (err.code === "VALIDATION_FAILED") { errors = err.fieldErrors(); if (!Object.keys(errors).length) errors._ = err.message; }
        else if (err.code === "VERSION_CONFLICT") errors._ = "這則警報已在別台裝置修改，請返回重新載入後再試";
        else if (err.code === "UNAUTHENTICATED") errors._ = "登入已過期，表單內容已保留。按上方「重新登入」後回來送出。";
        else errors._ = err.message;
      } else errors._ = (err as Error).message;
      draw();
    }
  });
  const offs = [sub("online", draw), sub("auth", draw)];
  draw();
  if (f.symbol) loadDet();
  return () => offs.forEach((x) => x());
}

const view: View = async ({ route, el, setTop }) => {
  const isEdit = route.name === "alert-edit";
  setTop(backBtn("取消", "/alerts") + centerTitle(isEdit ? "編輯警報" : "新增警報") + `<span style="width:72px"></span>`);
  el.innerHTML = `<div class="narrow"><div data-form><div class="sk" style="height:60px"></div><div class="sk" style="height:220px;margin-top:12px"></div></div></div>`;
  let alert: Alert | undefined;
  if (isEdit) {
    try { alert = (await api.alerts()).rows.find((x) => x.alert_id === route.params.id); } catch { /* */ }
    if (!alert) { el.innerHTML = `<div class="card"><div class="empty"><h2 class="h2">找不到這則警報</h2><a class="btn o" href="${href("/alerts")}">回警報</a></div></div>`; return; }
  }
  const symbol = route.query.get("symbol")?.toUpperCase() || undefined;
  const price = route.query.get("price") ? Number(route.query.get("price")) : undefined;
  return mountAlertForm(el.querySelector("[data-form]")!, {
    symbol, price, alert,
    onDone: (a) => { if (a) { toast(isEdit ? "已儲存" : "警報已建立"); if (symbol && !isEdit) { navigate(stockHref(symbol), { replace: true }); return; } } back("/alerts"); },
  });
};
export default view;
void chg;
