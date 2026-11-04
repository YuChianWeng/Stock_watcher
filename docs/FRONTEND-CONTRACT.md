# 看盤 App — 前端契約 FRONTEND-CONTRACT v1.0（凍結）

> 狀態：**v1.0 凍結（2026-11-04）**。前端可以只依這份文件和 mock 資料開發，不需要後端。
> 後端由 Hermes 之後依這份契約實作；兩邊對不上時，**以這份文件為準**（後端要改，不是前端要改）。
> 搭配：`SPEC.md`（功能與定義）、`DESIGN-BRIEF.md`（給設計者）。後端細節在 `BACKEND-PLAN.md`，**前端不需要讀**。
> 時區一律 Asia/Taipei（+08:00）。介面語言繁體中文。

---

## 0. 固定前提

| # | 前提 |
|---|---|
| F-1 | 頁面在 `/stocks`，API 在同一個網域的 `/api/watch/*`。登入由 Cloudflare Access 處理（cookie），前端不做登入畫面。 |
| F-2 | iOS「加入主畫面」的 Web App，`scope=/stocks/`，`start_url=/stocks/?source=pwa`，`display=standalone`。這是**獨立的 App**，和記帳 App（`/finance`）分開。 |
| F-3 | **v1 只讀行情**：不下單、不顯示帳戶餘額。前端的寫入只有：自選清單、警報、偏好設定、推播訂閱。 |
| F-4 | **數字規則**：行情價格、漲跌、成交量是 JSON `number`（價格最多 4 位小數，不會是 `NaN`／`Infinity`）。**金額**（成本、市值、損益）是十進位**字串**，例如 `"123456.78"`，單位固定新臺幣，用十進位運算，不用 float。 |
| F-5 | **單位**：持有數量用「股」（整數）；成交量用「張」（1 張＝1000 股，欄位名 `*_lots`）。零股要顯示成「1 張 234 股」。 |
| F-6 | 商品用 `symbol` 識別：個股、ETF 是交易所代號（`2330`、`00878`、`006208`、`00937B`），指數固定為 `TAIEX`（加權指數）、`TPEX`（櫃買指數）。代號格式 `^[0-9A-Z]{3,8}$`。 |
| F-7 | 漲跌方向用伺服器給的 `direction`（`up`／`down`／`flat`），前端不要自己用浮點數判斷正負。顏色慣例（紅漲綠跌或相反）由 `prefs.color_convention` 決定；**不能只靠顏色**表達漲跌，一定要有 ▲▼ 或 ＋－。 |
| F-8 | 前端**不得硬編**開收盤時間或休市日；一律用伺服器給的 `market_status`。 |
| F-9 | 伺服器只回 VAPID **公開**金鑰，沒有任何密鑰、token 或帳號資訊。 |

## 1. 回應格式與錯誤

成功：

```json
{ "version": 1, "data": { } }
```

失敗：HTTP 狀態碼加：

```json
{ "version": 1, "error": { "code": "VALIDATION_FAILED", "message": "給人看的繁體中文說明", "details": [ { "field": "rule.value", "reason": "超出漲停價" } ] } }
```

| code | HTTP | 前端處理 |
|---|---|---|
| `UNAUTHENTICATED` | 401（或被導向 Access 登入頁） | 顯示「登入已過期」，保留尚未送出的表單內容，提供重新登入連結 `/cdn-cgi/access/login?redirect_url=<目前網址>`（§6.3） |
| `VALIDATION_FAILED` | 422 | 依 `details[].field` 顯示在對應欄位 |
| `NOT_FOUND` | 404 | 顯示找不到 |
| `SYMBOL_UNKNOWN` | 404 | 「找不到這個代號」 |
| `VERSION_CONFLICT` | 409 | 別台裝置已修改，重新載入後再試 |
| `ALERT_LIMIT_REACHED` | 409 | 「警報數量已達上限」 |
| `WATCHLIST_LIMIT_REACHED` | 409 | 同上（自選項目或清單數量） |
| `INSUFFICIENT_HISTORY` | 422 | K 線資料範圍不足，`details` 有可得的最早日期（§3.7） |
| `RATE_LIMITED` | 429 | 讀 `Retry-After` 秒數後再試，期間顯示上次資料 |
| `UPSTREAM_UNAVAILABLE` | 503 | 行情來源暫時無法使用：顯示上次資料與「資料過期」，自動退避重試 |
| `PUSH_SUBSCRIPTION_INVALID` | 422 | 訂閱格式不正確，重新訂閱 |

