#!/usr/bin/env node
// Multi-agent low/mid-cap stock research workflow.
//
// 3 research agents (technology, business, energy) propose stocks backed by news,
// 5 critic agents review each against their own 10 criteria, the researchers rebut
// or concede, and approved stocks are written to a Google Doc (or Markdown).
//
// Usage:
//   set ANTHROPIC_API_KEY in a .env file (or the environment), then:
//   node main.js                      # markdown output (works out of the box)
//   node main.js --output gdoc        # Google Doc (needs credentials.json)
//   node main.js --fields technology energy
//   node main.js --model claude-sonnet-4-6 --effort medium
//   node main.js --required-approvals 5 --stocks-per-field 3
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import { ResearchAgent } from "./agents/researchAgent.js";
import { CriticAgent } from "./agents/criticAgent.js";
import { SimulatorAgent } from "./agents/simulatorAgent.js";
import { NewsAgent } from "./agents/newsAgent.js";
import { PortfolioAgent } from "./agents/portfolioAgent.js";
import { CRITICS } from "./criteria/criticCriteria.js";
import { Workflow } from "./orchestrator/workflow.js";
import { save } from "./output/output.js";
import { loadLedger, seenTickers, saveLedger } from "./ledger.js";
import { reviewOutcomes } from "./outcomeReview.js";
import { runMonitor } from "./monitor.js";
import { costTracker } from "./costTracker.js";

