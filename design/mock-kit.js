/* 設計稿共用：圖示、虛構資料、元件產生器。只用於 design/，前端有自己的實作。所有數字都是虛構的。 */
(function () {
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20.5a2 2 0 0 0 4 0"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    chevl: '<path d="M15 5l-7 7 7 7"/>', chevr: '<path d="M9 5l7 7-7 7"/>', chevd: '<path d="M5 9l7 7 7-7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="M4 12.5 9 17.5 20 6.5"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    cut: '<path d="M9 15l6-6M10.5 6.5l1.8-1.8a4 4 0 0 1 5.7 5.7l-1.8 1.8M13.5 17.5l-1.8 1.8a4 4 0 0 1-5.7-5.7l1.8-1.8M3 3l18 18"/>',
    wifioff: '<path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.7M19 13a10 10 0 0 0-2.4-1.7M2 9.5a15 15 0 0 1 4.3-2.6M22 9.5A15 15 0 0 0 11 6M12 20h.01"/>',
    warn: '<path d="M12 3 2 20h20zM12 10v4M12 17h.01"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    pause: '<path d="M8 5v14M16 5v14"/>', play: '<path d="M7 4l13 8-13 8z"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>', sort: '<path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', layers: '<path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5"/>',
    brief: '<path d="M3 8h18v12H3zM8 8V5h8v3M3 13h18"/>', refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4"/>',
    share: '<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 11v9h14v-9"/>', addsq: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/>',
    phone: '<rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M11 18.5h2"/>', send: '<path d="M21 3 3 10.5l7 3 3 7.5z"/><path d="m10 13.5 4-4"/>',
    drag: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/>', target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>', wave: '<path d="M2 14c3 0 3-6 6-6s3 8 6 8 3-6 6-6h2"/>', pct: '<path d="M19 5 5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/>',
    ceil: '<path d="M4 4h16M12 20V8M7 13l5-5 5 5"/>', lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    db: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    chart: '<path d="M4 20V11M10 20V4M16 20v-7M21 20H3"/>', candle: '<path d="M7 3v4M7 17v4M17 6v3M17 15v4"/><rect x="5" y="7" width="4" height="10" rx="1"/><rect x="15" y="9" width="4" height="6" rx="1"/>',
  };
  const sprite = () => '<svg width="0" height="0" style="position:absolute" aria-hidden="true">' + Object.entries(ICONS).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join("") + "</svg>";
  const ic = (n, c = "") => `<svg class="ic ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;

  // 固定種子的隨機漫步（虛構）
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function walk(seed, n, start, vol, drift = 0) { const r = rng(seed); const a = [start]; for (let i = 1; i < n; i++) a.push(Math.max(0.1, a[i - 1] * (1 + (r() - 0.5) * vol + drift))); return a; }
  function toEnd(arr, end) { const k = end / arr[arr.length - 1]; return arr.map((v) => v * k); }

  const D = {
    TS01: { name: "示範半導體", code: "TS01", kind: "上市", px: 100.5, chg: 2.5, pct: 2.55, dir: "up", spark: toEnd(walk(11, 40, 97, 0.012, 0.0008), 100.5), prev: 98 },
    TS02: { name: "範例金融控股", code: "TS02", kind: "上市", px: 23.8, chg: -1.6, pct: -6.3, dir: "dn", spark: toEnd(walk(12, 40, 25.4, 0.014, -0.0016), 23.8), prev: 25.4 },
    TS03: { name: "虛構電子", code: "TS03", kind: "上櫃", px: 312, chg: 0, pct: 0, dir: "flat", spark: toEnd(walk(13, 40, 312, 0.006), 312), prev: 312 },
    TS04: { name: "樣本航運", code: "TS04", kind: "上市", px: 55, chg: 5, pct: 10, dir: "up", lim: "up", spark: toEnd(walk(14, 40, 50, 0.01, 0.0025), 55), prev: 50 },
    TS05: { name: "假想生技", code: "TS05", kind: "上櫃", px: 18.2, chg: -2.02, pct: -9.99, dir: "dn", lim: "dn", spark: toEnd(walk(15, 40, 20.2, 0.012, -0.0025), 18.2), prev: 20.22 },
    TE01: { name: "示範市值 ETF", code: "TE01", kind: "ETF", px: 150, chg: 0.5, pct: 0.33, dir: "up", spark: toEnd(walk(16, 40, 149.5, 0.004, 0.0001), 150), prev: 149.5 },
    TE02: { name: "範例高股息 ETF", code: "TE02", kind: "ETF", px: 22.35, chg: -0.15, pct: -0.67, dir: "dn", spark: toEnd(walk(17, 40, 22.5, 0.004, -0.0002), 22.35), prev: 22.5 },
    TAIEX: { name: "加權指數（示範）", code: "TAIEX", px: 10000, chg: 50, pct: 0.5, dir: "up", spark: toEnd(walk(18, 40, 9950, 0.003, 0.0002), 10000), prev: 9950 },
    TPEX: { name: "櫃買指數（示範）", code: "TPEX", px: 250, chg: -1.25, pct: -0.5, dir: "dn", spark: toEnd(walk(19, 40, 251.25, 0.003, -0.0002), 250), prev: 251.25 },
  };
  const fmt = (v, d = 2) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const sgn = (v, d = 2) => (v > 0 ? "+" : v < 0 ? "−" : "") + fmt(Math.abs(v), d);

  function spark(vals, dir, base) {
    const w = 100, h = 32, mn = Math.min(...vals, base ?? Infinity), mx = Math.max(...vals, base ?? -Infinity), sp = mx - mn || 1;
    const pts = vals.map((v, i) => [(i / (vals.length - 1)) * w, h - ((v - mn) / sp) * (h - 4) - 2]);
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("");
    const by = base != null ? h - ((base - mn) / sp) * (h - 4) - 2 : null;
    return `<svg class="spark ${dir}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${by != null ? `<line class="base" x1="0" x2="${w}" y1="${by}" y2="${by}" vector-effect="non-scaling-stroke"/>` : ""}<path class="a" d="${d}L${w} ${h}L0 ${h}Z"/><path class="l" d="${d}" vector-effect="non-scaling-stroke"/></svg>`;
  }
  const chg = (s) => `<span class="chg ${s.dir}">${s.dir === "flat" ? "平盤" : sgn(s.chg)}</span>`;
  const pill = (s, solid) => s.lim ? `<span class="pill solid ${s.dir}">${s.lim === "up" ? "漲停" : "跌停"}</span>` : `<span class="pill ${s.dir}${solid ? " solid" : ""}">${s.dir === "up" ? "▲" : s.dir === "dn" ? "▼" : ""}${s.dir === "flat" ? "0.00%" : sgn(s.pct) + "%"}</span>`;
  const statusTag = (st, t) => ({
    live: `<span class="tag live">即時</span>`,
    delayed: `<span class="tag delayed">${ic("clock", "xs")}稍舊 <span class="num">${t || "10:41:05"}</span></span>`,
    stale: `<span class="tag stale">${ic("clock", "xs")}過期 <span class="num">${t || "10:38"}</span></span>`,
    closed: `<span class="tag closed">收盤 <span class="num">${t || "11/04"}</span></span>`,
    cut: `<span class="tag cut">${ic("cut", "xs")}來源中斷 <span class="num">${t || "10:35"}</span></span>`,
    nodata: `<span class="tag nodata">無資料</span>`,
  })[st] || "";

  function qrow(s, o = {}) {
    const st = o.st || "live";
    const cls = st === "stale" ? "is-stale" : st === "cut" ? "is-cut" : "";
    const nodata = st === "nodata";
    const sub = [`<span class="code">${s.code}</span>`];
    if (o.hold) sub.push(`<span class="num">${o.hold}</span>`);
    if (s.lim) sub.push(`<span class="tag lim-${s.lim}">${s.lim === "up" ? "漲停" : "跌停"}</span>`);
    if (o.halt) sub.push(`<span class="tag halt">暫停交易</span>`);
    if (st !== "live" && st !== "closed") sub.push(statusTag(st));
    if (o.badge) sub.push(o.badge);
    return `<div class="qrow ${o.hold ? "hold" : ""} ${cls} ${o.sel ? "sel" : ""}">
      <div style="min-width:0"><div class="nm trunc">${s.name}</div><div class="sub">${sub.join("")}</div></div>
      <div class="sp">${nodata ? "" : spark(s.spark, s.dir, s.prev)}</div>
      <div class="rt">${nodata ? `<span class="px mu2">—</span><span class="pill na">—</span>` : `<span class="px ${s.dir === "flat" ? "flat" : s.dir}">${fmt(s.px)}</span>${o.pnl ? `<span class="pnl chg ${o.pnl[0]}">${o.pnl[1]}</span>` : pill(s)}`}</div>
    </div>`;
  }

  function idxCard(s, st = "live") {
    return `<div class="card idx ${st === "stale" ? "is-stale" : ""}"><div class="nm">${s.name}${st !== "live" ? statusTag(st) : ""}</div>
      <div class="val px ${s.dir}">${fmt(s.px)}</div>
      <div class="cr"><span class="chg ${s.dir}">${sgn(s.chg)}</span><span class="chg ${s.dir} no-glyph">${sgn(s.pct)}%</span></div>
      <div class="sp">${spark(s.spark, s.dir, s.prev)}</div></div>`;
  }

  // 分時與 K 線（SVG，設計示意）
  function intradaySvg(o = {}) {
    const W = o.w || 720, H = o.h || 300, pad = { l: 8, r: 52, t: 12, b: 64 };
    const n = 271, from = o.from ?? 0, gap = o.gap; // gap:[a,b] 分鐘
    const vals = toEnd(walk(o.seed || 21, n, 98, 0.0032, 0.00009), 100.5);
    const prev = 98, up = 107.5, dn = 88.2;
    const lo = Math.min(...vals, prev) - 0.6, hi = Math.max(...vals, prev) + 0.6;
    const x = (i) => pad.l + (i / (n - 1)) * (W - pad.l - pad.r);
    const ph = H - pad.t - pad.b, y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * ph;
    let d = "", pen = false;
    for (let i = from; i < n; i++) { if (gap && i >= gap[0] && i < gap[1]) { pen = false; continue; } d += (pen ? "L" : "M") + x(i).toFixed(1) + " " + y(vals[i]).toFixed(1); pen = true; }
    const r = rng(5); const vb = []; const vt = H - pad.b + 14, vh = pad.b - 22;
    for (let i = from; i < n; i += 3) { if (gap && i >= gap[0] && i < gap[1]) continue; const hh = (0.15 + r() * 0.85) * vh * (i < 30 || i > 250 ? 1 : 0.5); vb.push(`<rect x="${x(i) - 1}" y="${vt + vh - hh}" width="2" height="${hh}" fill="${vals[i] >= vals[Math.max(0, i - 3)] ? "var(--up)" : "var(--dn)"}" opacity=".55"/>`); }
    const grid = [0, 0.25, 0.5, 0.75, 1].map((t) => { const v = lo + (hi - lo) * t; return `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--ch-grid)"/><text x="${W - pad.r + 6}" y="${y(v) + 4}" fill="var(--ch-axis)" font-size="10" font-family="var(--f-m)">${fmt(v)}</text>`; }).join("");
    const times = [["09:00", 0], ["10:00", 60], ["11:00", 120], ["12:00", 180], ["13:30", 270]].map(([t, i]) => `<text x="${x(i)}" y="${H - pad.b + 10}" fill="var(--ch-axis)" font-size="10" font-family="var(--f-m)" text-anchor="${i === 0 ? "start" : i === 270 ? "end" : "middle"}">${t}</text>`).join("");
    const cost = o.cost ? `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(90)}" y2="${y(90)}" stroke="var(--ch-cost)" stroke-width="1.2"/>` : "";
    const al = o.alert ? `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(105)}" y2="${y(105)}" stroke="var(--ch-alert)" stroke-dasharray="5 4" stroke-width="1.2"/><g transform="translate(${W - pad.r - 64} ${y(105) - 9})"><rect width="62" height="18" rx="5" fill="var(--ch-alert)"/><text x="31" y="12.5" text-anchor="middle" font-size="10" font-weight="700" font-family="var(--f-m)" fill="#1a1000">🔔 105.00</text></g>` : "";
    const last = vals[n - 1];
    const lastTag = `<g transform="translate(${W - pad.r + 2} ${y(last) - 9})"><rect width="50" height="18" rx="4" fill="var(--up)"/><text x="25" y="12.5" text-anchor="middle" font-size="10.5" font-weight="700" font-family="var(--f-m)" fill="var(--up-ink)">${fmt(last)}</text></g>`;
    const cross = o.cross ? `<line x1="${x(o.cross)}" x2="${x(o.cross)}" y1="${pad.t}" y2="${H - 8}" stroke="var(--cross)" stroke-dasharray="3 3"/><line x1="${pad.l}" x2="${W - pad.r}" y1="${y(vals[o.cross])}" y2="${y(vals[o.cross])}" stroke="var(--cross)" stroke-dasharray="3 3"/><circle cx="${x(o.cross)}" cy="${y(vals[o.cross])}" r="4" fill="var(--ch-line)" stroke="var(--bg)" stroke-width="2"/>` : "";
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none" role="img" aria-label="分時線：現價 100.50，昨收 98.00">
      <defs><linearGradient id="fg${o.seed || 21}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--ch-fill-top)"/><stop offset="1" stop-color="var(--ch-fill-bot)"/></linearGradient></defs>
      ${grid}${times}
      <line x1="${pad.l}" x2="${W - pad.r}" y1="${y(prev)}" y2="${y(prev)}" stroke="var(--ch-prev)" stroke-dasharray="2 4"/>
      <text x="${pad.l + 4}" y="${y(prev) - 5}" fill="var(--ch-prev)" font-size="10" font-family="var(--f-m)">昨收 98.00</text>
      ${o.limits ? `<text x="${pad.l + 4}" y="${pad.t + 10}" fill="var(--ch-limit)" font-size="10" font-family="var(--f-m)">漲停 ${fmt(up)} ↑</text>` : ""}
      ${cost}${al}
      <path d="${d}" fill="none" stroke="var(--ch-line)" stroke-width="1.8" stroke-linejoin="round" style="filter:drop-shadow(0 0 4px var(--ac-line))"/>
      ${from || gap ? "" : `<path d="${d}L${x(n - 1)} ${pad.t + ph}L${x(0)} ${pad.t + ph}Z" fill="url(#fg${o.seed || 21})"/>`}
      ${vb.join("")}${lastTag}${cross}
    </svg>`;
  }
  function klineSvg(o = {}) {
    const W = o.w || 720, H = o.h || 300, pad = { l: 8, r: 52, t: 12, b: 70 }, n = o.n || 72;
    const r = rng(o.seed || 31); let c = 80; const bars = [];
    for (let i = 0; i < n; i++) { const op = c; c = Math.max(10, c * (1 + (r() - 0.47) * 0.045)); const h = Math.max(op, c) * (1 + r() * 0.015), l = Math.min(op, c) * (1 - r() * 0.015); bars.push({ o: op, c, h, l, v: 0.3 + r() }); }
    const k = 100.5 / bars[n - 1].c; bars.forEach((b) => { b.o *= k; b.c *= k; b.h *= k; b.l *= k; });
    const lo = Math.min(...bars.map((b) => b.l)), hi = Math.max(...bars.map((b) => b.h));
    const cw = (W - pad.l - pad.r) / n, ph = H - pad.t - pad.b;
    const x = (i) => pad.l + cw * (i + 0.5), y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * ph;
    const ma = (p) => bars.map((_, i) => i < p - 1 ? null : bars.slice(i - p + 1, i + 1).reduce((s, b) => s + b.c, 0) / p);
    const mline = (p, col) => { let d = ""; ma(p).forEach((v, i) => { if (v != null) d += (d ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); }); return `<path d="${d}" fill="none" stroke="var(${col})" stroke-width="1.3"/>`; };
    const grid = [0, 0.25, 0.5, 0.75, 1].map((t) => { const v = lo + (hi - lo) * t; return `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--ch-grid)"/><text x="${W - pad.r + 6}" y="${y(v) + 4}" fill="var(--ch-axis)" font-size="10" font-family="var(--f-m)">${fmt(v)}</text>`; }).join("");
    const vt = H - pad.b + 8, vh = pad.b - 26;
    const candles = bars.map((b, i) => { const col = b.c >= b.o ? "var(--up)" : "var(--dn)"; const top = y(Math.max(b.o, b.c)), bot = y(Math.min(b.o, b.c)); const last = i === n - 1;
      return `<line x1="${x(i)}" x2="${x(i)}" y1="${y(b.h)}" y2="${y(b.l)}" stroke="${col}"/><rect x="${x(i) - cw * 0.34}" y="${top}" width="${cw * 0.68}" height="${Math.max(1, bot - top)}" fill="${b.c >= b.o ? "transparent" : col}" stroke="${col}" ${last ? 'stroke-dasharray="2 1.5"' : ""}/>
      <rect x="${x(i) - cw * 0.34}" y="${vt + vh - b.v / 1.3 * vh}" width="${cw * 0.68}" height="${b.v / 1.3 * vh}" fill="${col}" opacity=".45"/>`; }).join("");
    const marks = (o.marks ? [[18, "B", "dn"], [41, "B", "dn"], [58, "S", "up"]].filter(([i]) => i < n - 1) : []).map(([i, t]) => { const b = bars[i]; const yy = t === "B" ? y(b.l) + 14 : y(b.h) - 14; return `<g transform="translate(${x(i)} ${yy})"><circle r="8" fill="${t === "B" ? "var(--ac2)" : "var(--wa)"}"/><text y="3.5" text-anchor="middle" font-size="9.5" font-weight="800" fill="#05070D" font-family="var(--f-m)">${t}</text></g>`; }).join("");
    const cost = o.cost ? `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(90)}" y2="${y(90)}" stroke="var(--ch-cost)" stroke-width="1.2"/><text x="${pad.l + 4}" y="${y(90) - 5}" fill="var(--ch-cost)" font-size="10" font-family="var(--f-m)">成本 90.00</text>` : "";
    const al = o.alert ? `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(105)}" y2="${y(105)}" stroke="var(--ch-alert)" stroke-dasharray="5 4"/><text x="${pad.l + 4}" y="${y(105) - 5}" fill="var(--ch-alert)" font-size="10" font-family="var(--f-m)">🔔 ≥ 105.00</text>` : "";
    const cross = o.cross != null ? (() => { const b = bars[o.cross]; return `<line x1="${x(o.cross)}" x2="${x(o.cross)}" y1="${pad.t}" y2="${H - 8}" stroke="var(--cross)" stroke-dasharray="3 3"/><line x1="${pad.l}" x2="${W - pad.r}" y1="${y(b.c)}" y2="${y(b.c)}" stroke="var(--cross)" stroke-dasharray="3 3"/><g transform="translate(${W - pad.r + 2} ${y(b.c) - 9})"><rect width="50" height="18" rx="4" fill="var(--s3)" stroke="var(--ln2)"/><text x="25" y="12.5" text-anchor="middle" font-size="10.5" font-family="var(--f-m)" fill="var(--tx)">${fmt(b.c)}</text></g>`; })() : "";
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none" role="img" aria-label="日K線">${grid}${candles}${mline(5, "--ma5")}${mline(20, "--ma20")}${mline(60, "--ma60")}${cost}${al}${marks}${cross}</svg>`;
  }
  function subSvg(o = {}) {
    const W = o.w || 720, H = o.h || 90, n = 72, r = rng(41); let k = 50, d = 50; const K = [], Dd = [];
    for (let i = 0; i < n; i++) { k = Math.min(95, Math.max(5, k + (r() - 0.5) * 22)); d = d * 0.7 + k * 0.3; K.push(k); Dd.push(d); }
    const x = (i) => 8 + ((W - 60) / n) * (i + 0.5), y = (v) => 6 + (1 - v / 100) * (H - 12);
    const p = (a) => a.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join("");
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none"><line x1="8" x2="${W - 52}" y1="${y(80)}" y2="${y(80)}" stroke="var(--ch-grid)" stroke-dasharray="3 3"/><line x1="8" x2="${W - 52}" y1="${y(20)}" y2="${y(20)}" stroke="var(--ch-grid)" stroke-dasharray="3 3"/><text x="${W - 46}" y="${y(80) + 4}" font-size="10" fill="var(--ch-axis)" font-family="var(--f-m)">80</text><text x="${W - 46}" y="${y(20) + 4}" font-size="10" fill="var(--ch-axis)" font-family="var(--f-m)">20</text><path d="${p(K)}" fill="none" stroke="var(--ind1)" stroke-width="1.3"/><path d="${p(Dd)}" fill="none" stroke="var(--ind2)" stroke-width="1.3"/></svg>`;
  }

  window.MK = { ICONS, sprite, ic, D, fmt, sgn, spark, chg, pill, statusTag, qrow, idxCard, intradaySvg, klineSvg, subSvg, rng, walk };
})();