寫入類請求（`POST`）帶 `Idempotency-Key`（UUID，每次使用者動作產生一個）；同一個 key 重送，伺服器回第一次的結果。更新類請求（`PATCH`、`PUT`）帶 `expected_version`。

## 2. 型別

```ts
type ISODate = string;        // "2026-11-04"
type ISODateTime = string;    // "2026-11-04T10:41:05+08:00"
type Decimal = string;        // "12345.67"
type Symbol = string;

type InstrumentKind = "stock" | "etf" | "index";
type Board = "tse" | "otc" | "index";           // 上市／上櫃／指數

type Instrument = {
  symbol: Symbol;
  name: string;                                  // 「示範半導體」
  kind: InstrumentKind;
  board: Board;
  industry: string | null;
  lot_size: 1000 | null;                         // 指數為 null
  flags: string[];                               // 例："halted"、"attention"、"disposition"；前端忽略不認得的值
};

type QuoteStatus =
  | "live"          // 盤中，資料夠新（≤ 15 秒）
  | "delayed"       // 盤中，稍舊（15–60 秒）
  | "stale"         // 盤中，過期（> 60 秒）：不要把它當成最新價
  | "closed"        // 休市或已收盤的最後一筆，日期正確
  | "disconnected"  // 行情來源中斷
  | "no_data";      // 沒有資料（新上市、暫停交易、代號沒有行情）

type SessionKind = "pre_open" | "open" | "closing_auction" | "post" | "closed";

type Quote = {
  symbol: Symbol;
  last: number | null;
  prev_close: number | null;
  open: number | null; high: number | null; low: number | null;
  change: number | null;                         // last − prev_close
  change_pct: number | null;                     // 百分比，例 1.25 代表 +1.25%
  direction: "up" | "down" | "flat" | null;
  limit_up: number | null; limit_down: number | null;
  limit_state: "limit_up" | "limit_down" | null; // 成交價在漲停價或跌停價
  volume_lots: number | null;                    // 當日累計，張；指數為 null
  turnover_twd: number | null;                   // 當日累計成交金額，元
  as_of: ISODateTime | null;                     // 來源的資料時間
  fetched_at: ISODateTime;                       // 伺服器取得時間
  age_seconds: number | null;
  status: QuoteStatus;
  session: SessionKind;
  source: string;                                // 「kgi」「twse」…，只用於顯示資料來源
};

type MarketStatus = {
  now: ISODateTime;
  session: SessionKind;
  is_trading_day: boolean;
  holiday_name: string | null;                   // 「春節」
  next_open: ISODateTime | null;
  closes_at: ISODateTime | null;
};

type Spark = { kind: "intraday" | "daily"; values: number[] };   // ≤ 40 點

type Bar = {
  t: ISODate;                                    // 該週期的起始日（週為週一，月為 1 日），不是第一個交易日
  o: number; h: number; l: number; c: number;
  v_lots: number | null;                         // 指數為 null
  turnover_twd: number | null;
  partial?: boolean;                             // 目前尚未走完的週期
};

type Coverage = {
  requested_from: ISODate | null;
  actual_from: ISODate | null;
  actual_to: ISODate | null;
  complete: boolean;
  truncated: boolean;
  reason: string | null;
};

type IntradayPoint = { t: ISODateTime; p: number; v_lots_cum: number | null };  // 每分鐘一點，分鐘結束時的成交價

type Holding = {
  symbol: Symbol; name: string; kind: InstrumentKind;
  qty_shares: number;
  avg_cost: Decimal;                             // 每股平均成本（含買進手續費）
  cost: Decimal;
  market_value: Decimal | null;
  unrealized_pnl: Decimal | null;                // 市值 − 成本
  unrealized_pnl_pct: number | null;
  unrealized_pnl_net_est: Decimal | null;        // 再扣預估賣出手續費與證交稅
  day_pnl: Decimal | null;
  day_pnl_pct: number | null;
  weight_pct: number | null;
  first_buy_date: ISODate | null;
  quote: Quote;
  spark: Spark | null;
};

type PortfolioSummary = {
  as_of: ISODateTime;
  market_value: Decimal; cost: Decimal;
  unrealized_pnl: Decimal; unrealized_pnl_pct: number | null;
  unrealized_pnl_net_est: Decimal | null;
  day_pnl: Decimal; day_pnl_pct: number | null;
  realized_pnl_ytd: Decimal | null;
  holdings_count: number; unpriced_count: number; stale_count: number;   // 沒有報價、報價過期的檔數
};

type Trade = {
  trade_id: string;
  symbol: Symbol; name: string;
  side: "buy" | "sell";
  qty_shares: number;
  price: Decimal; fee: Decimal; tax: Decimal; net_amount: Decimal;
  trade_date: ISODate; settle_date: ISODate | null;
  source: "email" | "csv" | "manual" | "import";
};

type WatchItem = { symbol: Symbol; name: string; kind: InstrumentKind; added_at: ISODateTime; quote: Quote; spark: Spark | null };
type Watchlist = { watchlist_id: string; name: string; position: number; version: number; items: WatchItem[] };

type AlertRule =
  | { type: "price";        op: "gte" | "lte"; value: number }             // 成交價
  | { type: "change_pct";   op: "gte" | "lte"; value: number }             // 今日漲跌幅（相對昨收），可為負
  | { type: "pnl_pct";      op: "gte" | "lte"; value: number }             // 持倉未實現損益％，僅持有時可建
  | { type: "volume_ratio"; value: number }                                // 今日量 ≥ value × 近 5 日平均量
  | { type: "ma_cross";     period: 5 | 10 | 20 | 60; direction: "above" | "below" }
  | { type: "limit";        direction: "up" | "down" };                    // 成交價到達漲停／跌停

type AlertFrequency = "once" | "daily" | "every";
type AlertChannel = "push" | "telegram";
type AlertStatus = "active" | "paused" | "triggered" | "expired" | "error";

type Alert = {
  alert_id: string; version: number;
  symbol: Symbol; name: string;
  rule: AlertRule;
  frequency: AlertFrequency;
  cooldown_minutes: number;                      // 僅 every 有意義，最小 5，預設 30
  channels: AlertChannel[];                      // 至少一個
  note: string | null;                           // ≤ 60 字
  status: AlertStatus;
  status_reason: string | null;                  // error 時說明，例「持倉已清空」
  expires_at: ISODateTime | null;
  created_at: ISODateTime; updated_at: ISODateTime;
  last_triggered_at: ISODateTime | null;
  trigger_count: number;
  live: { current: number | null; distance_pct: number | null; met: boolean } | null;  // 目前值與距離門檻的百分比
};

type AlertEvent = {
  event_id: string; alert_id: string;
  symbol: Symbol; name: string;
  rule: AlertRule;
  fired_at: ISODateTime;
  late: boolean;                                 // 因資料中斷而延後補發
  observed: { last: number | null; change_pct: number | null; value: number | null; data_status: QuoteStatus; as_of: ISODateTime | null };
  message: { title: string; body: string };
  deliveries: { channel: AlertChannel; state: "sent" | "failed" | "skipped"; reason: string | null }[];
  read_at: ISODateTime | null;
};

type PushDevice = {
  device_id: string; label: string;
  created_at: ISODateTime; last_ok_at: ISODateTime | null;
  state: "active" | "failing" | "revoked";
  is_current: boolean;
};

type Prefs = {
  version: number;
  color_convention: "tw_red_up" | "intl_green_up";             // 預設 tw_red_up
  theme: "system" | "dark" | "light";
  default_view: "intraday" | "1d" | "1w" | "1M";               // 個股頁預設圖表
  ma_periods: number[];                                        // 預設 [5, 20, 60]
  volume_pane: boolean;
  sub_indicator: "none" | "kd" | "macd" | "rsi";
  adjust_default: "none" | "forward";                          // K 線是否還原權息
  pnl_basis: "gross" | "net_est";                              // 損益預設顯示哪一種
  telegram_fallback: boolean;                                  // 推播失敗或沒有可用裝置時改送 Telegram，預設開
  telegram_always: boolean;                                    // 所有警報同時送 Telegram，預設關
};

type Capabilities = {
  intraday: boolean;
  adjusted_bars: boolean;                                      // false 時隱藏「還原權息」開關
  corporate_actions: boolean;                                  // false 時不顯示除權息標記
  max_watch_items: number; max_watchlists: number; max_alerts: number;
  poll_ms: { open: number; closed: number };                   // 建議輪詢間隔，預設 5000／60000
};

type Bootstrap = {
  server_time: ISODateTime;
  app_version: string;
  market_status: MarketStatus;
  prefs: Prefs;
  capabilities: Capabilities;
  channels: { push: { vapid_public_key: string }; telegram: { connected: boolean } };
};
```