// --- tiny CLI parser (no external deps) ------------------------------------
function parseArgs(argv) {
  const out = {
    output: config.DEFAULT_OUTPUT,
    fields: Object.keys(config.FIELDS),
    model: config.MODEL,
    effort: config.EFFORT,
    stocksPerField: config.STOCKS_PER_FIELD,
    requiredApprovals: config.REQUIRED_APPROVALS,
    quiet: false,
    review: false,
    monitor: false,
    bought: null, // [ticker, price, shares]
    sold: null,   // [ticker, price?]
    tickers: [], // user-supplied stocks to evaluate through the full gauntlet
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--output": out.output = next(); break;
      case "--model": out.model = next(); break;
      case "--effort": out.effort = next(); break;
      case "--research-model": out.researchModel = next(); break;
      case "--research-effort": out.researchEffort = next(); break;
      case "--stocks-per-field": out.stocksPerField = parseInt(next(), 10); break;
      case "--required-approvals": out.requiredApprovals = parseInt(next(), 10); break;
      case "--quiet": out.quiet = true; break;
      case "--review": out.review = true; break;
      case "--monitor": out.monitor = true; break;
      case "--bought": { // --bought XYZ 47.20 10
        out.bought = [next()?.toUpperCase(), parseFloat(next()), parseFloat(next()) || 1];
        break;
      }
      case "--sold": { // --sold XYZ [55.10]
        const t = next()?.toUpperCase();
        const maybe = argv[i + 1] && !argv[i + 1].startsWith("--") ? parseFloat(argv[++i]) : null;
        out.sold = [t, maybe];
        break;
      }
      case "--ticker":
      case "--stock": {
        // --ticker NVDA  (can repeat, or list several: --ticker NVDA PLTR)
        while (i + 1 < argv.length && !argv[i + 1].startsWith("--"))
          out.tickers.push(argv[++i].toUpperCase());
        break;
      }
      case "--fields": {
        const fields = [];
        while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) fields.push(argv[++i]);
        if (fields.length) out.fields = fields;
        break;
      }
      default: {
        // Shorthand: any unknown flag that looks like a ticker (--NVDA, --pltr)
        // is treated as a user-supplied stock to evaluate.
        const m = a.match(/^--([A-Za-z]{1,5}(?:\.[A-Za-z])?)$/);
        if (m) {
          out.tickers.push(m[1].toUpperCase());
          break;
        }
        console.error(`Unknown argument: ${a}`);
        process.exit(1);
      }
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ERROR: set ANTHROPIC_API_KEY (env var or .env file).");
    process.exit(1);
  }

  // apply CLI overrides to config
  config.MODEL = args.model;
  config.EFFORT = args.effort;
  if (args.researchModel) config.RESEARCH_MODEL = args.researchModel;
  if (args.researchEffort) config.RESEARCH_EFFORT = args.researchEffort;
  config.STOCKS_PER_FIELD = args.stocksPerField;
  config.REQUIRED_APPROVALS = args.requiredApprovals;
  config.VERBOSE = !args.quiet;

  if (args.review) {
    await reviewOutcomes();
    return;
  }

  if (args.bought || args.sold) {
    const ledger = loadLedger();
    if (args.bought) {
      const [t, price, shares] = args.bought;
      if (!t || !Number.isFinite(price)) return console.error("Usage: --bought TICKER PRICE [SHARES]");
      const e = (ledger.stocks[t] ||= { ticker: t, company: t, field: "user", status: "APPROVED", firstSeen: new Date().toISOString() });
      e.position = { owned: true, costBasis: price, shares, boughtAt: new Date().toISOString() };
      delete e.soldRecord;
      saveLedger(ledger);
      console.log(`Recorded: BOUGHT ${shares} ${t} @ ${price}. The monitor now tracks your actual position.`);
    }
    if (args.sold) {
      const [t, price] = args.sold;
      const e = ledger.stocks[t];
      if (!e) return console.error(`${t} is not in the ledger.`);
      const basis = e.position?.costBasis ?? e.entryPrice ?? null;
      const ret = price != null && basis ? (((price - basis) / basis) * 100).toFixed(1) + "%" : "n/a";
      e.soldRecord = { price: price ?? null, at: new Date().toISOString(), returnPct: ret };
      if (e.position) e.position.owned = false;
      saveLedger(ledger);
      console.log(`Recorded: SOLD ${t}${price != null ? " @ " + price : ""} (return ${ret}). Removed from monitoring.`);
    }
    return;
  }

  const client = new Anthropic({ apiKey });

  if (args.monitor) {
    // Daily sell monitor over APPROVED holdings (optionally filtered by tickers).
    await runMonitor(client, args.tickers);
    if (config.ENABLE_COST_TRACKER) console.log(costTracker.report());
    return;
  }

  const researchAgents = [];
  for (const fkey of args.fields) {
    if (!(fkey in config.FIELDS)) {
      console.error(`Unknown field '${fkey}'. Known: ${Object.keys(config.FIELDS).join(", ")}`);
      process.exit(1);
    }
    researchAgents.push(new ResearchAgent(client, config.RESEARCH_MODEL, fkey, config.FIELDS[fkey], config.RESEARCH_EFFORT));
  }

  const critics = Object.keys(CRITICS).map((name) => new CriticAgent(client, config.MODEL, name));

  const simulators = config.ENABLE_SIMULATORS
    ? {
        bull: new SimulatorAgent(client, config.MODEL, "bull"),
        bear: new SimulatorAgent(client, config.MODEL, "bear"),
      }
    : null;
  const newsAgent = config.ENABLE_NEWS_AGENT ? new NewsAgent(client, config.MODEL) : null;
  const portfolioAgent = config.ENABLE_PORTFOLIO_FIT ? new PortfolioAgent(client, config.MODEL) : null;

  const required = config.REQUIRED_APPROVALS == null ? critics.length : config.REQUIRED_APPROVALS;
  console.log(`Research model: ${config.RESEARCH_MODEL}  (effort: ${config.RESEARCH_EFFORT})`);
  console.log(`Panel model (critics/sim/news/portfolio): ${config.MODEL}  (effort: ${config.EFFORT})`);
  console.log(`Fields: ${args.fields.join(", ")}`);
  console.log(`Critics (${critics.length}): ${critics.map((c) => c.name).join(", ")}`);
  console.log(`Approval threshold: ${required}/${critics.length}` +
    (config.REQUIRED_APPROVALS == null ? " (unanimous)" : ""));
  if (simulators) {
    const gate = config.SIMULATION_GATE_THRESHOLD;
    console.log(
      `Simulators: Bull + Bear — ${config.SIMULATION_HORIZON} forecast with return magnitude` +
        (gate == null ? "; approved stocks ranked by confidence." : `; must reach ${gate}% upside confidence.`)
    );
  }
  if (newsAgent) console.log("News & sentiment agent: on (grounds the simulators in recent reporting).");
  if (portfolioAgent) console.log("Portfolio-fit agent: on (checks overlap with your holdings).");
  console.log("");

  const ledger = loadLedger();
  const knownCount = seenTickers(ledger).length;
  if (knownCount) console.log(`Ledger: ${knownCount} previously-evaluated stock(s) loaded (will not be re-proposed).`);

  const workflow = new Workflow(researchAgents, critics, simulators, newsAgent, portfolioAgent, ledger);

  let results;
  if (args.tickers.length > 0) {
    // Ticker mode: evaluate the user's specific stock(s) through the full
    // gauntlet instead of researching new candidates.
    console.log(`Ticker mode: evaluating ${args.tickers.join(", ")} through the full gauntlet.\n`);
    const userAgent = new ResearchAgent(
      client, config.RESEARCH_MODEL, "user-request",
      "the specific company/companies the user asked to evaluate (any sector)",
      config.RESEARCH_EFFORT
    );
    const reviews = await workflow.runTickers(args.tickers, userAgent);
    results = { "user-request": reviews };
  } else {
    results = await workflow.run();
  }

  const location = await save(results, args.output);
  console.log("\n" + "=".repeat(70));
  console.log("WORKFLOW COMPLETE");
  console.log(location);
  console.log("=".repeat(70));
  if (config.ENABLE_COST_TRACKER) console.log(costTracker.report());
}

main().catch((e) => {
  console.error("\nFATAL:", e.message || e);
  process.exit(1);
});
