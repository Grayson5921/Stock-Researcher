// Research-run credit accounting. A credit is a `purchases` row with
// type='research_run'. Lifecycle: pending -> paid -> consumed (-> refunded/paid).
// Credits are only ever moved to 'paid' by a verified Stripe webhook (or the
// dev-only grant script), never from a client signal.
import { pool, query, one } from "./db";

export async function countPaidCredits(userId: string): Promise<number> {
  const row = await one<{ n: string }>(
    `SELECT count(*)::text AS n FROM purchases
      WHERE user_id = $1 AND type = 'research_run' AND status = 'paid'`,
    [userId]
  );
  return row ? Number(row.n) : 0;
}

// Create the pending purchase that a Stripe Checkout session will later confirm.
export async function createPendingPurchase(
  userId: string,
  sessionId: string,
  scope: unknown,
  priceCents: number
): Promise<string> {
  const row = await one<{ id: string }>(
    `INSERT INTO purchases(user_id, type, scope, price_cents, status, stripe_checkout_session_id)
     VALUES ($1, 'research_run', $2, $3, 'pending', $4)
     RETURNING id`,
    [userId, scope == null ? null : JSON.stringify(scope), priceCents, sessionId]
  );
  return row!.id;
}

// Idempotently mark the purchase for a checkout session as paid. Safe to call
// multiple times (webhook retries) — only flips pending -> paid once.
export async function markCreditPaid(sessionId: string, paymentIntent: string | null): Promise<void> {
  await query(
    `UPDATE purchases
        SET status = 'paid', stripe_payment_intent = COALESCE($2, stripe_payment_intent), updated_at = now()
      WHERE stripe_checkout_session_id = $1 AND status = 'pending'`,
    [sessionId, paymentIntent]
  );
}

// Restore a consumed credit to 'paid' so the user can retry after a failed run.
export async function refundCredit(purchaseId: string): Promise<void> {
  await query(
    `UPDATE purchases
        SET status = 'paid', consumed_job_id = NULL, updated_at = now()
      WHERE id = $1 AND status = 'consumed'`,
    [purchaseId]
  );
}

// Atomically consume one paid credit for a job. Returns the purchase id or null
// if the user has no available credit. Must run inside a transaction (client).
export async function consumeCreditTx(client: any, userId: string, jobId: string): Promise<string | null> {
  const res = await client.query(
    `UPDATE purchases
        SET status = 'consumed', consumed_job_id = $2, updated_at = now()
      WHERE id = (
        SELECT id FROM purchases
         WHERE user_id = $1 AND type = 'research_run' AND status = 'paid'
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
     RETURNING id`,
    [userId, jobId]
  );
  return res.rows[0]?.id ?? null;
}

export { pool };