## 3. 讀取端點

所有路徑前綴 `/api/watch`。

### 3.1 啟動

| 端點 | 回傳 |
|---|---|
| `GET /bootstrap` | `Bootstrap`。App 啟動第一個請求；也是判斷連線與登入是否正常的探針。 |

### 3.2 總覽

| 端點 | 回傳 |
|---|---|
| `GET /overview` | `{ as_of: ISODateTime; market_status: MarketStatus; indices: { symbol: Symbol; name: string; quote: Quote; spark: Spark \| null }[]; portfolio: PortfolioSummary \| null; holdings: Holding[]; watchlists: Watchlist[]; unread_alert_events: number }`。沒有持倉時 `portfolio` 為 `null`、`holdings` 為空。 |

### 3.3 報價

| 端點 | 參數 | 回傳 |
|---|---|---|
| `GET /quotes` | `symbols`（逗號分隔，最多 60 個）、`spark`（`0`／`1`，預設 0） | `{ quotes: (Quote & { spark?: Spark \| null })[]; errors: { symbol: Symbol; code: string }[]; poll_ms: number }`。部分失敗時，成功的照常回傳，失敗的列在 `errors`。 |

### 3.4 搜尋與商品

| 端點 | 參數 | 回傳 |
|---|---|---|
| `GET /instruments/search` | `q`（代號或名稱片段）、`limit`（≤ 20） | `{ rows: (Instrument & { on_watchlist: boolean; held: boolean })[] }` |
| `GET /instruments/:symbol` | — | `{ instrument: Instrument; quote: Quote; position: Holding \| null; alerts: Alert[]; watchlist_ids: string[]; stats: { avg_volume_5d_lots: number \| null; high_52w: number \| null; low_52w: number \| null } }` |

