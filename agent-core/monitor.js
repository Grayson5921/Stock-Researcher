// Daily sell monitor: `node main.js --monitor` (optionally with tickers).
// For every APPROVED holding in the ledger it fetches current data, computes
// rule flags (stop breach, target hit), has the Sell Analyst re-test the
// original thesis against fresh news, and writes a HOLD/TRIM/SELL/ADD report.
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { loadLedger, saveLedger } from "./ledger.js";
import { fetchGroundTruth, fetchNextEarnings } from "./marketData.js";
import { SellAnalystAgent } from "./agents/sellAnalystAgent.js";

const ORDER = { SELL: 0, TRIM: 1, ADD: 2, HOLD: 3 };

export async function runMonitor(client, onlyTickers = []) {
  const ledger = loadLedger();
  const all = Object.values(ledger.stocks || {});
  const marked = all.filter((s) => s.position?.owned);
  // If you've marked any real positions (--bought), monitor ONLY those; otherwise
  // fall back to every APPROVED pick (assumed-held mode).
  let holdings = marked.length ? marked : all.filter((s) => s.status === "APPROVED");
  if (!marked.length && holdings.length)
    console.log("(No --bought positions marked; monitoring all APPROVED picks at approval prices.)\n");
  if (onlyTickers.length) holdings = holdings.filter((s) => onlyTickers.includes(s.ticker));
  if (!holdings.length) {
    console.log(onlyTickers.length
      ? `No APPROVED holdings matching: ${onlyTickers.join(", ")}`
      : "No APPROVED holdings in the ledger yet — run the workflow first.");
    return;
  }

  console.log(`Monitoring ${holdings.length} holding(s)...\n`);
  const analyst = new SellAnalystAgent(client);
  const rows = [];

  for (const h of holdings) {
    console.log(`>>> ${h.ticker} (${h.company})`);
    // 1. Current data
    let gt = null;
    try { gt = await fetchGroundTruth(h.ticker); } catch { /* proceed */ }
    const price = gt?.price ?? null;
    const entry = h.position?.costBasis ?? h.entryPrice ?? null; // YOUR basis when marked
    const returnPct = price != null && entry ? ((price - entry) / entry) * 100 : null;
    const shares = h.position?.shares ?? null;
    const pl = shares != null && price != null && entry != null ? (price - entry) * shares : null;

    // High-water mark for trailing stops (tracked across monitor runs).
    const prevHigh = Math.max(entry ?? 0, ...(h.monitorLog || []).map((m) => m.price ?? 0));
    const highWater = Math.max(prevHigh, price ?? 0) || null;

    // Change-detection: skip the full analyst call on quiet days.
    const last = (h.monitorLog || []).at(-1);
    const movedPct = last?.price && price != null ? Math.abs((price - last.price) / last.price) * 100 : null;

    // 2. Rule flags (mechanical, computed before any model judgment)
    const flags = [];
    const stop = config.MONITOR_STOP_LOSS_PCT;
    if (stop != null && price != null) {
      if (config.MONITOR_STOP_MODE === "trailing" && highWater) {
        const offHigh = ((price - highWater) / highWater) * 100;
        if (offHigh <= -stop)
          flags.push(`TRAILING STOP BREACHED: ${offHigh.toFixed(1)}% off high of ${highWater.toFixed(2)} (stop ${stop}%)`);
      } else if (returnPct != null && returnPct <= -stop) {
        flags.push(`STOP BREACHED: down ${(-returnPct).toFixed(1)}% (stop ${stop}%)`);
      }
    }
    // Earnings proximity (Finnhub key required; silently skipped without).
    try {
      const ed = await fetchNextEarnings(h.ticker);
      if (ed) {
        const days = Math.ceil((new Date(ed) - Date.now()) / 864e5);
        if (days >= 0 && days <= config.MONITOR_EARNINGS_WARN_DAYS)
          flags.push(`EARNINGS in ${days} day(s) (${ed}) — expect volatility; verdicts near earnings deserve extra care`);
      }
    } catch { /* ignore */ }
    // Trend escalation: mechanical, so slow bleeds can't hide in daily HOLDs.
    const lastN = (h.monitorLog || []).slice(-3);
    if (lastN.length === 3 && lastN.every((m, i) => i === 0 || m.confidence < lastN[i - 1].confidence))
      flags.push("TREND: analyst confidence declining 3 checks running — escalate scrutiny");
    if (lastN.some((m) => m.thesisIntact === false))
      flags.push("TREND: thesis was flagged BROKEN in a recent check");
    const tp = config.MONITOR_TAKE_PROFIT_PCT ?? h.simulation?.expectedReturn ?? null;
    if (returnPct != null && tp != null && tp > 0 && returnPct >= tp)
      flags.push(`TARGET REACHED: up ${returnPct.toFixed(1)}% (target +${tp}%)`);

    // Quiet-day skip: unchanged price, no flags, last verdict HOLD -> log-only.
    if (flags.length === 0 && last?.action === "HOLD" && movedPct != null
        && movedPct < config.MONITOR_SKIP_UNCHANGED_PCT) {
      console.log(`    unchanged (${movedPct.toFixed(1)}% move, no flags) — skipped full analysis, logged price.\n`);
      h.monitorLog = (h.monitorLog || []).concat([{ date: new Date().toISOString().slice(0,10),
        price, returnPct: returnPct == null ? null : +returnPct.toFixed(2), action: "HOLD",
        confidence: last.confidence, thesisIntact: last.thesisIntact, catalystStatus: last.catalystStatus,
        flags: [], skipped: true, reasoning: "No material change; carried forward." }]).slice(-config.MONITOR_HISTORY_KEEP);
      rows.push({ h, price, entry, returnPct, pl, shares, flags, verdict: { action: "HOLD",
        confidence: last.confidence, thesisIntact: last.thesisIntact, catalystStatus: last.catalystStatus,
        keyDevelopments: [], reasoning: "(quiet day — carried forward from last full check)" } });
      continue;
    }

    // 3. Thesis re-test with fresh news
    const priorVerdicts = (h.monitorLog || []).slice(-3).map((m) => `${m.date}: ${m.action}`).join(", ");
    const verdict = await analyst.assess(h, {
      entry, price, returnPct,
      marketText: gt?.text || null,
      targets: h.simulation || {},
      flags, priorVerdicts,
    });

    console.log(`    ${verdict.action} (${verdict.confidence}%) — ${verdict.reasoning}\n`);

    // 4. Record snapshot in the ledger
    h.monitorLog = (h.monitorLog || []).concat([{
      date: new Date().toISOString().slice(0, 10),
      price, returnPct: returnPct == null ? null : +returnPct.toFixed(2),
      action: verdict.action, confidence: verdict.confidence,
      thesisIntact: verdict.thesisIntact, catalystStatus: verdict.catalystStatus,
      flags, reasoning: verdict.reasoning,
    }]).slice(-config.MONITOR_HISTORY_KEEP);
    rows.push({ h, price, entry, returnPct, pl, shares, flags, verdict });
  }
  saveLedger(ledger);

  // 5. Report (console table + Notepad-ready .txt)
  rows.sort((a, b) => ORDER[a.verdict.action] - ORDER[b.verdict.action]);
  const L = [];
  L.push("DAILY SELL MONITOR — " + new Date().toISOString().slice(0, 16).replace("T", " "));
  L.push("Actions: SELL = exit | TRIM = take some off | ADD = thesis stronger at this price | HOLD = no change");
  L.push("This is automated research, NOT financial advice. Verify before trading.");
  L.push("=".repeat(72));
  for (const r of rows) {
    const ret = r.returnPct == null ? "n/a" : (r.returnPct >= 0 ? "+" : "") + r.returnPct.toFixed(1) + "%";
    L.push("");
    L.push(`${r.verdict.action}  ${r.h.ticker} — ${r.h.company}   (${ret} since entry, confidence ${r.verdict.confidence}%)`);
    const pos = r.shares != null ? ` | ${r.shares} sh${r.pl != null ? `, P&L ${r.pl >= 0 ? "+" : ""}$${r.pl.toFixed(2)}` : ""}` : "";
    L.push(`  Entry ${r.entry ?? "n/a"} -> now ${r.price ?? "n/a"}${pos} | thesis ${r.verdict.thesisIntact ? "INTACT" : "BROKEN"} | catalyst ${r.verdict.catalystStatus}`);
    if (r.flags.length) L.push(`  Rule flags: ${r.flags.join("; ")}`);
    if (r.verdict.keyDevelopments.length) {
      L.push("  Developments:");
      for (const k of r.verdict.keyDevelopments) L.push(`    - ${k}`);
    }
    L.push(`  Reasoning: ${r.verdict.reasoning}`);
  }
  const sells = rows.filter((r) => r.verdict.action === "SELL").length;
  const trims = rows.filter((r) => r.verdict.action === "TRIM").length;
  L.push("");
  L.push("=".repeat(72));
  L.push(`SUMMARY: ${sells} SELL, ${trims} TRIM, ${rows.filter(r=>r.verdict.action==="ADD").length} ADD, ${rows.filter(r=>r.verdict.action==="HOLD").length} HOLD.`);

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const file = `sell_monitor_${stamp}.txt`;
  fs.writeFileSync(file, L.join("\n").replace(/\r?\n/g, "\r\n"), "utf-8");
  console.log(L.join("\n"));
  console.log(`\nSaved: ${path.resolve(file)}`);
}
