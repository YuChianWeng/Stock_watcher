/** 全域搜尋：代號或名稱片段 → 結果顯示「已在清單」「已持有」，可直接加入自選。 */
import { api } from "../api/watch";
import { WatchError } from "../api/client";
import { navigate, stockHref } from "../router";
import { writable } from "../state";
import type { SearchRow } from "../types";
import { esc } from "./dom";
import { ic } from "./icons";
import { openSheet, toast } from "./overlay";

const KIND = { stock: "個股", etf: "ETF", index: "指數" } as const;
const BOARD = { tse: "上市", otc: "上櫃", index: "指數" } as const;

export function searchRows(rows: SearchRow[], opt: { addLabel?: string; inList?: Set<string> } = {}) {
  if (!rows.length) return "";
  return rows.map((r) => {
    const inList = opt.inList ? opt.inList.has(r.symbol) : r.on_watchlist;
    return `<div class="qrow" style="grid-template-columns:minmax(0,1fr) auto" data-go="${esc(r.symbol)}" role="button" tabindex="0">
      <div style="min-width:0"><div class="nm trunc">${esc(r.name)}</div><div class="sub"><span class="code">${esc(r.symbol)}</span><span>${BOARD[r.board]}${r.kind === "etf" ? " · ETF" : r.kind === "index" ? "" : ""}</span>${r.held ? '<span class="tag acc">已持有</span>' : ""}${r.flags.includes("halted") ? '<span class="tag halt">暫停交易</span>' : ""}</div></div>
      <div class="row">${r.kind === "index" ? `<span class="tag ghost">${KIND.index}</span>` : inList ? `<span class="tag ghost">${ic("check", "xs")}已在清單</span>` : `<button class="btn sm o" type="button" data-add="${esc(r.symbol)}" ${writable() ? "" : "disabled"}>${ic("plus", "s")}${opt.addLabel ?? "加入自選"}</button>`}</div></div>`;
  }).join("");
}

export function openSearch() {
  const s = openSheet("搜尋", `<div class="field"><div style="position:relative"><input class="input" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="characters" placeholder="代號或名稱，例如 TS01、示範" style="padding-left:40px" aria-label="搜尋代號或名稱"><span class="mu" style="position:absolute;left:12px;top:12px">${ic("search")}</span></div></div><div class="qlist" data-res style="margin-top:8px;min-height:120px"></div>`);
  const input = s.body.querySelector("input")!, res = s.body.querySelector("[data-res]") as HTMLElement;
  let t = 0, q = "";
  const run = async () => {
    q = input.value.trim();
    if (!q) { res.innerHTML = `<p class="sm mu" style="text-align:center;padding:24px 0">輸入代號或名稱片段</p>`; return; }
    const my = q;
    try {
      const r = await api.search(q, 20);
      if (my !== q) return;
      res.innerHTML = r.rows.length ? searchRows(r.rows) : `<p class="sm mu" style="text-align:center;padding:24px 0">找不到「${esc(q)}」</p>`;
    } catch (e) { res.innerHTML = `<p class="sm" style="color:var(--cut);text-align:center;padding:24px 0">${esc((e as Error).message)}</p>`; }
  };
  input.addEventListener("input", () => { clearTimeout(t); t = window.setTimeout(run, 180); });
  run();
  res.addEventListener("click", async (e) => {
    const add = (e.target as Element).closest("[data-add]") as HTMLButtonElement | null;
    if (add) {
      e.stopPropagation(); add.disabled = true;
      try {
        const wl = (await api.watchlists()).rows.sort((a, b) => a.position - b.position)[0];
        await api.addItem(wl.watchlist_id, add.dataset.add!);
        toast(`已加入「${esc(wl.name)}」`);
        run();
      } catch (err) { add.disabled = false; toast(err instanceof WatchError ? err.message : "加入失敗", { kind: "err" }); }
      return;
    }
    const go = (e.target as Element).closest("[data-go]") as HTMLElement | null;
    if (go) { s.close(); navigate(stockHref(go.dataset.go!)); }
  });
}