### 3.5 K 線

| 端點 | 參數 | 回傳 |
|---|---|---|
| `GET /bars/:symbol` | `interval`（`1d`／`1w`／`1M`）、`to`（`ISODate`，預設今天）、`limit`（≤ 1000，預設 300）、`adjust`（`none`／`forward`，預設 `none`）、`allow_partial`（`0`／`1`，預設 `0`） | `{ symbol: Symbol; interval: string; adjust: string; bars: Bar[]; coverage: Coverage; has_more_before: boolean; as_of: ISODateTime }`。`bars` 由舊到新；往前載入更早資料時，把 `to` 設成目前最早一根的前一天。 |

- 範圍不足時：預設**失敗而不是靜默截短**，回 `INSUFFICIENT_HISTORY`，`details` 含可得的最早日期。前端收到後用 `allow_partial=1` 重送，並顯示「資料自 YYYY/MM/DD 起」。
- 目前尚未走完的週期（今天的日 K、本週、本月）`partial: true`，盤中會隨報價更新。
- 指數的 `v_lots` 為 `null`，量能副圖改用 `turnover_twd`。

### 3.6 分時線

| 端點 | 參數 | 回傳 |
|---|---|---|
| `GET /intraday/:symbol` | `date`（預設今天，只支援最近一個交易日） | `{ symbol: Symbol; date: ISODate; prev_close: number \| null; limit_up: number \| null; limit_down: number \| null; session_start: ISODateTime; session_end: ISODateTime; points: IntradayPoint[]; coverage: { from: ISODateTime \| null; complete: boolean; reason: string \| null; gaps: { from: ISODateTime; to: ISODateTime }[] }; as_of: ISODateTime }` |

