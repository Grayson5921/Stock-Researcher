-- Credit packs: one Stripe Checkout session can now grant multiple run credits
-- (quantities 1/3/5/10), stored as one purchases row per credit sharing the same
-- checkout session id. The UNIQUE constraint on the session id must go; webhook
-- idempotency is already guaranteed by the webhook_events table, and
-- markCreditPaid flips every pending row for the session in one statement.
ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_stripe_checkout_session_id_key;
CREATE INDEX IF NOT EXISTS purchases_checkout_session_idx
  ON purchases(stripe_checkout_session_id);
