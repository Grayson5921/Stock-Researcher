// Applies every db/migrations/*.sql file in filename order, once each, inside a
// transaction, tracking applied files in a schema_migrations table.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "migrations");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set (copy .env.example to .env).");
  process.exit(1);
}

const client = new pg.Client({ connectionString: DATABASE_URL });

async function main() {
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const { rows } = await client.query("SELECT filename FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.filename));

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    process.stdout.write(`  applying ${file} ... `);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log("ok");
      ran++;
    } catch (e) {
      await client.query("ROLLBACK");
      console.log("FAILED");
      throw e;
    }
  }
  console.log(ran ? `Done. Applied ${ran} migration(s).` : "Database already up to date.");
}

main()
  .catch((e) => {
    console.error("Migration error:", e.message || e);
    process.exitCode = 1;
  })
  .finally(() => client.end());
