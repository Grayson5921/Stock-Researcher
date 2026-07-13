// Seeds a demo user with a paid (unconsumed) research-run credit so the whole
// sign-up -> pay -> run -> report path can be exercised locally without Stripe.
// Idempotent: re-running just ensures the demo user + one spare credit exist.
import "dotenv/config";
import bcrypt from "bcryptjs";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

const DEMO_EMAIL = process.env.SEED_EMAIL || "demo@example.com";
const DEMO_PASSWORD = process.env.SEED_PASSWORD || "demo-password-123";

const client = new pg.Client({ connectionString: DATABASE_URL });

async function main() {
  await client.connect();
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const { rows } = await client.query(
    `INSERT INTO users(email, password_hash) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [DEMO_EMAIL, hash]
  );
  const userId = rows[0].id;

  const { rows: credits } = await client.query(
    `SELECT count(*)::int AS n FROM purchases
       WHERE user_id = $1 AND type = 'research_run' AND status = 'paid'`,
    [userId]
  );
  if (credits[0].n === 0) {
    await client.query(
      `INSERT INTO purchases(user_id, type, price_cents, status, stripe_checkout_session_id)
       VALUES ($1, 'research_run', $2, 'paid', $3)`,
      [userId, Number(process.env.RESEARCH_RUN_PRICE_CENTS || 2500), `seed_${Date.now()}`]
    );
  }

  console.log("Seeded demo user:");
  console.log(`  email:    ${DEMO_EMAIL}`);
  console.log(`  password: ${DEMO_PASSWORD}`);
  console.log(`  user_id:  ${userId}`);
  console.log("  A paid research-run credit is available (log in and click Run Research).");
}

main()
  .catch((e) => {
    console.error("Seed error:", e.message || e);
    process.exitCode = 1;
  })
  .finally(() => client.end());
