// The single entry point the web worker calls to execute a Research Run job.
// It wires the ported agent modules together for ONE scope (one field OR one
// ticker), streams progress via the sink, persists the ledger to Postgres, and
// returns the final report text plus a per-job usage snapshot for accounting.
//
// This is the boundary between the (unchanged) agent logic and the web product:
// the worker owns DB/queue/billing; this module owns "run the gauntlet once".
import Anthropic from "@anthropic-ai/sdk";
import { config, applyProfile } from "./config.js";
import { costTracker } from "./costTracker.js";
import { ResearchAgent } from "./agents/researchAgent.js";
import { CriticAgent } from "./agents/criticAgent.js";
import { SimulatorAgent } from "./agents/simulatorAgent.js";
import { NewsAgent } from "./agents/newsAgent.js";
import { PortfolioAgent } from "./agents/portfolioAgent.js";
import { CRITICS } from "./criteria/criticCriteria.js";
import { Workflow } from "./orchestrator/workflow.js";
import { buildReport } from "./output/output.js";
import {
  setLedgerContext,
  clearLedgerContext,
  preloadLedger,
  loadLedger,
  seenTickers,
  flushLedger,
} from "./ledger.js";
import { setProgressSink, clearProgressSink, emit } from "./progress.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Enforce exactly one scope: { field } OR { ticker }. Returns a normalized scope.
export function normalizeScope(scope) {
  const field = scope?.field ? String(scope.field).toLowerCase() : null;
  const ticker = scope?.ticker ? String(scope.ticker).toUpperCase() : null;
  if (field && ticker) throw new Error("Scope must be a single field OR a single ticker, not both.");
  if (!field && !ticker) throw new Error("Scope must specify a field or a ticker.");
  if (field && !(field in config.FIELDS)) {
    throw new Error(`Unknown field '${field}'. Known: ${Object.keys(config.FIELDS).join(", ")}`);
  }
  if (ticker && !/^[A-Z]{1,5}(\.[A-Z])?$/.test(ticker)) {
    throw new Error(`Invalid ticker '${ticker}'.`);
  }
  return { field, ticker };
}

/**
 * Run one research job.
 * @param {object} opts
 * @param {import('pg').Pool} opts.pool     Postgres pool (for the per-user ledger)
 * @param {string} opts.userId              owning user id
 * @param {object} opts.scope               { field } | { ticker }
 * @param {string} [opts.profile]           config profile name (default commercial_run)
 * @param {(evt:object)=>void} opts.onEvent progress-event sink
 * @param {string} [opts.apiKey]            Anthropic key (defaults to env)
 * @returns {Promise<{reportText:string, usage:{rows:Array<object>, totalUsd:number, calls:number, searches:number}, approvedCount:number}>}
 */
export async function runResearchJob({ pool, userId, scope, profile = "commercial_run", onEvent, apiKey }) {
  const { field, ticker } = normalizeScope(scope);

  // 1) Apply the commercial profile and reset per-job accounting.
  applyProfile(profile);
  config.VERBOSE = false; // web path streams via the sink, not the console
  costTracker.reset();

  // 2) Wire progress + ledger context to this job/user.
  setProgressSink(onEvent);
  setLedgerContext(pool, userId);

  try {
    if (process.env.MOCK_WORKFLOW === "1") {
      return await runMock({ field, ticker });
    }

    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not configured on the server.");
    const client = new Anthropic({ apiKey: key });

    await preloadLedger();
    const ledger = loadLedger();
    const known = seenTickers(ledger).length;
    emit("phase", `Starting research run${known ? ` (${known} tickers already in your ledger)` : ""}.`);

    const critics = Object.keys(CRITICS).map((name) => new CriticAgent(client, config.MODEL, name));
    const simulators = config.ENABLE_SIMULATORS
      ? { bull: new SimulatorAgent(client, config.MODEL, "bull"), bear: new SimulatorAgent(client, config.MODEL, "bear") }
      : null;
    const newsAgent = config.ENABLE_NEWS_AGENT ? new NewsAgent(client, config.MODEL) : null;
    const portfolioAgent = config.ENABLE_PORTFOLIO_FIT ? new PortfolioAgent(client, config.MODEL) : null;

    let results;
    if (ticker) {
      emit("phase", `Evaluating ${ticker} through the full gauntlet.`);
      const agent = new ResearchAgent(
        client,
        config.RESEARCH_MODEL,
        "user-request",
        "the specific company the user asked to evaluate (any sector)",
        config.RESEARCH_EFFORT
      );
      const workflow = new Workflow([agent], critics, simulators, newsAgent, portfolioAgent, ledger);
      const reviews = await workflow.runTickers([ticker], agent);
      results = { "user-request": reviews };
    } else {
      emit("phase", `Scanning the ${field} sector for viable low/mid-cap stocks.`);
      const agent = new ResearchAgent(client, config.RESEARCH_MODEL, field, config.FIELDS[field], config.RESEARCH_EFFORT);
      const workflow = new Workflow([agent], critics, simulators, newsAgent, portfolioAgent, ledger);
      const reviews = await workflow.runField(agent);
      results = { [field]: reviews };
    }

    await flushLedger();

    const reportText = buildReport(results);
    const approvedCount = Object.values(results)
      .flat()
      .filter((r) => r.finalStatus === "APPROVED").length;
    emit("done", `Run complete: ${approvedCount} viable stock(s).`, { approvedCount });
    return { reportText, usage: costTracker.snapshot(), approvedCount };
  } finally {
    clearProgressSink();
    clearLedgerContext();
  }
}

