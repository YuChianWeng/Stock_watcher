/** 開發用 Mock 面板（只在 mock 模式載入）：模擬契約 §7 的情境。 */
import { mock, PUSH_STATES, SCENARIOS, SESSIONS, type PushMock, type Scenario } from "../../mocks/browser";
import type { MockSession } from "../../mocks/handlers";

export function devPanel(el: HTMLElement) {
  const f = mock.flags;
  const sel = (name: string, opts: [string, string][], cur: string) => `<select class="input" data-dev="${name}">${opts.map(([v, t]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${t}</option>`).join("")}</select>`;
  el.innerHTML = `<h2 class="sec-t eyebrow">開發用 Mock</h2><section class="card stack" style="gap:10px">
    <div class="field"><span class="lb">網路情境</span>${sel("scenario", SCENARIOS, mock.scenario)}</div>
    <div class="field"><span class="lb">市場時段</span>${sel("session", SESSIONS, f.session)}</div>
    <div class="field"><span class="lb">推播權限</span>${sel("push", PUSH_STATES.map((p) => [p, p]), mock.push)}</div>
    ${[["empty", "沒有持倉、自選、警報"], ["extreme", "極端數字（4 位數價格、億元損益）"], ["noDevices", "沒有推播裝置"], ["tpexDown", "櫃買指數來源中斷"]].map(([k, t]) => `<label class="set-row"><span class="grow">${t}</span><span class="tg"><input type="checkbox" data-flag="${k}" ${(f as any)[k] ? "checked" : ""}><span></span></span></label>`).join("")}
    <p class="xs mu" style="margin:0">所有商品與數字都是虛構的。改變後會重新載入。</p></section>`;
  el.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement & HTMLSelectElement;
    if (t.dataset.dev === "scenario") mock.setScenario(t.value as Scenario);
    if (t.dataset.dev === "session") mock.setFlags({ session: t.value as MockSession });
    if (t.dataset.dev === "push") mock.setPush(t.value as PushMock);
    if (t.dataset.flag) mock.setFlags({ [t.dataset.flag]: t.checked });
    if (t.dataset.dev !== "scenario" || t.value === "none") setTimeout(() => location.reload(), 50);
  });
}
