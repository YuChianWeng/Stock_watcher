/** FRONTEND-CONTRACT v1.0 §2 型別（凍結）。 */
export type ISODate = string;
export type ISODateTime = string;
export type Decimal = string;
export type Symbol = string;

export type InstrumentKind = "stock" | "etf" | "index";
export type Board = "tse" | "otc" | "index";

export type Instrument = {
  symbol: Symbol; name: string; kind: InstrumentKind; board: Board;
  industry: string | null; lot_size: 1000 | null; flags: string[];
};

export type QuoteStatus = "live" | "delayed" | "stale" | "closed" | "disconnected" | "no_data";
export type SessionKind = "pre_open" | "open" | "closing_auction" | "post" | "closed";
export type Direction = "up" | "down" | "flat";

export type Quote = {
  symbol: Symbol;
  last: number | null; prev_close: number | null;
  open: number | null; high: number | null; low: number | null;
  change: number | null; change_pct: number | null;
  direction: Direction | null;
  limit_up: number | null; limit_down: number | null;
  limit_state: "limit_up" | "limit_down" | null;
  volume_lots: number | null; turnover_twd: number | null;
  as_of: ISODateTime | null; fetched_at: ISODateTime; age_seconds: number | null;
  status: QuoteStatus; session: SessionKind; source: string;
};

export type MarketStatus = {
  now: ISODateTime; session: SessionKind; is_trading_day: boolean;
  holiday_name: string | null; next_open: ISODateTime | null; closes_at: ISODateTime | null;
};

export type Spark = { kind: "intraday" | "daily"; values: number[] };

export type Bar = { t: ISODate; o: number; h: number; l: number; c: number; v_lots: number | null; turnover_twd: number | null; partial?: boolean };

export type Coverage = {
  requested_from: ISODate | null; actual_from: ISODate | null; actual_to: ISODate | null;
  complete: boolean; truncated: boolean; reason: string | null;
};

export type IntradayPoint = { t: ISODateTime; p: number; v_lots_cum: number | null };

export type Holding = {
  symbol: Symbol; name: string; kind: InstrumentKind;
  qty_shares: number; avg_cost: Decimal; cost: Decimal;
  market_value: Decimal | null; unrealized_pnl: Decimal | null; unrealized_pnl_pct: number | null;
  unrealized_pnl_net_est: Decimal | null; day_pnl: Decimal | null; day_pnl_pct: number | null;
  weight_pct: number | null; first_buy_date: ISODate | null;
  quote: Quote; spark: Spark | null;
};

export type PortfolioSummary = {
  as_of: ISODateTime; market_value: Decimal; cost: Decimal;
  unrealized_pnl: Decimal; unrealized_pnl_pct: number | null; unrealized_pnl_net_est: Decimal | null;
  day_pnl: Decimal; day_pnl_pct: number | null; realized_pnl_ytd: Decimal | null;
  holdings_count: number; unpriced_count: number; stale_count: number;
};

export type Trade = {
  trade_id: string; symbol: Symbol; name: string; side: "buy" | "sell"; qty_shares: number;
  price: Decimal; fee: Decimal; tax: Decimal; net_amount: Decimal;
  trade_date: ISODate; settle_date: ISODate | null; source: "email" | "csv" | "manual" | "import";
};

export type WatchItem = { symbol: Symbol; name: string; kind: InstrumentKind; added_at: ISODateTime; quote: Quote; spark: Spark | null };
export type Watchlist = { watchlist_id: string; name: string; position: number; version: number; items: WatchItem[] };

export type AlertRule =
  | { type: "price"; op: "gte" | "lte"; value: number }
  | { type: "change_pct"; op: "gte" | "lte"; value: number }
  | { type: "pnl_pct"; op: "gte" | "lte"; value: number }
  | { type: "volume_ratio"; value: number }
  | { type: "ma_cross"; period: 5 | 10 | 20 | 60; direction: "above" | "below" }
  | { type: "limit"; direction: "up" | "down" };
export type RuleType = AlertRule["type"];

export type AlertFrequency = "once" | "daily" | "every";
export type AlertChannel = "push" | "telegram";
export type AlertStatus = "active" | "paused" | "triggered" | "expired" | "error";

export type Alert = {
  alert_id: string; version: number; symbol: Symbol; name: string; rule: AlertRule;
  frequency: AlertFrequency; cooldown_minutes: number; channels: AlertChannel[];
  note: string | null; status: AlertStatus; status_reason: string | null;
  expires_at: ISODateTime | null; created_at: ISODateTime; updated_at: ISODateTime;
  last_triggered_at: ISODateTime | null; trigger_count: number;
  live: { current: number | null; distance_pct: number | null; met: boolean } | null;
};

