// Service layer for creating a research run: consumes a credit + creates the job
// row atomically, then enqueues it. Keeps route handlers thin.
import { pool } from "./db";
import { consumeCreditTx, refundCredit } from "./credits";
import { getRunsQueue } from "./queue";
import { assertGlobalBudgetOk, assertNoActiveRun } from "./budget";
import type { Scope } from "./validation";

export class NoCredit extends Error {
  constructor() {
    super("No available research-run credit. Purchase one to continue.");
    this.name = "NoCredit";
  }
}

export interface CreatedRun {
  jobId: string;
}

// Guardrails → atomic (create job + consume credit) → enqueue. On any failure
// after the credit is consumed, the credit is refunded so the user isn't charged
// for a run that never started.
export async function createRun(userId: string, scope: Scope, profile = "commercial_run"): Promise<CreatedRun> {
  await assertGlobalBudgetOk();
  await assertNoActiveRun(userId);

  const client = await pool.connect();
  let jobId: string;
  let purchaseId: string;
  try {
    await client.query("BEGIN");
    const jobRes = await client.query(
      `INSERT INTO jobs(user_id, kind, status, profile, scope)
       VALUES ($1, 'run', 'queued', $2, $3)
       RETURNING id`,
      [userId, profile, JSON.stringify(scope)]
    );
    jobId = jobRes.rows[0].id;

    const consumed = await consumeCreditTx(client, userId, jobId);
    if (!consumed) {
      await client.query("ROLLBACK");
      throw new NoCredit();
    }
    purchaseId = consumed;
    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }

  // Enqueue after commit. If the queue is unreachable, refund + mark failed.
  try {
    await getRunsQueue().add(
      "run",
      { jobId, userId, scope, profile, purchaseId },
      { jobId } // dedupe by our job id
    );
  } catch (e) {
    await refundCredit(purchaseId);
    await pool.query(
      "UPDATE jobs SET status='failed', error=$2, finished_at=now() WHERE id=$1",
      [jobId, "Failed to enqueue: " + (e as Error).message]
    );
    throw e;
  }

  return { jobId };
}
