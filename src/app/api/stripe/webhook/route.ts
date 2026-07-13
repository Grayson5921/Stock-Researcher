import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { markCreditPaid } from "@/lib/credits";
import { pool, query } from "@/lib/db";
import { env } from "@/lib/env";

// Stripe requires the raw request body for signature verification.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return new Response("Webhook not configured", { status: 501 });
  }
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing signature", { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(raw, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return new Response(`Signature verification failed: ${(e as Error).message}`, { status: 400 });
  }

  // Idempotency: record the event id once. If we've seen it, ack and stop.
  const inserted = await query<{ id: string }>(
    "INSERT INTO webhook_events(id, type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id",
    [event.id, event.type]
  );
  if (inserted.length === 0) {
    return new Response("Duplicate event ignored", { status: 200 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.payment_status === "paid" || s.status === "complete") {
          const pi = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id ?? null;
          await markCreditPaid(s.id, pi);
        }
        break;
      }
      case "invoice.paid":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        // Subscription lifecycle (Daily Monitor) — handled in Phase 2.
        // Acknowledged here so retries don't pile up.
        break;
      default:
        break;
    }
  } catch (e) {
    // Roll back the idempotency marker so Stripe retries a genuinely failed handler.
    await pool
      .query("DELETE FROM webhook_events WHERE id = $1", [event.id])
      .catch(() => {});
    console.error("Webhook handler error:", (e as Error).message);
    return new Response("Handler error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}