export type AlertEvent = {
  event_id: string; alert_id: string; symbol: Symbol; name: string; rule: AlertRule;
  fired_at: ISODateTime; late: boolean;
  observed: { last: number | null; change_pct: number | null; value: number | null; data_status: QuoteStatus; as_of: ISODateTime | null };
  message: { title: string; body: string };
  deliveries: { channel: AlertChannel; state: "sent" | "failed" | "skipped"; reason: string | null }[];
  read_at: ISODateTime | null;
};

export type PushDevice = {
  device_id: string; label: string; created_at: ISODateTime; last_ok_at: ISODateTime | null;
  state: "active" | "failing" | "revoked"; is_current: boolean;
};

export type Prefs = {
  version: number;
  color_convention: "tw_red_up" | "intl_green_up";
  theme: "system" | "dark" | "light";
  default_view: "intraday" | "1d" | "1w" | "1M";
  ma_periods: number[];
  volume_pane: boolean;
  sub_indicator: "none" | "kd" | "macd" | "rsi";
  adjust_default: "none" | "forward";
  pnl_basis: "gross" | "net_est";
  telegram_fallback: boolean;
  telegram_always: boolean;
};

export type Capabilities = {
  intraday: boolean; adjusted_bars: boolean; corporate_actions: boolean;
  max_watch_items: number; max_watchlists: number; max_alerts: number;
  poll_ms: { open: number; closed: number };
};

export type Bootstrap = {
  server_time: ISODateTime; app_version: string; market_status: MarketStatus;
  prefs: Prefs; capabilities: Capabilities;
  channels: { push: { vapid_public_key: string }; telegram: { connected: boolean } };
};

// ── 端點回應 ──
export type IndexEntry = { symbol: Symbol; name: string; quote: Quote; spark: Spark | null };
export type Overview = {
  as_of: ISODateTime; market_status: MarketStatus; indices: IndexEntry[];
  portfolio: PortfolioSummary | null; holdings: Holding[]; watchlists: Watchlist[]; unread_alert_events: number;
};
export type QuotesResp = { quotes: (Quote & { spark?: Spark | null })[]; errors: { symbol: Symbol; code: string }[]; poll_ms: number };
export type SearchRow = Instrument & { on_watchlist: boolean; held: boolean };
export type InstrumentDetail = {
  instrument: Instrument; quote: Quote; position: Holding | null; alerts: Alert[]; watchlist_ids: string[];
  stats: { avg_volume_5d_lots: number | null; high_52w: number | null; low_52w: number | null };
};
export type Interval = "1d" | "1w" | "1M";
export type BarsResp = { symbol: Symbol; interval: string; adjust: string; bars: Bar[]; coverage: Coverage; has_more_before: boolean; as_of: ISODateTime };
export type IntradayResp = {
  symbol: Symbol; date: ISODate; prev_close: number | null; limit_up: number | null; limit_down: number | null;
  session_start: ISODateTime; session_end: ISODateTime; points: IntradayPoint[];
  coverage: { from: ISODateTime | null; complete: boolean; reason: string | null; gaps: { from: ISODateTime; to: ISODateTime }[] };
  as_of: ISODateTime;
};
export type AlertPreview = { valid: boolean; errors: { field: string; reason: string }[]; current: number | null; distance_pct: number | null; already_met: boolean; hint: string | null };
export type StatusResp = { sources: { name: string; ok: boolean; last_ok_at: ISODateTime | null; note: string | null }[]; server_time: ISODateTime };
export type AlertInput = { symbol: Symbol; rule: AlertRule; frequency: AlertFrequency; cooldown_minutes?: number; channels: AlertChannel[]; note?: string; expires_at?: ISODateTime };

export type ErrorCode =
  | "UNAUTHENTICATED" | "VALIDATION_FAILED" | "NOT_FOUND" | "SYMBOL_UNKNOWN" | "VERSION_CONFLICT"
  | "ALERT_LIMIT_REACHED" | "WATCHLIST_LIMIT_REACHED" | "INSUFFICIENT_HISTORY" | "RATE_LIMITED"
  | "UPSTREAM_UNAVAILABLE" | "PUSH_SUBSCRIPTION_INVALID";
export type ApiError = { code: ErrorCode; message: string; details?: { field?: string; reason?: string; [k: string]: unknown }[] };
export type Envelope<T> = { version: 1; data: T } | { version: 1; error: ApiError };
