import { requireUser } from "@/lib/session";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import { json, error, handleError } from "@/lib/http";

// DEV ONLY: grant the signed-in user a paid research-run credit without Stripe.
// Guarded by ENABLE_DEV_CREDITS and disabled in production. Lets you exercise the
// full run flow locally. This is the ONLY non-webhook path that mints a credit.
export async function POST() {
  try {
    if (env.isProd || !env.ENABLE_DEV_CREDITS) {
      return error("Not available.", 404);
    }
    const user = await requireUser();
    await pool.query(
      `INSERT INTO purchases(user_id, type, price_cents, status, stripe_checkout_session_id)
       VALUES ($1, 'research_run', $2, 'paid', $3)`,
      [user.id, env.RESEARCH_RUN_PRICE_CENTS, `dev_${Date.now()}_${Math.random().toString(36).slice(2)}`]
    );
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
