import { requireUser } from "@/lib/session";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { createPendingPurchases } from "@/lib/credits";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/rateLimit";
import { json, error, handleError } from "@/lib/http";

// Credit packs offered at checkout. Straight multiples of the unit price — the
// per-run margin is fixed COGS + markup, so no bulk discounting.
const PACK_SIZES = [1, 3, 5, 10] as const;

// Create a Stripe Checkout session for one or more Research Run credits.
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!stripeConfigured()) {
      return error(
        "Payments are not configured on this server. (For local testing, enable ENABLE_DEV_CREDITS or run `npm run grant-credit`.)",
        501
      );
    }
    const { allowed } = await rateLimit(`checkout:${user.id}`, 20, 3600);
    if (!allowed) return error("Too many checkout attempts.", 429);

    const body = await req.json().catch(() => ({}));
    const quantity = Number(body.quantity ?? 1);
    if (!PACK_SIZES.includes(quantity as any)) {
      return error("Invalid pack size. Choose 1, 3, 5, or 10 runs.", 422);
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: user.id,
      customer_email: user.email,
      line_items: [
        {
          quantity,
          price_data: {
            currency: "usd",
            unit_amount: env.RESEARCH_RUN_PRICE_CENTS,
            product_data: {
              name: "Nine Critics — Research Run",
              description:
                quantity === 1
                  ? "One deep research run: one sector scan or one ticker deep-dive."
                  : `${quantity} research-run credits (each: one sector scan or one ticker deep-dive).`,
            },
          },
        },
      ],
      success_url: `${env.APP_URL}/dashboard?paid=1`,
      cancel_url: `${env.APP_URL}/dashboard?canceled=1`,
      metadata: { userId: user.id, type: "research_run", quantity: String(quantity) },
    });

    // Record the pending purchases (one row per credit) keyed by the checkout
    // session so the webhook can idempotently confirm them all. Credits are
    // NEVER granted from the client.
    await createPendingPurchases(user.id, session.id, null, env.RESEARCH_RUN_PRICE_CENTS, quantity);

    return json({ url: session.url });
  } catch (e) {
    return handleError(e);
  }
}
