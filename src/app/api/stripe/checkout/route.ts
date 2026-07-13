import { requireUser } from "@/lib/session";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { createPendingPurchase } from "@/lib/credits";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/rateLimit";
import { json, error, handleError } from "@/lib/http";

// Create a Stripe Checkout session for a one-time Research Run credit.
export async function POST() {
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

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: user.id,
      customer_email: user.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: env.RESEARCH_RUN_PRICE_CENTS,
            product_data: {
              name: "Stock Researcher — Research Run",
              description: "One deep research run: one sector scan or one ticker deep-dive.",
            },
          },
        },
      ],
      success_url: `${env.APP_URL}/dashboard?paid=1`,
      cancel_url: `${env.APP_URL}/dashboard?canceled=1`,
      metadata: { userId: user.id, type: "research_run" },
    });

    // Record the pending purchase keyed by the checkout session so the webhook
    // can idempotently confirm it. Credits are NEVER granted from the client.
    await createPendingPurchase(user.id, session.id, null, env.RESEARCH_RUN_PRICE_CENTS);

    return json({ url: session.url });
  } catch (e) {
    return handleError(e);
  }
}
