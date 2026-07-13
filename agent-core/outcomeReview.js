// Outcome tracking: `node main.js --review` re-checks every APPROVED stock in
// the ledger against its current price, so over time you learn whether the
// gates are calibrated — instead of tuning blind.
import { loadLedger, saveLedger } from "./ledger.js";
import { fetchQuote } from "./marketData.js";

export async function reviewOutcomes() {
  const ledger = loadLedger();
  const approved = Object.values(ledger.stocks || {}).filter((s) => s.status === "APPROVED");
  if (!approved.length) {
    console.log("No APPROVED stocks in the ledger yet — run the workflow first.");
    return;
  }
  console.log(`Reviewing ${approved.length} approved pick(s) against current prices...\n`);
  const rows = [];
  for (const s of approved) {
    const entry = s.position?.costBasis ?? s.entryPrice ?? null;
    let now, ret, closed = false;
    if (s.soldRecord?.price != null) {
      // Position was SOLD: lock the realized return at the sale price.
      now = s.soldRecord.price; closed = true;
      ret = entry != null && entry > 0 ? ((now - entry) / entry) * 100 : null;
    } else {
      const q = await fetchQuote(s.ticker);
      now = q?.quote?.price ?? null;
      ret = now != null && entry != null && entry > 0 ? ((now - entry) / entry) * 100 : null;
    }
    s.lastReview = { at: new Date().toISOString(), price: now, returnPct: ret };
    rows.push({ t: s.ticker + (closed ? "*" : ""), entry, now, ret, since: (s.approvedAt || s.lastSeen || "").slice(0, 10), conf: s.simulation?.netUpside });
  }
  saveLedger(ledger);
  rows.sort((a, b) => (b.ret ?? -Infinity) - (a.ret ?? -Infinity));
  console.log("TICKER  APPROVED    ENTRY      NOW        RETURN    SIM-CONF");
  for (const r of rows) {
    const f = (x, d = 2) => (x == null ? "n/a" : Number(x).toFixed(d));
    console.log(
      `${r.t.padEnd(7)} ${String(r.since).padEnd(11)} ${f(r.entry).padStart(8)}  ${f(r.now).padStart(8)}  ` +
        `${(r.ret == null ? "  n/a" : (r.ret >= 0 ? "+" : "") + r.ret.toFixed(1) + "%").padStart(8)}   ${r.conf ?? "n/a"}%`
    );
  }
  const known = rows.filter((r) => r.ret != null);
  if (known.length) {
    const avg = known.reduce((a, r) => a + r.ret, 0) / known.length;
    const winners = known.filter((r) => r.ret > 0).length;
    console.log(`\nAvg return: ${avg >= 0 ? "+" : ""}${avg.toFixed(1)}%  |  Win rate: ${winners}/${known.length}`);
    console.log("(* = closed position, return locked at your sale price)");
    console.log("Use this to calibrate REQUIRED_APPROVALS / SIMULATION_GATE_THRESHOLD over time.");
  } else {
    console.log("\n(No live prices available — entry prices are recorded going forward, so re-run --review later.)");
  }
}
