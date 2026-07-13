// Dev/admin helper: grant a paid research-run credit to a user by email.
//   node db/grant-credit.mjs someone@example.com
// This mirrors what the Stripe webhook does, for local testing only.
import "dotenv/config";
import pg from "pg";

const email = process.argv[2];
if (!email) {
  console.error("Usage: node db/grant-credit.mjs <email>");
  process.exit(1);
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();
  const { rows } = await client.query("SELECT id FROM users WHERE email = $1", [email]);
  if (!rows.length) {
    console.error(`No user with email ${email}. Sign up first.`);
    process.exitCode = 1;
    return;
  }
  await client.query(
    `INSERT INTO purchases(user_id, type, price_cents, status, stripe_checkout_session_id)
     VALUES ($1, 'research_run', $2, 'paid', $3)`,
    [rows[0].id, Number(process.env.RESEARCH_RUN_PRICE_CENTS || 2000), `grant_${Date.now()}`]
  );
  console.log(`Granted 1 research-run credit to ${email}.`);
}

main()
  .catch((e) => {
    console.error("Error:", e.message || e);
    process.exitCode = 1;
  })
  .finally(() => client.end());
