import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { countPaidCredits } from "@/lib/credits";
import { query } from "@/lib/db";
import { env } from "@/lib/env";
import RunLauncher from "./RunLauncher";

function scopeLabel(scope: any) {
  if (!scope) return "—";
  if (scope.ticker) return `Ticker · ${scope.ticker}`;
  if (scope.field) return `Sector · ${scope.field}`;
  return "—";
}

export default async function Dashboard() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [credits, runs] = await Promise.all([
    countPaidCredits(user.id),
    query<any>(
      `SELECT id, status, scope, cost_usd, created_at FROM jobs
        WHERE user_id = $1 AND kind = 'run' ORDER BY created_at DESC LIMIT 25`,
      [user.id]
    ),
  ]);

  return (
    <div className="stack">
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h1 style={{ margin: 0 }}>Dashboard</h1>
        <span className="muted small">{user.email}</span>
      </div>

      <RunLauncher
        credits={credits}
        priceCents={env.RESEARCH_RUN_PRICE_CENTS}
        enableDevCredits={!env.isProd && env.ENABLE_DEV_CREDITS}
      />

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Your research runs</h2>
        {runs.length === 0 ? (
          <p className="muted">No runs yet. Start one above.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Scope</th>
                <th>Status</th>
                <th>Est. cost</th>
                <th>Started</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{scopeLabel(r.scope)}</td>
                  <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                  <td className="mono">${Number(r.cost_usd).toFixed(2)}</td>
                  <td className="muted small">{new Date(r.created_at).toLocaleString()}</td>
                  <td><Link href={`/runs/${r.id}`}>View →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