- 分時線是伺服器每分鐘累積的資料，**可能不完整**：新加入自選的商品、或伺服器重啟，都會讓 `coverage.complete=false`。前端必須顯示「分時線自 HH:mm 起」，並在圖上讓缺口斷線，不可以補線。
- 盤前（還沒有任何點）回空 `points`，前端顯示「尚未開盤」。

### 3.7 持倉與成交

| 端點 | 參數 | 回傳 |
|---|---|---|
| `GET /portfolio` | — | `{ summary: PortfolioSummary; holdings: Holding[] }` |
| `GET /trades` | `symbol?`、`from?`、`to?`、`cursor?`、`limit`（≤ 100） | `{ rows: Trade[]; next_cursor: string \| null }` |

持倉**唯讀**：v1 的前端沒有新增、修改成交的功能（資料由後端匯入）。

### 3.8 自選清單

| 端點 | 回傳 |
|---|---|
| `GET /watchlists` | `{ rows: Watchlist[] }`（含報價） |

### 3.9 警報

| 端點 | 參數 | 回傳 |
|---|---|---|
| `GET /alerts` | `status?`、`symbol?` | `{ rows: Alert[] }` |
| `GET /alert-events` | `cursor?`、`limit`（≤ 50）、`unread_only?` | `{ rows: AlertEvent[]; next_cursor: string \| null; unread: number }` |
| `POST /alerts/preview` | body：`{ symbol: Symbol; rule: AlertRule }` | `{ valid: boolean; errors: { field: string; reason: string }[]; current: number \| null; distance_pct: number \| null; already_met: boolean; hint: string \| null }`。建立前呼叫，用來顯示「距離現價 +2.3%」和「目前已經滿足條件」。 |

### 3.10 通知與偏好

| 端點 | 回傳 |
|---|---|
| `GET /push/devices` | `{ rows: PushDevice[] }` |
| `GET /prefs` | `Prefs` |
| `GET /status` | `{ sources: { name: string; ok: boolean; last_ok_at: ISODateTime \| null; note: string \| null }[]; server_time: ISODateTime }`，給設定頁的「資料來源狀態」 |

## 4. 寫入端點

所有寫入成功都回傳**更新後的物件**，前端直接取代本地資料，不需要再重新載入整頁。

