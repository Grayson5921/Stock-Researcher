import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { PRICING } from "@/lib/pricing";

function dollars(cents: number) {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export default async function Home() {
  const user = await getCurrentUser();
  return (
    <div className="stack">
      <section className="card" style={{ padding: 32 }}>
        <h1 style={{ margin: 0, fontSize: 34, letterSpacing: -0.5 }}>
          A skeptical panel of AI analysts, hunting low/mid-cap stocks.
        </h1>
        <p className="muted" style={{ fontSize: 17, maxWidth: 680 }}>
          Candidates are proposed with live research, stress-tested through a 9-critic gauntlet
          with debate, checked against news and bull/bear simulations, and delivered as a ranked
          report — or a documented “nothing passed.”
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <Link className="btn" href={user ? "/dashboard" : "/signup"}>
            {user ? "Go to dashboard" : "Get started"}
          </Link>
          <Link className="btn secondary" href="#pricing">See pricing</Link>
        </div>
        <p className="disclaimer" style={{ marginTop: 20 }}>
          <strong>Not investment advice.</strong> This is an automated research tool built on an LLM
          plus web search. Outputs may be wrong, outdated, or fabricated. Verify everything in primary
          sources and consult a licensed advisor. You are solely responsible for any trades.
        </p>
      </section>

      <section>
        <h2>How a Research Run works</h2>
        <div className="grid cols-3">
          <div className="card">
            <h3>1 · Research</h3>
            <p className="muted small">Agents propose grounded low/mid-cap candidates for one sector, or deep-dive a ticker you supply.</p>
          </div>
          <div className="card">
            <h3>2 · Gauntlet</h3>
            <p className="muted small">9 critics review 90 criteria; analysts rebut or concede; news + bull/bear simulation gate the survivors.</p>
          </div>
          <div className="card">
            <h3>3 · Report</h3>
            <p className="muted small">You watch the debate stream live, then get a ranked report with the full rationale for every stock.</p>
          </div>
        </div>
      </section>

      <section id="pricing">
        <h2>Pricing</h2>
        <div className="grid cols-3">
          <div className="card">
            <h3>{PRICING.researchRun.label}</h3>
            <div className="price">{dollars(PRICING.researchRun.cents)}</div>
            <p className="muted small">one-time</p>
            <p className="small">{PRICING.researchRun.blurb}</p>
            <Link className="btn" href={user ? "/dashboard" : "/signup"}>
              {user ? "Buy a run" : "Sign up"}
            </Link>
          </div>
          {PRICING.monitorTiers.map((t) => (
            <div className="card" key={t.id}>
              <h3>Daily Monitor — {t.name}</h3>
              <div className="price">{dollars(t.cents)}<span className="muted small">/mo</span></div>
              <p className="small">{t.blurb}</p>
              <span className="badge queued">Coming in Phase 2</span>
            </div>
          ))}
        </div>
        <p className="muted small" style={{ marginTop: 12 }}>
          Daily Monitor re-evaluates positions you actually bought and issues HOLD / TRIM / SELL / ADD
          per position. Subscriptions arrive in Phase 2.
        </p>
      </section>
    </div>
  );
}
