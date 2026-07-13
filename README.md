# Stock Researcher — Web Product (Phase 1)

A paid web product wrapping the existing multi-agent stock-research workflow. This
repo delivers **Phase 1** of the build brief: a sellable one-time **Research Run**
product — sign up → pay → watch a run stream live → read a ranked report — on top
of the ported agent core.

> ⚠️ **Not investment advice.** This is an automated research tool built on an LLM
> plus web search. Outputs may be wrong, outdated, or fabricated. Verify everything
> in primary sources and consult a licensed advisor. Users are solely responsible
> for any trades. Have a securities attorney review positioning before launch.

---

## What's in Phase 1

- **Ported agent core** (`agent-core/`) — the original workflow, unchanged in logic,
  with three surgical ports required by the brief:
  - `ledger.js` is now **DB-backed and per-user** (same function signatures:
    `loadLedger` / `seenTickers` / `deniedForField` / `recordReview` / `saveLedger` /
    `priorInteractionSummary`), reading/writing the `ledger_stocks` table.
  - `costTracker` gains `reset()` + `snapshot()` so spend is **per-job and
    attributed to users** (`usage_ledger`), and enforces a **hard per-job cost
    ceiling** (`CostCeilingError`).
  - The workflow's `log()` calls now emit **progress events** through a sink
    (`progress.js`) so jobs stream status to the UI instead of the console.
  - Commercial **config profiles** (`commercial_run`, `commercial_monitor`) added
    to `config.js`.
- **Auth** — email + password, httpOnly signed session cookies.
- **Stripe** — one-time Checkout for a Research Run + an **idempotent webhook** that
  grants credits (never granted from a client signal).
- **Queue + worker** — the API enqueues; a BullMQ worker executes the run by calling
  the agent core directly, streams progress into `jobs.progress_events`, persists the
  report + usage, and **auto-refunds the credit** on failure.
- **Guardrails** — per-job cost ceiling, global daily budget kill-switch, one
  concurrent run per user, per-endpoint rate limits, ticker validation, idempotent
  webhooks, worker retry-once-then-fail.
- **Frontend** — landing/pricing (with disclaimers), signup/login, dashboard (credits
  + run launcher + past runs), and a live run page (streaming debate → ranked report).

**Deferred to Phase 2/3** (tables/profiles are already scaffolded): the Daily Monitor
subscriptions + scheduler, positions UI, performance/outcome page, admin dashboard,
and email notifications.

## Architecture

```
Browser ──HTTP──> Next.js (App Router, TypeScript)
                    ├─ API routes: auth, /api/runs, Stripe checkout+webhook
                    └─ enqueues run jobs ──> Redis (BullMQ)
                                               │
                                   worker/index.ts (concurrency 1)
                                               │ calls directly
                                   agent-core/jobRunner.js  ──> Anthropic API
                                               │ (progress sink, cost ceiling)
                                               └─> Postgres (jobs, reports,
                                                    ledger_stocks, usage_ledger, …)
```

All secrets (Anthropic, Finnhub, Stripe) live server-side only — never in the browser,
never per-user.

## Local development

Prereqs: **Node 18.18+**, and Postgres + Redis (via docker-compose or local binaries).

```bash
# 1) start dependencies
docker compose up -d            # postgres:5432 + redis:6379

# 2) configure
cp .env.example .env            # then edit SESSION_SECRET, etc.
npm install

# 3) database
npm run migrate                 # apply db/migrations/*.sql
npm run seed                    # optional: demo user + one paid credit

# 4) run (two processes)
npm run dev                     # Next.js on http://localhost:3000
npm run worker                  # BullMQ worker (separate terminal)
```

### Trying it without spending API credits

Set `MOCK_WORKFLOW=1` in `.env`: the worker emits a canned progress stream + a sample
report instead of calling Anthropic, so you can exercise the whole
sign-up → pay → run → report path for free. Set `ENABLE_DEV_CREDITS=1` to reveal a
"Grant test credit (dev)" button on the dashboard (dev only; disabled in production),
or run `npm run grant-credit you@example.com`.

For a real run, unset `MOCK_WORKFLOW`, set `ANTHROPIC_API_KEY`, and ensure web search
is enabled for your Anthropic org.

## Configuration

See `.env.example` for every variable. Highlights:

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Server-side model access (required for real runs). |
| `MARKET_DATA_PROVIDER` | `yahoo` (dev, unlicensed) or `finnhub` (licensed, needs `FINNHUB_API_KEY`). In production the licensed provider is required — Yahoo is never used commercially. |
| `SEC_USER_AGENT` | Real contact string required by SEC EDGAR. |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | One-time run checkout + webhook. |
| `JOB_COST_CEILING_USD` | Hard per-run spend cap (default 15). Run aborts + credit refunds if crossed. |
| `GLOBAL_DAILY_BUDGET_USD` | Global daily kill-switch; new runs refuse above it. |
| `MOCK_WORKFLOW` / `ENABLE_DEV_CREDITS` | Dev conveniences — must be off in production. |

The commercial run profile (`agent-core/config.js` → `PROFILES.commercial_run`) sets
`MAX_SEARCH_ROUNDS=5`, `STOCKS_PER_FIELD=3`, Opus researchers / Sonnet critics,
8-of-9 approvals, 55% simulation gate, and the $300M–$20B market-cap gate.

## Testing

```bash
npm run typecheck      # tsc --noEmit
npm run build          # next build
npm test               # node --test — mock-workflow + scope + cost-ceiling tests
```

The tests use the repo's mock-client approach (no live API calls). The full stack was
also verified end-to-end against real Postgres + Redis + the worker: signup → credit
gate (402) → grant → run → streamed verdicts → persisted report, plus the DB-backed
ledger round-trip.

## Stripe webhook (local)

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
# put the printed whsec_... into STRIPE_WEBHOOK_SECRET
```
`checkout.session.completed` flips the pending purchase to `paid` (idempotent via
`webhook_events`). Credits are never minted from client-side signals.

## Deployment

Deployable to a single VPS or Render/Railway: run the Next app (`npm run build && npm
run start`) and the worker (`npm run worker`) as two processes against managed Postgres
+ Redis. Set all secrets via environment variables. Run `npm run migrate` on deploy.

## Project layout

```
agent-core/            # ported agent workflow (JS ESM) — logic unchanged
  jobRunner.js         #   the worker's entry seam (one scope per run) + mock mode
  ledger.js            #   DB-backed, per-user (same signatures as the file version)
  costTracker.js       #   per-job reset/snapshot + CostCeilingError
  progress.js          #   progress-event sink (replaces console logging)
  config.js            #   original tunables + commercial PROFILES
  agents/ criteria/ orchestrator/ output/ marketData.js monitor.js …
db/
  migrations/0001_init.sql
  migrate.mjs seed.mjs grant-credit.mjs
src/
  lib/                 # db, session, queue, stripe, credits, runs, budget, rate limits
  app/                 # Next.js App Router: pages + API routes
  components/
worker/index.ts        # BullMQ worker
tests/                 # node:test unit tests
docker-compose.yml     # postgres + redis
```