| 端點 | body | 回傳 |
|---|---|---|
| `POST /watchlists` | `{ name: string }`（≤ 20 字） | `Watchlist` |
| `PATCH /watchlists/:id` | `{ expected_version: number; name?: string; position?: number }` | `Watchlist` |
| `DELETE /watchlists/:id` | — | `{ deleted: true }`（預設清單不可刪） |
| `POST /watchlists/:id/items` | `{ symbol: Symbol }` | `Watchlist`（已存在則不重複，回 200） |
| `DELETE /watchlists/:id/items/:symbol` | — | `Watchlist` |
| `PUT /watchlists/:id/order` | `{ expected_version: number; symbols: Symbol[] }` | `Watchlist` |
| `POST /alerts` | `{ symbol: Symbol; rule: AlertRule; frequency: AlertFrequency; cooldown_minutes?: number; channels: AlertChannel[]; note?: string; expires_at?: ISODateTime }` | `Alert` |
| `PATCH /alerts/:id` | `{ expected_version: number; rule?; frequency?; cooldown_minutes?; channels?; note?; expires_at? }` | `Alert` |
| `POST /alerts/:id/pause`、`/resume` | `{ expected_version: number }` | `Alert` |
| `DELETE /alerts/:id` | — | `{ deleted: true }` |
| `POST /alert-events/read` | `{ ids: string[] }` 或 `{ all: true }` | `{ unread: number }` |
| `PUT /prefs` | `Prefs`（含 `version`） | `Prefs` |
| `POST /push/subscriptions` | `{ endpoint: string; keys: { p256dh: string; auth: string }; device_label?: string }` | `PushDevice` |
| `DELETE /push/devices/:id` | — | `{ deleted: true }` |
| `POST /push/test` | `{}` | `{ sent: number; failed: number }`（對目前所有可用裝置送一則測試通知） |

驗證規則（伺服器強制，前端先擋）：

- 價格門檻必須在漲停價與跌停價之間；`change_pct` 門檻不得超出 ±10。
- `pnl_pct` 只有持有該商品時才能建立；持倉變為 0 時，該警報自動進入 `status="error"`、`status_reason="持倉已清空"`。
- `volume_ratio` 的 `value` ≥ 1.5；`every` 的 `cooldown_minutes` ≥ 5。
- `channels` 至少一個；沒有任何可用推播裝置時，只選 `push` 的警報仍可建立，但畫面要提醒「目前沒有可接收推播的裝置」。
- 上限（由 `capabilities` 提供，預設）：自選項目 200、清單 10、警報 100，每個商品最多 10 則。

## 5. 即時更新規則

| 情況 | 輪詢間隔 |
|---|---|
| 頁面可見、`market_status.session` 為 `open`／`closing_auction`／`pre_open` | `capabilities.poll_ms.open`（預設 5 秒） |
| 頁面可見、其他時段 | `capabilities.poll_ms.closed`（預設 60 秒） |
| 頁面不可見（切到背景、鎖屏） | **停止輪詢**；回到前景時立刻更新一次 |
| 收到 `429` | 依 `Retry-After`；其他錯誤用退避（5s、10s、20s … 上限 60s），退避期間顯示上次資料 |

- 只輪詢**畫面上看得到**的商品（`GET /quotes?symbols=…`）。iPad 多欄時取聯集。
- 圖表最後一根（日、週、月 K）和分時線的最後一點，用報價更新，不重新抓整段歷史。
- 每個價格旁要能看到資料狀態：`live` 不特別標示；`delayed`、`stale`、`disconnected` 要標示並顯示 `as_of` 時間；`stale` 的價格要降低視覺強調，不可以看起來像最新價。

## 6. 離線、登入、推播

### 6.1 離線（iOS Web App 沒有網路時）

- 顯示最近一次成功取得的總覽、報價、K 線，並標示「離線 · 資料更新於 HH:mm」。快取放在 IndexedDB／Cache Storage。
- **所有寫入功能在離線時停用**（新增或修改警報、自選、偏好）。不做離線佇列，避免使用者以為警報已經建立。
- 連線恢復後自動更新。

### 6.2 Service worker

