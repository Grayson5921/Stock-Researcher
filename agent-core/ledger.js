// Per-user, DB-backed ledger. Drop-in replacement for the original JSON-file
// ledger: it exposes the SAME function signatures the workflow/monitor already
// import (loadLedger / seenTickers / deniedForField / recordReview / saveLedger /
// priorInteractionSummary), but reads/writes the `ledger_stocks` table scoped to
// one user instead of a flat file.
//
// Because the pure helpers (recordReview, seenTickers, deniedForField,
// priorInteractionSummary) only operate on the in-memory ledger object, they are
// UNCHANGED from the file version. Only loadLedger/saveLedger touch storage, plus
// three small context helpers the worker uses:
//
//   setLedgerContext(pool, userId)  – bind this process to a user (worker: 1/job)
//   await preloadLedger()           – hydrate the in-memory ledger from Postgres
//   await flushLedger()             – await all pending writes before job exit
//
// The worker runs one job at a time (concurrency 1), so a module-level context is
// safe and keeps every original call site (which passes no user) working as-is.
import { config } from "./config.js";
import { latestVerdicts } from "./agents/models.js";

let ctx = null; // { pool, userId, data:{stocks,runs}, pending:Promise }

export function setLedgerContext(pool, userId) {
  ctx = { pool, userId, data: { stocks: {}, runs: [] }, pending: Promise.resolve() };
}
export function clearLedgerContext() {
  ctx = null;
}

// Hydrate the in-memory ledger for the bound user from Postgres.
export async function preloadLedger() {
  if (!ctx) throw new Error("ledger context not set (call setLedgerContext first).");
  const { rows } = await ctx.pool.query(
    "SELECT ticker, data FROM ledger_stocks WHERE user_id = $1",
    [ctx.userId]
  );
  const stocks = {};
  for (const r of rows) stocks[r.ticker] = r.data;
  ctx.data = { stocks, runs: [] };
  return ctx.data;
}

// Same signature as before (no args). Returns the in-memory ledger. Callers that
// need fresh DB state should `await preloadLedger()` first (the worker does).
export function loadLedger() {
  return ctx ? ctx.data : { stocks: {}, runs: [] };
}

export function seenTickers(ledger) {
  return Object.keys(ledger.stocks || {});
}

// Previously-denied stocks in a field that may still be re-argued.
export function deniedForField(ledger, field) {
  return Object.values(ledger.stocks || {}).filter(
    (s) =>
      s.field === field &&
      s.status !== "APPROVED" &&
      (s.revisits || 0) < config.MAX_REVISITS_PER_STOCK
  );
}

// Record (or update) a stock's evaluation in the ledger. (Pure — unchanged.)
export function recordReview(ledger, field, review) {
  const s = review.stock;
  const prev = ledger.stocks[s.ticker];
  const wasRevisit = !!s.revisitOf;
  ledger.stocks[s.ticker] = {
    ticker: s.ticker,
    company: s.company,
    thesis: s.thesis || prev?.thesis || "",
    catalysts: s.catalysts || prev?.catalysts || [],
    field,
    status: review.finalStatus,
    rejectReason: review.rejectReason || "",
    approvals: review.approvals,
    verdicts: latestVerdicts(review).map((v) => ({
      critic: v.criticName,
      approved: v.approved,
      reasoning: v.reasoning,
    })),
    debate: (review.debateLog || []).map((t) => ({
      critic: t.criticName,
      action: t.action,
      argument: t.argument,
    })),
    news: review.news
      ? { score: review.news.sentimentScore, label: review.news.label }
      : null,
    simulation: review.simulation
      ? {
          netUpside: review.simulation.netUpside,
          riskReward: review.simulation.riskReward,
          expectedReturn: review.simulation.expectedReturn ?? null,
          upside: review.simulation.upside ?? null,
          downside: review.simulation.downside ?? null,
        }
      : null,
    revisits: (prev?.revisits || 0) + (wasRevisit ? 1 : 0),
    entryPrice: s.entryPrice ?? prev?.entryPrice ?? null,
    approvedAt: review.finalStatus === "APPROVED" ? new Date().toISOString() : prev?.approvedAt || null,
    firstSeen: prev?.firstSeen || new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    // Preserve real-position + sold fields the monitor/CLI may attach.
    position: prev?.position,
    soldRecord: prev?.soldRecord,
  };
}

// Persist the ledger to Postgres for the bound user. Same signature as the file
// version (fire-and-forget so existing synchronous call sites are unchanged); the
// worker awaits flushLedger() before finishing the job to guarantee durability.
export function saveLedger(ledger) {
  if (!ctx) return; // no context (e.g. imported without a job) -> no-op
  const stocks = ledger?.stocks || {};
  ctx.pending = ctx.pending
    .then(() => upsertAll(ctx, stocks))
    .catch((e) => console.warn(`[warn] ledger persist failed: ${e.message}`));
}

export async function flushLedger() {
  if (ctx) await ctx.pending;
}

async function upsertAll(context, stocks) {
  for (const s of Object.values(stocks)) {
    await context.pool.query(
      `INSERT INTO ledger_stocks(user_id, ticker, company, field, status, approved_at, data, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (user_id, ticker) DO UPDATE SET
         company = EXCLUDED.company,
         field = EXCLUDED.field,
         status = EXCLUDED.status,
         approved_at = EXCLUDED.approved_at,
         data = EXCLUDED.data,
         updated_at = now()`,
      [
        context.userId,
        s.ticker,
        s.company || null,
        s.field || null,
        s.status || null,
        s.approvedAt || null,
        JSON.stringify(s),
      ]
    );
  }
}

// Build a compact prior-interaction summary for a revisited stock. (Unchanged.)
export function priorInteractionSummary(entry) {
  const denials = (entry.verdicts || []).filter((v) => !v.approved);
  const parts = denials.map((v) => `${v.critic}: ${v.reasoning}`);
  let s =
    `This stock was previously ${entry.status} (${entry.rejectReason || "see verdicts"}). ` +
    `Prior denials — ${parts.join(" | ") || "none recorded"}.`;
  if (entry.debate?.length) {
    s += " Prior debate: " + entry.debate.map((d) => `${d.action} vs ${d.critic}`).join("; ") + ".";
  }
  return s;
}
