// BullMQ worker that executes research-run jobs by calling the ported agent core
// directly (agent-core/jobRunner.js). Concurrency is 1 so the agent core's
// module-level singletons (config, costTracker, ledger context) are safely
// scoped to exactly one job at a time.
import "dotenv/config";
import { Worker, Job, type ConnectionOptions } from "bullmq";
import { getRedis } from "../src/lib/redis";
import { RUNS_QUEUE, type RunJobData } from "../src/lib/queue";
import { pool } from "../src/lib/db";
import { refundCredit } from "../src/lib/credits";
// Ported agent core (ESM JavaScript). The .js extension is required for ESM.
import { runResearchJob } from "../agent-core/jobRunner.js";

const MAX_EVENTS = 5000; // safety cap on stored events per job

async function appendEvent(jobId: string, evt: unknown) {
  await pool.query(
    `UPDATE jobs
        SET progress_events =
              CASE WHEN jsonb_array_length(progress_events) >= $3
                   THEN progress_events
                   ELSE progress_events || $2::jsonb END
      WHERE id = $1`,
    [jobId, JSON.stringify(evt), MAX_EVENTS]
  );
}

async function persistUsage(userId: string, jobId: string, usage: any) {
  const rows = usage?.rows ?? [];
  for (const r of rows) {
    await pool.query(
      `INSERT INTO usage_ledger(user_id, job_id, model, in_tokens, out_tokens, cached_tokens, searches, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, jobId, r.model, r.in_tokens, r.out_tokens, r.cached_tokens, r.searches, r.cost_usd]
    );
  }
}

async function processRun(job: Job<RunJobData>) {
  const { jobId, userId, scope, profile, purchaseId } = job.data;

  // Fresh start for this attempt.
  await pool.query(
    `UPDATE jobs SET status='running', started_at=now(), progress_events='[]'::jsonb, cost_usd=0, error=NULL
      WHERE id=$1`,
    [jobId]
  );

  try {
    const { reportText, usage, approvedCount } = await runResearchJob({
      pool,
      userId,
      scope,
      profile,
      onEvent: (evt: unknown) => {
        // Fire-and-forget append; ordering is preserved by the single worker.
        appendEvent(jobId, evt).catch((e) => console.error("append event failed:", e.message));
      },
    });

    await persistUsage(userId, jobId, usage);
    await pool.query(
      `INSERT INTO reports(user_id, job_id, kind, body_text) VALUES ($1, $2, 'run', $3)`,
      [userId, jobId, reportText]
    );
    await pool.query(
      `UPDATE jobs SET status='done', cost_usd=$2, finished_at=now() WHERE id=$1`,
      [jobId, usage?.totalUsd ?? 0]
    );
    console.log(`[job ${jobId}] done — ${approvedCount} approved, ~$${usage?.totalUsd ?? 0}`);
  } catch (err: any) {
    const terminal = err?.name === "CostCeilingError" || err?.name === "ScopeError";
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

    // Persist whatever usage accrued before the failure, for margin monitoring.
    // (CostCeilingError carries no snapshot; job.cost_usd stays best-effort 0.)
    await appendEvent(jobId, {
      type: "error",
      message: err?.message || "Run failed.",
      at: new Date().toISOString(),
    }).catch(() => {});

    if (terminal || isLastAttempt) {
      // Give up: mark failed and auto-refund the run credit.
      await refundCredit(purchaseId).catch((e) => console.error("refund failed:", e.message));
      await pool.query(
        `UPDATE jobs SET status='failed', error=$2, finished_at=now() WHERE id=$1`,
        [jobId, err?.message || "Run failed."]
      );
      console.warn(`[job ${jobId}] failed (${err?.name || "Error"}) — credit refunded.`);
      if (terminal) return; // handled terminally; don't trigger a BullMQ retry
    }
    throw err; // transient + attempts remain → BullMQ retries
  }
}

const worker = new Worker<RunJobData>(RUNS_QUEUE, processRun, {
  // BullMQ nests its own ioredis copy; bridge our runtime-compatible instance.
  connection: getRedis() as unknown as ConnectionOptions,
  concurrency: 1,
});

worker.on("ready", () => console.log(`[worker] listening on "${RUNS_QUEUE}" (concurrency 1).`));
worker.on("failed", (job, err) => console.error(`[worker] job ${job?.id} failed:`, err?.message));
worker.on("error", (err) => console.error("[worker] error:", err.message));

async function shutdown() {
  console.log("[worker] shutting down...");
  await worker.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
