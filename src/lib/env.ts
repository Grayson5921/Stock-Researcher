// Centralized environment access. Import from here so a missing critical var
// fails loudly and in one place. All values are server-side only.

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (see .env.example).`);
  return v;
}
function opt(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}
function num(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  get DATABASE_URL() {
    return req("DATABASE_URL");
  },
  get REDIS_URL() {
    return opt("REDIS_URL", "redis://localhost:6379");
  },
  get SESSION_SECRET() {
    return req("SESSION_SECRET");
  },
  get APP_URL() {
    // Render injects RENDER_EXTERNAL_URL with the service's public URL, so the
    // blueprint deploy works before a custom domain is configured.
    return opt("APP_URL", opt("RENDER_EXTERNAL_URL", "http://localhost:3000"));
  },
  get STRIPE_SECRET_KEY() {
    return opt("STRIPE_SECRET_KEY");
  },
  get STRIPE_WEBHOOK_SECRET() {
    return opt("STRIPE_WEBHOOK_SECRET");
  },
  get RESEARCH_RUN_PRICE_CENTS() {
    return num("RESEARCH_RUN_PRICE_CENTS", 2000);
  },
  get JOB_COST_CEILING_USD() {
    return num("JOB_COST_CEILING_USD", 15);
  },
  get USER_DAILY_CALL_CAP() {
    return num("USER_DAILY_CALL_CAP", 2000);
  },
  get GLOBAL_DAILY_BUDGET_USD() {
    return num("GLOBAL_DAILY_BUDGET_USD", 500);
  },
  get MOCK_WORKFLOW() {
    return process.env.MOCK_WORKFLOW === "1";
  },
  get ENABLE_DEV_CREDITS() {
    return process.env.ENABLE_DEV_CREDITS === "1";
  },
  get isProd() {
    return process.env.NODE_ENV === "production";
  },
};