// ---------------------------------------------------------------------------
// Mock mode: a canned but realistic stream + report, no API spend. Lets the full
// sign-up -> pay -> run -> report path be demoed/tested with MOCK_WORKFLOW=1.
// ---------------------------------------------------------------------------
async function runMock({ field, ticker }) {
  const t = ticker || "NVEE";
  const label = ticker ? `ticker ${t}` : `the ${field} sector`;
  emit("phase", `[MOCK] Starting research run on ${label}.`);
  await sleep(150);
  emit("log", `[MOCK] Researcher proposing candidates for ${label}...`);
  await sleep(150);
  emit("stock", `[MOCK] Evaluating ${t}`, { ticker: t });

  const critics = Object.keys(CRITICS);
  for (const c of critics) {
    const approved = c !== "The Valuation Disciplinarian"; // one dissenter
    emit("verdict", `${c}: ${approved ? "APPROVE" : "DENY"}`, {
      ticker: t,
      critic: c,
      approved,
      reasoning: approved ? "Meets the bar on the mock criteria." : "Valuation looks stretched (mock dissent).",
      round: 1,
    });
    await sleep(60);
  }
  emit("debate", "[MOCK] Researcher rebuts The Valuation Disciplinarian.", {
    ticker: t,
    actor: "researcher",
    action: "rebut",
    critic: "The Valuation Disciplinarian",
    argument: "Forward multiple is below peers once the new backlog converts; valuation concern is priced in (mock rebuttal).",
  });
  await sleep(80);
  emit("verdict", "The Valuation Disciplinarian: DENY", {
    ticker: t,
    critic: "The Valuation Disciplinarian",
    approved: false,
    reasoning: "Rebuttal noted, but margin of safety still thin at this price (mock hold).",
    round: 2,
  });
  await sleep(80);
  emit("news", "[MOCK] News sentiment: +0.4 (positive).", { label: "positive", score: 0.4, summary: "Mostly favorable mock coverage." });
  await sleep(120);
  emit("sim", "[MOCK] Net upside confidence 63% | expected +18% | R/R 2.1:1.", { netUpside: 63, expectedReturn: 18, riskReward: 2.1, passed: true });
  await sleep(120);
  emit("stock-result", `${t}: APPROVED`, { ticker: t, status: "APPROVED", reason: "" });
  await sleep(80);

  const results = mockResults(field, ticker, t);
  const reportText = buildReport(results);
  emit("done", "[MOCK] Run complete: 1 viable stock.", { approvedCount: 1 });
  return { reportText, usage: costTracker.snapshot(), approvedCount: 1 };
}

function mockResults(field, ticker, t) {
  const fieldKey = ticker ? "user-request" : field;
  const verdicts = Object.keys(CRITICS).map((critic) => ({
    criticName: critic,
    approved: critic !== "The Valuation Disciplinarian",
    passed: [],
    failed: [],
    reasoning:
      critic !== "The Valuation Disciplinarian"
        ? "Meets the bar on the mock criteria."
        : "Valuation looks stretched (mock dissent).",
    round: 1,
  }));
  const bull = { probabilityIncrease: 70, expectedReturnPct: 26, downsideReturnPct: -8, reasoning: "Mock bull case.", keyEvents: ["New contract wins", "Margin expansion"] };
  const bear = { probabilityIncrease: 56, expectedReturnPct: 10, downsideReturnPct: -12, reasoning: "Mock bear case.", keyEvents: ["Macro softness"] };
  const review = {
    stock: {
      ticker: t,
      company: `${t} Holdings (mock)`,
      field: fieldKey,
      thesis: "Illustrative mock thesis: durable niche leader at a reasonable multiple.",
      catalysts: ["Backlog growth", "Accretive tuck-in M&A"],
      articles: [{ title: "Mock source", url: "https://example.com/mock" }],
      proposedBy: "mock-researcher",
    },
    verdicts,
    debateLog: [{ criticName: "The Valuation Disciplinarian", action: "rebut", argument: "Mock rebuttal on valuation." }],
    news: { sentimentScore: 0.4, label: "positive", summary: "Mostly favorable mock coverage.", correlation: "mild positive", articles: [] },
    simulation: { bull, bear, netUpside: 63, expectedReturn: 18, upside: 26, downside: 12, riskReward: 2.1, passed: true },
    portfolio: { fitScore: 78, verdict: "adds diversification", reasoning: "Low overlap with mock holdings." },
    rejectReason: "",
    finalStatus: "APPROVED",
    approvals: verdicts.filter((v) => v.approved).length,
  };
  return { [fieldKey]: [review] };
}
