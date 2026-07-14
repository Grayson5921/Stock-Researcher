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
  assert.deepEqual(normalizeScope({ field: "technology" }), { field: "technology", ticker: null, custom: null });
  assert.deepEqual(normalizeScope({ ticker: "nvda" }), { field: null, ticker: "NVDA", custom: null });
  assert.deepEqual(normalizeScope({ custom: "  healthcare  AI companies " }), {
    field: null, ticker: null, custom: "healthcare AI companies",
  });
  assert.throws(() => normalizeScope({ field: "technology", ticker: "NVDA" }), /exactly one/i);
  assert.throws(() => normalizeScope({}), /exactly one/i);
  assert.throws(() => normalizeScope({ field: "nope" }), /Unknown field/i);
  assert.throws(() => normalizeScope({ ticker: "TOOLONGX" }), /Invalid ticker/i);
  assert.throws(() => normalizeScope({ custom: "short" }), /8-120/i);
  assert.throws(() => normalizeScope({ custom: "x".repeat(200) }), /8-120/i);
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

test("custom focus runs and structured report data is produced", async () => {
  const res = await runResearchJob({
    pool: fakePool,
    userId: "test-user",
    scope: { custom: "healthcare AI companies" },
    onEvent: () => {},
  });
  assert.ok(res.reportData, "expected structured reportData");
  assert.equal(res.reportData.approvedCount, 1);
  assert.equal(res.reportData.evaluatedCount, res.reportData.stocks.length);
  const s = res.reportData.stocks[0];
  assert.equal(s.status, "APPROVED");
  assert.ok(Array.isArray(s.verdicts) && s.verdicts.length >= 5, "verdicts serialized");
  assert.ok(s.simulation && typeof s.simulation.netUpside === "number", "simulation serialized");
  assert.match(res.reportData.fields[0], /healthcare ai companies/);
});
