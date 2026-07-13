// Real market data (ground truth) injected into agent context so prices,
// market caps, and financials come from data feeds, not model recall.
// - Quote/fundamentals: Yahoo Finance public endpoint (no key needed);
//   optional Finnhub metrics if FINNHUB_API_KEY is set in .env.
// - Reported financials: SEC EDGAR companyfacts (free, US-listed tickers).
// Everything degrades gracefully: on any failure we return null and the
// pipeline proceeds with a note that live data was unavailable.
import { config } from "./config.js";

const TIMEOUT_MS = 8000;

async function getJson(url, headers = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers, signal: ctl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const fmtB = (n) => (n == null ? "n/a" : n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : String(n));

// ---------------------------------------------------------------------------
// Quote + fundamentals.
//
// Provider selection (config.MARKET_DATA_PROVIDER):
//   "finnhub" – licensed for commercial use; requires FINNHUB_API_KEY.
//   "yahoo"   – keyless, convenient for local dev, NOT licensed commercially.
//
// In production, if the licensed provider is selected but no key is present, we
// return null (no data) rather than silently falling back to the unlicensed
// Yahoo endpoint. In non-production we fall back to Yahoo so dev keeps working.
// ---------------------------------------------------------------------------
export async function fetchQuote(ticker) {
  const provider = config.MARKET_DATA_PROVIDER || "yahoo";
  const hasFinnhub = !!process.env.FINNHUB_API_KEY;
  if (provider === "finnhub") {
    if (hasFinnhub) return fetchQuoteFinnhub(ticker);
    if (process.env.NODE_ENV === "production") return null; // don't use unlicensed data commercially
    // dev convenience: fall through to Yahoo
  }
  return fetchQuoteYahoo(ticker);
}

// Licensed path: Finnhub /quote for price + /stock/metric for 52w range & fundamentals.
async function fetchQuoteFinnhub(ticker) {
  const key = process.env.FINNHUB_API_KEY;
  const [q, m] = await Promise.all([
    getJson(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${key}`),
    getJson(`https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all&token=${key}`),
  ]);
  const mm = m?.metric;
  let quote = null;
  if (q?.c != null && q.c > 0) {
    quote = {
      price: q.c,
      currency: "USD",
      hi52: mm?.["52WeekHigh"] ?? q.h ?? q.c,
      lo52: mm?.["52WeekLow"] ?? q.l ?? q.c,
      sma50: null, // daily candles are premium on Finnhub; leave unknown
      sma200: null,
    };
  }
  let finnhub = null;
  if (mm) {
    finnhub = {
      marketCap: mm.marketCapitalization ? mm.marketCapitalization * 1e6 : null,
      peTTM: mm.peTTM,
      beta: mm.beta,
      avgVol10d: mm["10DayAverageTradingVolume"] ? mm["10DayAverageTradingVolume"] * 1e6 : null,
    };
  }
  if (!quote && !finnhub) return null;
  return { quote, finnhub };
}

// Keyless dev path (Yahoo). Not licensed for commercial use.
async function fetchQuoteYahoo(ticker) {
  const y = await getJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`,
    { "User-Agent": "Mozilla/5.0" }
  );
  const meta = y?.chart?.result?.[0]?.meta;
  const closes = y?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter((x) => x != null) || [];
  let quote = null;
  if (meta?.regularMarketPrice != null) {
    const price = meta.regularMarketPrice;
    const hi52 = Math.max(...closes, price);
    const lo52 = Math.min(...closes, price);
    const sma50 = closes.length >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : null;
    const sma200 = closes.length >= 200 ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200 : null;
    quote = { price, currency: meta.currency, hi52, lo52, sma50, sma200 };
  }
  let finnhub = null;
  const key = process.env.FINNHUB_API_KEY;
  if (key) {
    const m = await getJson(`https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${key}`);
    const mm = m?.metric;
    if (mm) finnhub = { marketCap: mm.marketCapitalization ? mm.marketCapitalization * 1e6 : null, peTTM: mm.peTTM, beta: mm.beta, avgVol10d: mm["10DayAverageTradingVolume"] ? mm["10DayAverageTradingVolume"] * 1e6 : null };
  }
  if (!quote && !finnhub) return null;
  return { quote, finnhub };
}

// ---------------------------------------------------------------------------
// SEC EDGAR reported financials
// ---------------------------------------------------------------------------
let tickerMapCache = null;
async function cikFor(ticker) {
  if (!tickerMapCache) {
    tickerMapCache = await getJson("https://www.sec.gov/files/company_tickers.json", { "User-Agent": config.SEC_USER_AGENT });
    if (!tickerMapCache) return null;
  }
  const hit = Object.values(tickerMapCache).find((e) => e.ticker?.toUpperCase() === ticker.toUpperCase());
  return hit ? String(hit.cik_str).padStart(10, "0") : null;
}

function latestFact(facts, tag) {
  const units = facts?.["us-gaap"]?.[tag]?.units;
  if (!units) return null;
  const arr = Object.values(units)[0];
  if (!arr?.length) return null;
  const annual = arr.filter((x) => x.form === "10-K" || x.fp === "FY");
  const use = (annual.length ? annual : arr).sort((a, b) => (a.end < b.end ? 1 : -1))[0];
  return use ? { value: use.value, end: use.end } : null;
}

export async function fetchSecFacts(ticker) {
  const cik = await cikFor(ticker);
  if (!cik) return null;
  const facts = await getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { "User-Agent": config.SEC_USER_AGENT });
  if (!facts?.facts) return null;
  const g = (tags) => { for (const t of tags) { const v = latestFact(facts.facts, t); if (v) return v; } return null; };
  return {
    entity: facts.entityName,
    revenue: g(["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"]),
    netIncome: g(["NetIncomeLoss"]),
    cash: g(["CashAndCashEquivalentsAtCarryingValue"]),
    debt: g(["LongTermDebt", "LongTermDebtNoncurrent"]),
    opCashFlow: g(["NetCashProvidedByUsedInOperatingActivities"]),
  };
}

// ---------------------------------------------------------------------------
// Next earnings date (Finnhub, needs key). Returns "YYYY-MM-DD" or null.
// ---------------------------------------------------------------------------
export async function fetchNextEarnings(ticker) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return null;
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 10);
  const d = await getJson(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&symbol=${ticker}&token=${key}`);
  const ev = d?.earningsCalendar?.[0];
  return ev?.date || null;
}

// ---------------------------------------------------------------------------
// Combined: fetch everything for a ticker and render a ground-truth block
// ---------------------------------------------------------------------------
export async function fetchGroundTruth(ticker) {
  const [md, sec] = await Promise.all([
    config.ENABLE_MARKET_DATA ? fetchQuote(ticker) : null,
    config.ENABLE_SEC_DATA ? fetchSecFacts(ticker) : null,
  ]);
  if (!md && !sec) return null;
  const L = [`VERIFIED MARKET DATA for ${ticker} (from data feeds — treat as ground truth over any conflicting claim):`];
  if (md?.quote) {
    const q = md.quote;
    L.push(`  Price: ${q.price} ${q.currency || ""} | 52w range: ${q.lo52?.toFixed(2)}–${q.hi52?.toFixed(2)}` +
      (q.sma50 ? ` | 50d SMA ${q.sma50.toFixed(2)}` : "") + (q.sma200 ? ` | 200d SMA ${q.sma200.toFixed(2)}` : ""));
  }
  if (md?.finnhub) {
    const f = md.finnhub;
    L.push(`  Market cap: ${fmtB(f.marketCap)} | P/E (TTM): ${f.peTTM ?? "n/a"} | Beta: ${f.beta ?? "n/a"} | Avg vol (10d): ${fmtB(f.avgVol10d)}`);
  }
  if (sec) {
    const v = (x) => (x ? `${fmtB(x.value)} (${x.end})` : "n/a");
    L.push(`  SEC-reported: revenue ${v(sec.revenue)} | net income ${v(sec.netIncome)} | cash ${v(sec.cash)} | LT debt ${v(sec.debt)} | op cash flow ${v(sec.opCashFlow)}`);
  }
  return { text: L.join("\n"), price: md?.quote?.price ?? null, marketCap: md?.finnhub?.marketCap ?? null };
}
