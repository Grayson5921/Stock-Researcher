// Central configuration. Tune these to trade off thoroughness vs. API cost/time.
// Values can also be overridden via command-line flags in main.js.

export const config = {
  // --- Models ------------------------------------------------------------
  // Split-model setup: the RESEARCH agents (hunting, arguing, re-arguing) run
  // on Opus 4.8 — the most capable model, worth it where judgment matters most.
  // Everything else (critics, simulators, news, portfolio) runs on Sonnet 4.6,
  // which handles structured evaluation well at a fraction of the cost
  // ($3/$15 vs $5/$25 per MTok).
  MODEL: "claude-sonnet-4-6",          // critics, simulators, news, portfolio
  RESEARCH_MODEL: "claude-opus-4-8",   // research agents (incl. --ticker mode)

  // Reasoning effort: "low" | "medium" | "high" | "xhigh" | "max".
  EFFORT: "medium",           // effort for the Sonnet agents
  RESEARCH_EFFORT: "high",    // effort for the Opus research agents (Opus default)

  // --- Research fields ---------------------------------------------------
  // One research agent is created per field. Edit freely.
  FIELDS: {
    technology: "Software, semiconductors, hardware, AI infrastructure, and IT services.",
    business: "Consumer, industrial, financial, and services companies (general business).",
    energy: "Oil & gas, utilities, renewables, grid, storage, and energy technology.",
  },

  // --- Workflow knobs ----------------------------------------------------
  STOCKS_PER_FIELD: 5, // how many candidates each research agent first proposes

  // A stock is "finally approved" only when at least this many critics approve.
  // null = UNANIMOUS (all critics must approve). Set a number to relax.
  REQUIRED_APPROVALS: 8, // 8 of the 9 critics (one dissenter allowed)

  // Per-stock debate: how many rounds of (researcher rebuts -> critic re-reviews).
  MAX_DEBATE_ROUNDS: 3,

  // Cap on how many critics the researcher may try to flip in one debate.
  // null = NO CAP: if the researcher believes it can argue every denying critic
  // into approval, it is allowed to try (more thorough, but costs more).
  MAX_DEBATE_GAP: null,

  // When researching NEW ideas, fetch at most this many at a time. Keeps each
  // search round cheap.
  MAX_NEW_RESEARCH_AT_ONCE: 2,

  // --- Loop until viable -------------------------------------------------
  // The field keeps researching fresh candidates until it finds this many
  // VIABLE stocks (passing every gate) or hits the safety cap below.
  TARGET_APPROVED_PER_FIELD: 1,
  // SAFETY CAP. "Loop until viable" could otherwise run forever / spend
  // unbounded credits, so the search stops after this many rounds even if no
  // viable stock was found. Raise it if you want it to try harder (costs more).
  MAX_SEARCH_ROUNDS: 10,
  // Give up early if this many consecutive rounds return no NEW candidates
  // (the agent has run out of fresh ideas for the field).
  MAX_EMPTY_ROUNDS: 2,

  // --- Web search --------------------------------------------------------
  WEB_SEARCH_MAX_USES: 4, // max searches per research/rebuttal call (lowered for cost)

  // --- Scenario simulators (bull & bear) ---------------------------------
  // After a stock clears the 5-critic panel, two simulators forecast its price
  // direction over a horizon by reasoning about current + anticipated business
  // and world events. Their two probability-of-increase estimates are averaged
  // into a net "upside confidence". This confidence is now used to RANK the
  // approved companies (highest first) rather than as a hard pass/fail cutoff.
  // Simulators run ONLY on critic-approved stocks to save credits.
  ENABLE_SIMULATORS: true,
  SIMULATION_HORIZON: "12 months",
  // Hard cutoff: an approved stock must reach this net upside confidence or it is
  // dropped. Approved survivors are still ranked by confidence. null = rank only.
  SIMULATION_GATE_THRESHOLD: 55,

  // --- News & sentiment agent --------------------------------------------
  // Searches recent news on each critic-approved stock, classifies items as
  // positive/negative, scores net sentiment, and feeds that into the simulators
  // so their forecast is grounded in real reporting.
  ENABLE_NEWS_AGENT: true,
  NEWS_LOOKBACK: "the last 6 months",
  // Treat clearly negative recent news as a hard gate: a stock whose news flow
  // is net-negative is dropped (a viable buy should not be fighting bad news).
  NEWS_BLOCK_IF_NEGATIVE: true,

  // --- Portfolio fit -----------------------------------------------------
  // Your current holdings. The portfolio-fit agent judges whether each finally
  // approved pick adds diversification or piles into exposure you already have.
  ENABLE_PORTFOLIO_FIT: true,
  HOLDINGS: [
    { name: "Vanguard broad-market ETF (e.g. VTI/VOO)", weight: "~50%", note: "broad US equity beta" },
    { name: "Vanguard Total Stock Market index fund", weight: "~33%", note: "broad US equity, overlaps the ETF" },
    { ticker: "IBM", name: "IBM", weight: "~5%", note: "large-cap IT / tech" },
  ],

  // --- Real market data (ground truth) ------------------------------------
  // Fetch actual quote/fundamentals per candidate and inject into every agent's
  // context, so prices/market caps/volumes come from data, not model recall.
  // Uses Yahoo Finance's public endpoint (no key). Optional: set FINNHUB_API_KEY
  // in .env to also pull Finnhub metrics. Gracefully skipped if fetch fails.
  ENABLE_MARKET_DATA: true,

  // --- SEC EDGAR facts (ground truth for financials) ----------------------
  // Pull key reported financials (revenue, net income, cash, debt) from SEC
  // EDGAR's free API and inject as ground truth. US-listed tickers only;
  // gracefully skipped otherwise.
  ENABLE_SEC_DATA: true,
  SEC_USER_AGENT: "stock-research-workflow contact@example.com", // EDGAR requires a UA

  // --- Cheap gatekeepers (run BEFORE the expensive 9-critic panel) --------
  // Pre-screen: one cheap call asking "does this obviously fail the gauntlet?"
  // Verifier: fact-checks the researcher's 2-3 load-bearing claims (grant exists,
  // earnings beat happened) so hallucinated catalysts die for pennies.
  ENABLE_PRESCREEN: true,
  ENABLE_VERIFIER: true,
  GATEKEEPER_MODEL: "claude-haiku-4-5-20251001", // cheap model (Haiku needs the dated string)

  // --- Prompt caching ------------------------------------------------------
  // Marks agent system prompts (critic criteria, research digest) as cacheable,
  // cutting repeated input-token cost by up to ~90% on the panel.
  ENABLE_PROMPT_CACHE: true,

  // --- Cost tracking -------------------------------------------------------
  // Tallies token usage + web searches from every API response and prints an
  // estimated dollar cost at the end of the run.
  ENABLE_COST_TRACKER: true,

  // --- Daily sell monitor ---------------------------------------------------
  // `node main.js --monitor` re-evaluates every APPROVED holding daily:
  // current price vs entry/targets/stop, fresh news, and a thesis re-test,
  // producing HOLD / TRIM / SELL / ADD per position.
  MONITOR_STOP_LOSS_PCT: 20,   // rule flag: down this % = stop breached
  MONITOR_STOP_MODE: "trailing", // "entry" = from cost basis; "trailing" = from highest price seen since entry
  MONITOR_EARNINGS_WARN_DAYS: 7, // flag if earnings are within this many days (needs FINNHUB_API_KEY)
  MONITOR_SKIP_UNCHANGED_PCT: 2, // skip the full analyst call if price moved less than this % since last check, no flags, last verdict HOLD
  MONITOR_TAKE_PROFIT_PCT: null, // optional rule flag: up this % = target zone (null = use sim upside)
  MONITOR_HISTORY_KEEP: 30,    // monitor snapshots kept per stock in the ledger

  // --- Grounding (anti-hallucination) ------------------------------------
  // Injected into every agent. Keeps the AI tied to verifiable facts.
  GROUNDING:
    "GROUNDING RULES: Base every claim on facts you actually find via web search or that " +
    "are explicitly provided. Never invent tickers, prices, financials, dates, filings, or " +
    "quotes. If you cannot verify something, say so and treat it as unknown — do NOT assume " +
    "the best case. Prefer primary sources (SEC filings, company IR) and reputable outlets.",

  // --- Persistent ledger (no repeats across runs + interaction history) --
  // Every evaluated stock is recorded here so future runs never re-propose the
  // same ticker blindly. The full interaction (critic verdicts, debate, news,
  // simulation) is stored so a researcher can re-argue a previously-denied stock.
  LEDGER_FILE: "stock_ledger.json", // machine-readable source of truth
  LEDGER_TEXT: "stock_ledger.txt", // human-readable record (opens in Notepad)
  // Researchers may RE-OPEN previously-denied stocks and argue them again,
  // informed by the recorded prior denials. Bounded so it can't loop forever.
  ENABLE_REVISIT: true,
  MAX_REVISITS_PER_STOCK: 2, // how many times one denied stock may be re-argued
  REVISITS_PER_ROUND: 1, // how many denied stocks to re-open per search round

  // --- Market-cap guardrail (for prompting only; not a hard filter) ------
  MARKET_CAP_HINT: "roughly $300 million to $20 billion market cap",
  // HARD market-cap gate, enforced with real data when available (Finnhub key
  // recommended). Candidates outside the range are auto-rejected before the
  // panel. Skipped with a note if no cap figure is available.
  ENFORCE_MARKET_CAP: true,
  MARKET_CAP_MIN: 300e6,
  MARKET_CAP_MAX: 20e9,

  // --- Output ------------------------------------------------------------
  // "text"  -> writes a plain .txt transcript of ALL stocks (opens in Notepad)
  // "gdoc"  -> also writes a Google Doc (still writes the .txt too)
  DEFAULT_OUTPUT: "text",
  GOOGLE_DOC_TITLE: "Nine Critics — Stock Research Report (All Evaluated Stocks)",
  GOOGLE_CREDENTIALS_FILE: "credentials.json", // OAuth client secrets (for gdoc)
  GOOGLE_TOKEN_FILE: "token.json", // cached OAuth token

  // --- Commercial market data --------------------------------------------
  // Keyless Yahoo endpoints are convenient for local dev but are NOT licensed
  // for commercial use. In production set MARKET_DATA_PROVIDER=finnhub (paid)
  // so quotes come from a licensed feed; EDGAR stays free.
  MARKET_DATA_PROVIDER: process.env.MARKET_DATA_PROVIDER || "yahoo", // "yahoo" | "finnhub"

  // --- Hard per-job spend ceiling (USD) ----------------------------------
  // Enforced from costTracker after every model call. When estimated spend for
  // the current job crosses this, the next call throws CostCeilingError and the
  // job aborts politely (the worker refunds the run credit).
  COST_CEILING_USD: Number(process.env.JOB_COST_CEILING_USD || 15),

  // --- Misc --------------------------------------------------------------
  VERBOSE: true, // print the debate to the console as it happens
};

