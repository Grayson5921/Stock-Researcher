// Unit tests for per-job cost accounting + the hard spend ceiling (no services).
import { test } from "node:test";
import assert from "node:assert/strict";
import { costTracker, CostCeilingError } from "../agent-core/costTracker.js";
import { config } from "../agent-core/config.js";
import { BaseAgent } from "../agent-core/agents/baseAgent.js";

function fakeClient(usage) {
  return {
    messages: {
      create: async () => ({ content: [{ type: "text", text: "ok" }], usage }),
    },
  };
}

test("snapshot attributes token cost per model", () => {
  costTracker.reset();
  costTracker.record("claude-sonnet-4-6", { input_tokens: 1_000_000, output_tokens: 1_000_000 });
  const snap = costTracker.snapshot();
  // Sonnet is $3/MTok in + $15/MTok out => $18 for 1M/1M.
  assert.equal(snap.rows.length, 1);
  assert.equal(snap.rows[0].model, "claude-sonnet-4-6");
  assert.ok(Math.abs(snap.totalUsd - 18) < 0.001, `expected ~18, got ${snap.totalUsd}`);
});

test("cost ceiling aborts the run with CostCeilingError", async () => {
  config.ENABLE_COST_TRACKER = true;
  const prevCeiling = config.COST_CEILING_USD;
  config.COST_CEILING_USD = 0.01; // trip immediately
  costTracker.reset();

  const agent = new BaseAgent(
    fakeClient({ input_tokens: 1_000_000, output_tokens: 1_000_000 }),
    "claude-opus-4-8",
    "test"
  );
  await assert.rejects(() => agent.callText("system", "user"), CostCeilingError);

  config.COST_CEILING_USD = prevCeiling;
});

test("no ceiling error when spend is under the cap", async () => {
  config.ENABLE_COST_TRACKER = true;
  const prevCeiling = config.COST_CEILING_USD;
  config.COST_CEILING_USD = 1000;
  costTracker.reset();

  const agent = new BaseAgent(fakeClient({ input_tokens: 10, output_tokens: 10 }), "claude-sonnet-4-6", "test");
  const text = await agent.callText("system", "user");
  assert.equal(text, "ok");

  config.COST_CEILING_USD = prevCeiling;
});
