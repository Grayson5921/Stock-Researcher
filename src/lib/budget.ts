// Spend guardrails enforced before a run is enqueued.
import { one } from "./db";
import { env } from "./env";

// Total estimated API spend across all users so far today (from usage_ledger).
export async function globalSpendTodayUsd(): Promise<number> {
  const row = await one<{ sum: string }>(
    `SELECT COALESCE(SUM(cost_usd), 0)::text AS sum
       FROM usage_ledger
      WHERE created_at >= date_trunc('day', now())`
  );
  return row ? Number(row.sum) : 0;
}

// Global daily budget kill-switch: refuse new jobs once today's spend crosses it.
export async function assertGlobalBudgetOk(): Promise<void> {
  const spent = await globalSpendTodayUsd();
  if (spent >= env.GLOBAL_DAILY_BUDGET_USD) {
    throw new BudgetExceeded(
      `Daily API budget reached ($${spent.toFixed(2)} / $${env.GLOBAL_DAILY_BUDGET_USD}). Try again tomorrow.`
    );
  }
}

// One concurrent run per user: reject if they already have a live run job.
export async function assertNoActiveRun(userId: string): Promise<void> {
  const row = await one<{ id: string }>(
    `SELECT id FROM jobs
      WHERE user_id = $1 AND kind = 'run' AND status IN ('queued','running')
      LIMIT 1`,
    [userId]
  );
  if (row) throw new ActiveRunExists("You already have a research run in progress.");
}

export class BudgetExceeded extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "BudgetExceeded";
  }
}
export class ActiveRunExists extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ActiveRunExists";
  }
}
