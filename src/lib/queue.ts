// BullMQ queue for research-run jobs. The API enqueues; the worker (worker/index.ts)
// consumes. Kept in its own module so both sides share the exact queue name/opts.
import { Queue, type ConnectionOptions } from "bullmq";
import { getRedis } from "./redis";

// BullMQ nests its own copy of ioredis, so our Redis instance is nominally a
// different type at compile time even though it's runtime-compatible. Bridge it.
function connection(): ConnectionOptions {
  return getRedis() as unknown as ConnectionOptions;
}

export const RUNS_QUEUE = "research-runs";

export interface RunJobData {
  jobId: string; // our jobs.id (source of truth in Postgres)
  userId: string;
  scope: { field?: string; ticker?: string };
  profile: string;
  purchaseId: string; // credit to consume/refund
}

const g = globalThis as unknown as { __srRunsQueue?: Queue<RunJobData> };

export function getRunsQueue(): Queue<RunJobData> {
  if (g.__srRunsQueue) return g.__srRunsQueue;
  const q = new Queue<RunJobData>(RUNS_QUEUE, {
    connection: connection(),
    defaultJobOptions: {
      // Worker crash → retry once, then fail (worker marks the job failed and
      // refunds the run credit).
      attempts: 2,
      backoff: { type: "fixed", delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });
  g.__srRunsQueue = q;
  return q;
}
