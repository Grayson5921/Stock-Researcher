"use client";
import { useState } from "react";

interface Verdict {
  critic: string;
  approved: boolean;
  reasoning: string;
}
interface StockEntry {
  field: string;
  ticker: string;
  company: string;
  thesis: string;
  catalysts: string[];
  sources: { title: string; url: string }[];
  status: string;
  rejectReason: string;
  approvals: number;
  totalCritics: number;
  verdicts: Verdict[];
  debate: { critic: string; action: string; argument: string }[];
  news: { label: string; score: number; summary: string } | null;
  simulation: {
    netUpside: number;
    expectedReturn: number | null;
    riskReward: number | null;
    upside: number | null;
    downside: number | null;
  } | null;
}
export interface ReportData {
  approvedCount: number;
  evaluatedCount: number;
  fields: string[];
  stocks: StockEntry[];
}

function critic(name: string) {
  return name?.replace(/^The\s+/i, "") ?? "Critic";
}

function StockCard({ s, rank }: { s: StockEntry; rank: number | null }) {
  const [open, setOpen] = useState(false);
  const approved = s.status === "APPROVED";
  return (
    <div className="stock-card">
      <div className="stock-head">
        <div>
          {rank != null && <span className="rank">#{rank}</span>}
          <span className="tkr mono">{s.ticker}</span>
          <span className="muted"> — {s.company}</span>
        </div>
        <span className={`badge ${approved ? "approve" : "deny"}`}>
          {approved ? "APPROVED" : "NOT APPROVED"}
        </span>
      </div>

      <div className="stock-stats">
        <span className="stat">
          <strong>{s.approvals}/{s.totalCritics}</strong> critics
        </span>
        {s.simulation && (
          <>
            <span className="stat"><strong>{s.simulation.netUpside}%</strong> upside conf.</span>
            {s.simulation.expectedReturn != null && (
              <span className="stat"><strong>{s.simulation.expectedReturn > 0 ? "+" : ""}{s.simulation.expectedReturn}%</strong> expected</span>
            )}
            {s.simulation.riskReward != null && (
              <span className="stat"><strong>{s.simulation.riskReward}:1</strong> risk/reward</span>
            )}
          </>
        )}
        {s.news && (
          <span className="stat">
            news <strong className={s.news.label === "negative" ? "neg" : "pos"}>{s.news.label}</strong>
          </span>
        )}
      </div>

      {!approved && s.rejectReason && (
        <p className="reject-reason">Why it didn’t pass: {s.rejectReason}</p>
      )}
      {s.thesis && <p className="small" style={{ margin: "8px 0 0" }}>{s.thesis}</p>}

      <button className="btn ghost small-btn" onClick={() => setOpen(!open)}>
        {open ? "Hide" : "Show"} full evaluation ({s.verdicts.length} critic verdicts
        {s.debate.length ? `, ${s.debate.length} debate turns` : ""})
      </button>

      {open && (
        <div className="stock-detail">
          {s.catalysts.length > 0 && (
            <div>
              <strong className="small">Catalysts</strong>
              <ul className="small">{s.catalysts.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </div>
          )}
          <strong className="small">Critic verdicts</strong>
          <ul className="small verdict-list">
            {s.verdicts.map((v, i) => (
              <li key={i}>
                <span className={`verdict-chip ${v.approved ? "approve" : "deny"}`}>
                  {v.approved ? "APPROVE" : "DENY"}
                </span>{" "}
                <strong>{critic(v.critic)}:</strong> {v.reasoning}
              </li>
            ))}
          </ul>
          {s.debate.length > 0 && (
            <>
              <strong className="small">Debate</strong>
              <ul className="small">
                {s.debate.map((d, i) => (
                  <li key={i}>
                    <strong>{d.action === "concede" ? "Conceded to" : "Rebutted"} {critic(d.critic)}:</strong>{" "}
                    {d.argument}
                  </li>
                ))}
              </ul>
            </>
          )}
          {s.news?.summary && (
            <p className="small"><strong>News:</strong> {s.news.summary}</p>
          )}
          {s.sources.length > 0 && (
            <p className="small">
              <strong>Sources:</strong>{" "}
              {s.sources.map((a, i) => (
                <span key={i}>
                  <a href={a.url} target="_blank" rel="noopener noreferrer">{a.title || a.url}</a>
                  {i < s.sources.length - 1 ? " · " : ""}
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReportView({ data, jobId }: { data: ReportData; jobId: string }) {
  const approved = data.stocks.filter((s) => s.status === "APPROVED");
  const rest = data.stocks.filter((s) => s.status !== "APPROVED");

  return (
    <section className="card">
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Report</h2>
        <a className="btn secondary" style={{ marginLeft: "auto", padding: "6px 12px" }}
           href={`/api/runs/${jobId}/report`}>
          Download full report (.txt)
        </a>
      </div>

      <div className="report-summary">
        <div className="sum-tile">
          <div className="sum-n">{data.evaluatedCount}</div>
          <div className="sum-l">candidates evaluated</div>
        </div>
        <div className="sum-tile">
          <div className="sum-n" style={{ color: approved.length ? "var(--green)" : "var(--red)" }}>
            {approved.length}
          </div>
          <div className="sum-l">cleared every gate</div>
        </div>
        <div className="sum-tile">
          <div className="sum-n">{9}</div>
          <div className="sum-l">critics per stock</div>
        </div>
      </div>

      {approved.length === 0 && rest.length > 0 && (
        <p className="disclaimer" style={{ marginTop: 4 }}>
          <strong>No candidate cleared every gate this run — that IS the finding.</strong> The gauntlet
          is strict by design (8 of 9 critics, a news gate, and a simulation-confidence bar), and a
          documented “nothing passed” protects you from marginal ideas. Every candidate’s full
          evaluation is below, ranked by how close it came — the near-misses at the top are the ones
          to watch.
        </p>
      )}

      {approved.length > 0 && (
        <>
          <h3 style={{ marginBottom: 8 }}>✓ Approved — ranked by simulation confidence</h3>
          {approved.map((s, i) => <StockCard key={s.ticker} s={s} rank={i + 1} />)}
        </>
      )}

      {rest.length > 0 && (
        <>
          <h3 style={{ marginBottom: 8 }}>
            {approved.length === 0 ? "All candidates" : "Not approved"} — ranked by how close each came
          </h3>
          {rest.map((s) => <StockCard key={s.ticker} s={s} rank={null} />)}
        </>
      )}

      <p className="disclaimer" style={{ marginTop: 16 }}>
        Generated by an automated multi-agent AI workflow using web search. It may contain errors,
        outdated figures, or AI-fabricated details. NOT investment advice — verify every figure in
        primary sources (SEC filings, company IR) and consult a licensed advisor before investing.
      </p>
    </section>
  );
}
