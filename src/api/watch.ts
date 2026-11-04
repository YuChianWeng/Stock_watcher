/** 契約 §3、§4 端點。 */
import { request } from "./client";
import type {
  Alert, AlertEvent, AlertInput, AlertPreview, AlertRule, BarsResp, Bootstrap, InstrumentDetail, Interval, IntradayResp,
  Overview, Holding, PortfolioSummary, Prefs, PushDevice, QuotesResp, SearchRow, StatusResp, Trade, Watchlist,
} from "../types";

const enc = encodeURIComponent;
export const api = {
  bootstrap: () => request<Bootstrap>("GET", "/bootstrap"),
  overview: () => request<Overview>("GET", "/overview"),
  quotes: (symbols: string[], spark = false) => request<QuotesResp>("GET", "/quotes", { query: { symbols: symbols.slice(0, 60).join(","), spark: spark ? 1 : 0 } }),
  search: (q: string, limit = 20) => request<{ rows: SearchRow[] }>("GET", "/instruments/search", { query: { q, limit } }),
  instrument: (s: string) => request<InstrumentDetail>("GET", `/instruments/${enc(s)}`),
  bars: (s: string, q: { interval: Interval; to?: string; limit?: number; adjust?: "none" | "forward"; allow_partial?: boolean }) =>
    request<BarsResp>("GET", `/bars/${enc(s)}`, { query: { ...q, allow_partial: q.allow_partial ? 1 : undefined } }),
  intraday: (s: string) => request<IntradayResp>("GET", `/intraday/${enc(s)}`),
  portfolio: () => request<{ summary: PortfolioSummary; holdings: Holding[] }>("GET", "/portfolio"),
  trades: (q: { symbol?: string; cursor?: string; limit?: number } = {}) => request<{ rows: Trade[]; next_cursor: string | null }>("GET", "/trades", { query: q }),
  watchlists: () => request<{ rows: Watchlist[] }>("GET", "/watchlists"),
  alerts: (q: { status?: string; symbol?: string } = {}) => request<{ rows: Alert[] }>("GET", "/alerts", { query: q }),
  events: (q: { cursor?: string; limit?: number; unread_only?: boolean } = {}) => request<{ rows: AlertEvent[]; next_cursor: string | null; unread: number }>("GET", "/alert-events", { query: q }),
  preview: (symbol: string, rule: AlertRule) => request<AlertPreview>("POST", "/alerts/preview", { body: { symbol, rule } }),
  devices: () => request<{ rows: PushDevice[] }>("GET", "/push/devices"),
  prefs: () => request<Prefs>("GET", "/prefs"),
  status: () => request<StatusResp>("GET", "/status"),

  createWatchlist: (name: string, key?: string) => request<Watchlist>("POST", "/watchlists", { body: { name }, idempotencyKey: key }),
  patchWatchlist: (id: string, body: { expected_version: number; name?: string; position?: number }) => request<Watchlist>("PATCH", `/watchlists/${enc(id)}`, { body }),
  deleteWatchlist: (id: string) => request<{ deleted: true }>("DELETE", `/watchlists/${enc(id)}`),
  addItem: (id: string, symbol: string) => request<Watchlist>("POST", `/watchlists/${enc(id)}/items`, { body: { symbol } }),
  removeItem: (id: string, symbol: string) => request<Watchlist>("DELETE", `/watchlists/${enc(id)}/items/${enc(symbol)}`),
  reorder: (id: string, expected_version: number, symbols: string[]) => request<Watchlist>("PUT", `/watchlists/${enc(id)}/order`, { body: { expected_version, symbols } }),
  createAlert: (body: AlertInput, key: string) => request<Alert>("POST", "/alerts", { body, idempotencyKey: key }),
  patchAlert: (id: string, body: Partial<AlertInput> & { expected_version: number }) => request<Alert>("PATCH", `/alerts/${enc(id)}`, { body }),
  pauseAlert: (id: string, v: number) => request<Alert>("POST", `/alerts/${enc(id)}/pause`, { body: { expected_version: v } }),
  resumeAlert: (id: string, v: number) => request<Alert>("POST", `/alerts/${enc(id)}/resume`, { body: { expected_version: v } }),
  deleteAlert: (id: string) => request<{ deleted: true }>("DELETE", `/alerts/${enc(id)}`),
  readEvents: (body: { ids: string[] } | { all: true }) => request<{ unread: number }>("POST", "/alert-events/read", { body }),
  putPrefs: (p: Prefs) => request<Prefs>("PUT", "/prefs", { body: p }),
  subscribe: (body: { endpoint: string; keys: { p256dh: string; auth: string }; device_label?: string }) => request<PushDevice>("POST", "/push/subscriptions", { body }),
  deleteDevice: (id: string) => request<{ deleted: true }>("DELETE", `/push/devices/${enc(id)}`),
  pushTest: () => request<{ sent: number; failed: number }>("POST", "/push/test", { body: {} }),
};
