// Shared Postgres pool. A single pool per process, reused across Next route
// handlers (and HMR reloads in dev) via a global cache.
//
// The pool is created lazily on first use (via a Proxy) so that importing this
// module never touches env — important because `next build` loads route/page
// modules for tracing, and DATABASE_URL may be absent at build time.
import { Pool } from "pg";
import { env } from "./env";

const g = globalThis as unknown as { __srPool?: Pool };

function realPool(): Pool {
  if (!g.__srPool) g.__srPool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
  return g.__srPool;
}

// A lazy stand-in that forwards every access to the real pool, created on demand.
export const pool: Pool = new Proxy({} as Pool, {
  get(_target, prop) {
    const p = realPool() as any;
    const value = p[prop];
    return typeof value === "function" ? value.bind(p) : value;
  },
});

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function one<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