- 位置 `/stocks/sw.js`，scope `/stocks/`。快取 App shell；`/api/watch/*` 不由 service worker 長期快取（資料新鮮度由前端管理）。
- 更新策略與記帳 App 相同：新版本在背景下載，提示「有新版本，重新開啟套用」。

### 6.3 登入過期（Cloudflare Access）

- 任何 API 回 `401`，或 `fetch` 被導向到 `*/cdn-cgi/access/login*`（`opaqueredirect`），一律視為登入過期。
- 顯示「登入已過期」面板，保留尚未送出的表單（例如警報建立表單）；點「重新登入」開啟 `/cdn-cgi/access/login?redirect_url=<目前網址>`。
- 主畫面 App 的 Access cookie 和 Safari 是分開的，第一次要在 App 內登入一次。

### 6.4 Web Push（警報通知）

**前提與限制（iOS）：**

- 需要 iOS／iPadOS 16.4 以上，而且必須是**從主畫面開啟的 Web App**；在 Safari 分頁裡無法訂閱。
- 要求權限**只能由使用者點擊觸發**（例如按「開啟通知」按鈕），不可以在載入時自動跳出。
- **每一則推播都必須顯示通知**，不可以靜默；否則 Safari 會撤銷這個網站的推播權限。Service worker 的 `push` 事件**無論如何都要呼叫 `showNotification`**，就算內容解析失敗，也要顯示通用內容「看盤警報」。
- 被使用者在「設定 → 通知」關閉後，網頁無法重新要求權限，只能引導使用者去系統設定。

**流程：**

1. 功能偵測：`serviceWorker`、`PushManager`、`Notification` 都存在，且 `display-mode: standalone`（或 `navigator.standalone`）。
2. 使用者點「開啟通知」→ `Notification.requestPermission()` → `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: <bootstrap.channels.push.vapid_public_key> })` → `POST /push/subscriptions`。
3. 訂閱失效（伺服器標成 `revoked`、或 `pushsubscriptionchange` 事件）時，下次開啟 App 要提示重新訂閱。
4. 通知點擊（`notificationclick`）：開啟或聚焦 App，導向 `payload.url`；如果 App 已經開著，用 `postMessage` 導向，不重新載入。

**推播內容（伺服器 → service worker，JSON ≤ 4 KB）：**

```json
{ "v": 1, "title": "示範半導體 TS01｜價格 ≥ 100.00", "body": "現價 100.50（+2.55%）· 10:41 · 即時", "tag": "alert-<alert_id>", "url": "/stocks/s/TS01?event=<event_id>", "event_id": "<event_id>", "symbol": "TS01" }
```

- `tag` 相同的通知會取代前一則，避免同一個警報洗版。
- App 圖示上的未讀數：呼叫 `navigator.setAppBadge(unread)`（有支援才呼叫，失敗忽略）。

**權限狀態（設定頁與警報建立頁都要處理）：**

| 狀態 | 條件 | 畫面 |
|---|---|---|
| `unsupported` | iOS < 16.4 或瀏覽器不支援 | 說明需求，警報仍可建立（走 Telegram） |
| `not_installed` | 在 Safari 分頁裡開啟 | 圖解「加入主畫面」步驟 |
| `default` | 還沒問過 | 「開啟通知」按鈕 |
| `granted` + 已訂閱 | 正常 | 顯示已啟用的裝置、「傳送測試通知」 |
| `granted` + 訂閱失效 | 伺服器標 `revoked`／`failing` | 「重新啟用通知」 |
| `denied` | 使用者拒絕 | 引導到「設定 → 通知」開啟 |

## 7. Mock 資料清單

前端用 mock 開發，並在 CI 中跑。**公開 repo，不可以出現任何真實持倉、成本、損益或真實股價歷史。**