// ---------------------------------------------------------------------------
// Commercial config profiles (BUILD BRIEF). Applied per job by the worker via
// applyProfile(config, name). Values not listed here keep their defaults above.
// ---------------------------------------------------------------------------
export const PROFILES = {
  // Paid one-time research runs. Tuned for a hard COGS cap per sale.
  commercial_run: {
    MAX_SEARCH_ROUNDS: 5, // hard COGS cap per sale
    STOCKS_PER_FIELD: 3,
    RESEARCH_MODEL: "claude-opus-4-8",
    RESEARCH_EFFORT: "high",
    MODEL: "claude-sonnet-4-6", // critics, simulators, news, portfolio
    EFFORT: "medium",
    REQUIRED_APPROVALS: 8, // 8 of 9
    SIMULATION_GATE_THRESHOLD: 55,
    ENFORCE_MARKET_CAP: true, // hard $300M-$20B gate ON
    MARKET_CAP_MIN: 300e6,
    MARKET_CAP_MAX: 20e9,
    ENABLE_PROMPT_CACHE: true,
    ENABLE_COST_TRACKER: true,
  },

  // Daily monitor subscriptions. (Phase 2 surface; profile defined now.)
  commercial_monitor: {
    // Sell analyst model/searches are set per position tier by the monitor.
    MODEL: "claude-haiku-4-5-20251001",
    EFFORT: "low",
    MONITOR_SKIP_UNCHANGED_PCT: 3,
    MONITOR_STOP_MODE: "trailing",
    MONITOR_EARNINGS_WARN_DAYS: 7,
    ENABLE_PROMPT_CACHE: true,
    ENABLE_COST_TRACKER: true,
  },
};

// Position caps + per-tier monitor analysis, keyed by subscription tier.
export const MONITOR_TIERS = {
  base: { positionCap: 5, sellModel: "claude-haiku-4-5-20251001", maxSearches: 2 },
  plus: { positionCap: 15, sellModel: "claude-haiku-4-5-20251001", maxSearches: 2 },
  pro: { positionCap: 40, sellModel: "claude-sonnet-4-6", maxSearches: 3 },
};

// Mutate the shared config in place with a named profile. Returns config.
export function applyProfile(name, overrides = {}) {
  const profile = PROFILES[name];
  if (!profile) throw new Error(`Unknown PROFILE '${name}'.`);
  Object.assign(config, profile, overrides);
  return config;
}
