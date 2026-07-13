-- Phase 1 schema for the Stock Researcher web product.
-- Single-file initial migration. Run via `npm run migrate`.

-- gen_random_uuid() is provided by pgcrypto (bundled with Postgres 13+).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- users + auth
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Server-side sessions; the cookie carries only the (signed) session id.
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,                -- random opaque token
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

-- ---------------------------------------------------------------------------
-- billing
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier                TEXT NOT NULL CHECK (tier IN ('base','plus','pro')),
  status              TEXT NOT NULL DEFAULT 'inactive',
  stripe_customer_id  TEXT,
  stripe_sub_id       TEXT UNIQUE,
  current_period_end  TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

-- A purchase is a one-time Research Run credit. status flows
-- pending -> paid -> consumed (or refunded). Never granted from a client signal
-- — only a verified Stripe webhook flips pending -> paid.
CREATE TABLE IF NOT EXISTS purchases (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                        TEXT NOT NULL DEFAULT 'research_run',
  scope                       JSONB,          -- {field} | {ticker}
  price_cents                 INTEGER NOT NULL DEFAULT 2000,
  status                      TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','paid','consumed','refunded')),
  stripe_checkout_session_id  TEXT UNIQUE,    -- idempotency handle for the webhook
  stripe_payment_intent       TEXT,
  consumed_job_id             UUID,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchases_user_status_idx ON purchases(user_id, status);

-- Stripe webhook idempotency: every processed event id is recorded once.
CREATE TABLE IF NOT EXISTS webhook_events (
  id          TEXT PRIMARY KEY,               -- Stripe event id (evt_...)
  type        TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- jobs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('run','monitor')),
  status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','running','done','failed')),
  profile         TEXT,
  scope           JSONB,                      -- {field} | {ticker}
  progress_events JSONB NOT NULL DEFAULT '[]'::jsonb,
  cost_usd        NUMERIC(10,4) NOT NULL DEFAULT 0,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS jobs_user_idx ON jobs(user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- per-user ledger (replaces the JSON file). The full stock entry the file
-- ledger held is stored losslessly in `data`; ticker/field/status/approved_at
-- are promoted for querying and dedup.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger_stocks (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker      TEXT NOT NULL,
  company     TEXT,
  field       TEXT,
  status      TEXT,
  approved_at TIMESTAMPTZ,
  data        JSONB NOT NULL,                 -- the complete ledger stock object
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, ticker)
);
CREATE INDEX IF NOT EXISTS ledger_stocks_field_idx ON ledger_stocks(user_id, field);

-- ---------------------------------------------------------------------------
-- positions (Phase 2 surface, table created now)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS positions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker     TEXT NOT NULL,
  cost_basis NUMERIC(14,4) NOT NULL,
  shares     NUMERIC(18,6) NOT NULL DEFAULT 1,
  bought_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sold_at    TIMESTAMPTZ,
  sold_price NUMERIC(14,4)
);
CREATE INDEX IF NOT EXISTS positions_user_open_idx ON positions(user_id) WHERE sold_at IS NULL;

CREATE TABLE IF NOT EXISTS monitor_snapshots (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker     TEXT NOT NULL,
  date       DATE NOT NULL DEFAULT current_date,
  price      NUMERIC(14,4),
  return_pct NUMERIC(10,4),
  action     TEXT,
  confidence INTEGER,
  flags      JSONB,
  reasoning  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS monitor_snapshots_user_ticker_idx
  ON monitor_snapshots(user_id, ticker, date DESC);

-- ---------------------------------------------------------------------------
-- reports + usage accounting
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id     UUID REFERENCES jobs(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('run','monitor')),
  body_text  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reports_user_idx ON reports(user_id, created_at DESC);

-- Every model call's token/search usage, attributed to a user + job. Powers
-- margin monitoring and the global budget kill-switch.
CREATE TABLE IF NOT EXISTS usage_ledger (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id        UUID REFERENCES jobs(id) ON DELETE SET NULL,
  model         TEXT NOT NULL,
  in_tokens     BIGINT NOT NULL DEFAULT 0,
  out_tokens    BIGINT NOT NULL DEFAULT 0,
  cached_tokens BIGINT NOT NULL DEFAULT 0,
  searches      INTEGER NOT NULL DEFAULT 0,
  cost_usd      NUMERIC(10,4) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_ledger_day_idx ON usage_ledger(created_at);
CREATE INDEX IF NOT EXISTS usage_ledger_user_day_idx ON usage_ledger(user_id, created_at);
