// Tallies token usage and web searches from every API response, then reports
// an estimated dollar cost. Prices are $/MTok (approximate; update as needed).
const PRICES = {
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-haiku-4-5-20251001": { in: 1, out: 5 }, // dated id used by the gatekeepers/monitor
};

// Thrown when a job's estimated spend crosses config.COST_CEILING_USD. The
// worker catches this to abort the run politely and refund the credit.
export class CostCeilingError extends Error {
  constructor(spent, ceiling) {
    super(`Cost ceiling reached: estimated $${spent.toFixed(2)} >= $${ceiling.toFixed(2)}`);
    this.name = "CostCeilingError";
    this.spent = spent;
    this.ceiling = ceiling;
  }
}
const CACHE_READ_MULT = 0.1; // cache reads ~10% of base input price
const CACHE_WRITE_MULT = 1.25; // cache writes ~125% of base input price
const SEARCH_PRICE = 10 / 1000; // $10 per 1,000 web searches

export class CostTracker {
  constructor() {
    this.reset();
  }
  // Reset all counters. The worker calls this at the start of every job so the
  // module singleton is scoped to (and attributable to) exactly one job/user.
  reset() {
    this.byModel = {}; // model -> {in, out, cacheRead, cacheWrite}
    this.searches = 0;
    this.calls = 0;
  }
  record(model, usage) {
    this.calls += 1;
    if (!usage) return;
    const m = (this.byModel[model] ||= { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 });
    m.in += usage.input_tokens || 0;
    m.out += usage.output_tokens || 0;
    m.cacheRead += usage.cache_read_input_tokens || 0;
    m.cacheWrite += usage.cache_creation_input_tokens || 0;
    const st = usage.server_tool_use;
    if (st && st.web_search_requests) this.searches += st.web_search_requests;
  }
  _modelUsd(model, m) {
    const p = PRICES[model] || PRICES["claude-sonnet-4-6"];
    return (
      (m.in / 1e6) * p.in +
      (m.out / 1e6) * p.out +
      (m.cacheRead / 1e6) * p.in * CACHE_READ_MULT +
      (m.cacheWrite / 1e6) * p.in * CACHE_WRITE_MULT
    );
  }
  total() {
    let usd = 0;
    for (const [model, m] of Object.entries(this.byModel)) usd += this._modelUsd(model, m);
    usd += this.searches * SEARCH_PRICE;
    return usd;
  }
  // Per-model rows (+ a web_search row) shaped for the usage_ledger table, so
  // every dollar of API spend is attributed to the job/user that incurred it.
  snapshot() {
    const rows = [];
    for (const [model, m] of Object.entries(this.byModel)) {
      rows.push({
        model,
        in_tokens: m.in,
        out_tokens: m.out,
        cached_tokens: m.cacheRead + m.cacheWrite,
        searches: 0,
        cost_usd: Number(this._modelUsd(model, m).toFixed(4)),
      });
    }
    if (this.searches > 0) {
      rows.push({
        model: "web_search",
        in_tokens: 0,
        out_tokens: 0,
        cached_tokens: 0,
        searches: this.searches,
        cost_usd: Number((this.searches * SEARCH_PRICE).toFixed(4)),
      });
    }
    return { rows, totalUsd: Number(this.total().toFixed(4)), calls: this.calls, searches: this.searches };
  }
  report() {
    const lines = ["", "=".repeat(50), "ESTIMATED RUN COST"];
    for (const [model, m] of Object.entries(this.byModel)) {
      lines.push(
        `  ${model}: ${(m.in / 1000).toFixed(1)}k in / ${(m.out / 1000).toFixed(1)}k out` +
          (m.cacheRead ? ` / ${(m.cacheRead / 1000).toFixed(1)}k cached` : "")
      );
    }
    lines.push(`  Web searches: ${this.searches}  |  API calls: ${this.calls}`);
    lines.push(`  ≈ $${this.total().toFixed(2)}  (estimate; check console billing for exact)`);
    lines.push("=".repeat(50));
    return lines.join("\n");
  }
}

export const costTracker = new CostTracker();
