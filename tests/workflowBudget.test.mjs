// A paid run must never end empty-handed: when the cost ceiling trips mid-run,
// the workflow delivers everything evaluated so far instead of throwing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Workflow } from "../agent-core/orchestrator/workflow.js";
import { costTracker, CostCeilingError } from "../agent-core/costTracker.js";
import { config } from "../agent-core/config.js";

function fakeStock(ticker) {
  return { ticker, company: `${ticker} Corp`, thesis: "", catalysts: [], articles: [], proposedBy: "test" };
}

test("workflow delivers partial results when the ceiling trips mid-run", async () => {
  const saved = { ...config };
  Object.assign(config, {
    ENABLE_MARKET_DATA: false,
    ENABLE_SEC_DATA: false,
    ENABLE_PRESCREEN: false,
    ENABLE_VERIFIER: false,
    ENABLE_NEWS_AGENT: false,
    ENABLE_SIMULATORS: false,
    ENABLE_PORTFOLIO_FIT: false,
    ENABLE_REVISIT: false,
    ENABLE_COST_TRACKER: true,
    COST_CEILING_USD: 15,
    VERBOSE: false,
    STOCKS_PER_FIELD: 2,
    MAX_SEARCH_ROUNDS: 5,
    MAX_EMPTY_ROUNDS: 2,
    TARGET_APPROVED_PER_FIELD: 1,
    REQUIRED_APPROVALS: 1,
    MAX_DEBATE_ROUNDS: 0,
  });
  costTracker.reset();

  const agent = {
    client: {},
    fieldKey: "technology",
    name: "TestResearcher",
    findStocks: async () => [fakeStock("AAA"), fakeStock("BBB")],
    respondToVerdicts: async () => [],
  };
  let calls = 0;
  const critic = {
    name: "TestCritic",
    review: async () => {
      calls += 1;
      if (calls === 2) throw new CostCeilingError(15, 15); // trips on the SECOND stock
      return { criticName: "TestCritic", approved: false, passed: [], failed: [], reasoning: "no", round: 1 };
    },
  };

  const ledger = { stocks: {}, runs: [] };
  const wf = new Workflow([agent], [critic], null, null, null, ledger);
  const reviews = await wf.runField(agent); // must NOT throw
  assert.equal(reviews.length, 1, "first candidate's full evaluation is preserved");
  assert.equal(reviews[0].stock.ticker, "AAA");

  Object.assign(config, saved);
});

test("soft budget stop prevents starting new work near the ceiling", async () => {
  const saved = { ...config };
  Object.assign(config, {
    ENABLE_COST_TRACKER: true,
    COST_CEILING_USD: 15,
    VERBOSE: false,
    MAX_SEARCH_ROUNDS: 5,
    TARGET_APPROVED_PER_FIELD: 1,
    ENABLE_REVISIT: false,
    ENABLE_PRESCREEN: false,
    ENABLE_VERIFIER: false,
  });
  // Simulate a run that has already spent ~$13.5 (within the $2.50 soft margin).
  costTracker.reset();
  costTracker.record("claude-sonnet-4-6", { input_tokens: 1_500_000, output_tokens: 600_000 }); // = $4.5 + $9 = $13.5

  let searched = false;
  const agent = {
    client: {},
    fieldKey: "technology",
    name: "TestResearcher",
    findStocks: async () => {
      searched = true;
      return [];
    },
  };
  const wf = new Workflow([agent], [{ name: "C", review: async () => ({}) }], null, null, null, { stocks: {}, runs: [] });
  const reviews = await wf.runField(agent);
  assert.equal(searched, false, "no new research round starts once budget is nearly spent");
  assert.equal(reviews.length, 0);

  costTracker.reset();
  Object.assign(config, saved);
});
