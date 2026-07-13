// Unit tests for the agent-core seam (no DB/Redis needed).
// Mirrors the repo's mock-client testing approach: exercise the workflow wiring
// with MOCK_WORKFLOW so no real API calls are made.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.MOCK_WORKFLOW = "1";
const { normalizeScope, runResearchJob } = await import("../agent-core/jobRunner.js");

// A pool stub — in MOCK mode the ledger DB path is not exercised.
const fakePool = { query: async () => ({ rows: [] }) };

test("normalizeScope enforces exactly one scope", () => {
  assert.deepEqual(normalizeScope({ field: "technology" }), { field: "technology", ticker: null });
  assert.deepEqual(normalizeScope({ ticker: "nvda" }), { field: null, ticker: "NVDA" });
  assert.throws(() => normalizeScope({ field: "technology", ticker: "NVDA" }), /single field OR/i);
  assert.throws(() => normalizeScope({}), /field or a ticker/i);
  assert.throws(() => normalizeScope({ field: "nope" }), /Unknown field/i);
  assert.throws(() => normalizeScope({ ticker: "TOOLONGX" }), /Invalid ticker/i);
});

test("mock research run streams events and produces a report", async () => {
  const events = [];
  const res = await runResearchJob({
    pool: fakePool,
    userId: "test-user",
    scope: { field: "technology" },
    onEvent: (e) => events.push(e),
  });

  // Streamed the debate: verdict events + a terminal done event.
  const verdicts = events.filter((e) => e.type === "verdict");
  assert.ok(verdicts.length >= 5, "expected several critic verdict events");
  assert.ok(events.some((e) => e.type === "done"), "expected a done event");

  // Delivered a report with the mandatory disclaimer and the evaluated ticker.
  assert.match(res.reportText, /DISCLAIMER/);
  assert.match(res.reportText, /NVEE/);
  assert.equal(res.approvedCount, 1);
  assert.ok(Array.isArray(res.usage.rows));
});

test("mock ticker deep-dive echoes the requested ticker", async () => {
  const res = await runResearchJob({
    pool: fakePool,
    userId: "test-user",
    scope: { ticker: "PLTR" },
    onEvent: () => {},
  });
  assert.match(res.reportText, /PLTR/);
});