- 商品用**明顯虛構**的代號與名稱：`TS01`～`TS09`（個股）、`TE01`、`TE02`（ETF），名稱像「示範半導體」「範例金融控股」。指數保留 `TAIEX`、`TPEX` 兩個 key，名稱加註「（示範）」。
- 歷史 K 線由**固定種子的隨機漫步**程式產生（`mocks/gen-bars.ts`），不得複製任何真實價格序列。價格要貼近交易所的跳動單位規則（例如 100–500 元的商品，最小跳動 0.5）。
- 持倉用小而不真實的數字（例如 `qty_shares: 3000`、成本 `"31250.00"`）。
- commit 與 PR 的文字，不得暗示 mock 數字是真實資料。

**必須涵蓋的情境：**

| 類別 | 情境 |
|---|---|
| 報價狀態 | `live`、`delayed`、`stale`、`closed`、`disconnected`、`no_data` 各一檔；漲停、跌停、平盤、暫停交易（`flags` 含 `halted`） |
| 市場狀態 | 盤前、盤中、收盤撮合、盤後、休市（含 `holiday_name`） |
| 分時線 | 完整一天；`coverage.complete=false` 且自 10:42 起；盤前空資料；中間有缺口 |
| K 線 | 日 K 600 根；週 K、月 K；最後一根 `partial`；`INSUFFICIENT_HISTORY` 錯誤與 `allow_partial` 重送；`adjusted_bars=false`；指數（沒有張數，用成交金額） |
| 持倉 | 獲利、虧損、零股（1 張 234 股）、ETF、無報價、報價過期；摘要的 `unpriced_count`、`stale_count` 大於 0；沒有持倉 |
| 自選 | 兩份清單，其中一份是空的；達到項目上限 |
| 警報 | 6 種規則各一則；`active`／`paused`／`triggered`／`expired`／`error`；`once`／`daily`／`every`；`already_met=true` 的預覽；有失敗投遞的事件；`late=true` 的事件 |
| 推播 | 權限的 6 種狀態；多台裝置；`revoked` 裝置 |
| 錯誤 | 401、422（含欄位）、409（`VERSION_CONFLICT`）、429（含 `Retry-After`）、503 |
| 其他 | 離線、登入過期後保留表單、極端數字（價格 4 位數、成交量百萬張、損益超過億元）的版面 |

## 8. 頁面路由

| 路由 | 頁面 |
|---|---|
| `/stocks` | 總覽（大盤、持倉摘要、持倉、自選） |
| `/stocks/watch` | 自選清單（多份清單的管理與排序） |
| `/stocks/holdings` | 持倉清單與成交紀錄 |
| `/stocks/s/:symbol` | 個股頁（圖表、報價、我的部位、警報） |
| `/stocks/market` | 大盤（`TAIEX`） |
| `/stocks/market/:symbol` | 指數頁（`TAIEX`、`TPEX`） |
| `/stocks/alerts` | 警報清單 |
| `/stocks/alerts/new?symbol=` | 新增警報（可預填商品與價位） |
| `/stocks/alerts/:id` | 編輯警報 |
| `/stocks/inbox` | 通知紀錄 |
| `/stocks/settings` | 設定 |
| `/stocks/settings/notifications` | 通知設定與裝置 |

深層連結必須可以直接開啟（重新整理、從推播開啟）。`?source=pwa` 由 App 記錄後移除，不要留在網址上。

## 9. 版本規則

- 新增欄位、端點、枚舉值：次要版本（v1.x），舊前端必須忽略不認得的欄位與枚舉值。
- 修改或刪除既有欄位、改變語意：主版本（v2），後端與前端同時支援一段時間。
- 前端若提出契約變更，寫進 `docs/CONTRACT-CHANGES.md`，由 Oneal 決定。

## 10. 不影響前端的後端問題

資料來源、資料庫、輪詢頻率、成交信件解析、Telegram 機器人、託管方式與 Cloudflare 設定，都在 `BACKEND-PLAN.md`，**不會改變上面的契約**。
