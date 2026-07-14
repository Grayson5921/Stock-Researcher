"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReportView, { type ReportData } from "./ReportView";

interface ProgressEvent {
  type: string;
  message: string;
  at?: string;
  data?: any;
}
interface JobState {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  scope: any;
  cost_usd: string | number;
  error: string | null;
  progress_events: ProgressEvent[];
}

const TERMINAL = new Set(["done", "failed"]);

// Short display name: "The Valuation Disciplinarian" -> "Valuation Disciplinarian"
function critic(name: string) {
  return name?.replace(/^The\s+/i, "") ?? "Critic";
}

// One event -> one chat element. Critics speak from the left (gray bubbles),
// the researcher from the right (blue), everything procedural is a centered
// system line — like a group chat you're reading.
function Message({ e }: { e: ProgressEvent }) {
  const d = e.data || {};
  switch (e.type) {
    case "verdict":
      return (
        <div className="msg-row left">
          <span className="msg-sender">{critic(d.critic)}{d.round > 1 ? " · re-review" : ""}</span>
          <div className="bubble">
            <span className={`verdict-chip ${d.approved ? "approve" : "deny"}`}>
              {d.approved ? "APPROVE" : "DENY"}
            </span>
            {"\n"}
            {d.reasoning}
          </div>
        </div>
      );
    case "debate":
      return (
        <div className="msg-row right">
          <span className="msg-sender">Researcher → {critic(d.critic)}</span>
          <div className="bubble">
            {d.action === "concede" ? (
              <>
                <span className="verdict-chip">CONCEDES</span>
                {"\n"}
                {d.argument || "Point taken — withdrawing this claim."}
              </>
            ) : (
              <>
                <span className="verdict-chip">REBUTS</span>
                {"\n"}
                {d.argument}
              </>
            )}
          </div>
        </div>
      );
    case "news":
      return (
        <div className="msg-row left">
          <span className="msg-sender">News &amp; Sentiment</span>
          <div className="bubble">
            <span className={`verdict-chip ${d.label === "negative" ? "deny" : "approve"}`}>
              {(d.label || "n/a").toUpperCase()}{d.score != null ? ` · ${d.score}` : ""}
            </span>
            {d.summary ? "\n" + d.summary : null}
          </div>
        </div>
      );
    case "sim":
      return (
        <div className="msg-row left">
          <span className="msg-sender">Bull &amp; Bear Simulators</span>
          <div className="bubble">{e.message.replace(/^\[MOCK\]\s*/, "")}</div>
        </div>
      );
    case "stock":
      return <div className="chat-system strong">— {e.message.replace(/^\[MOCK\]\s*/, "").trim()} —</div>;
    case "stock-result": {
      const approved = d.status === "APPROVED";
      return (
        <div className="chat-system strong" style={{ color: approved ? "var(--green)" : "var(--red)" }}>
          {d.ticker}: {approved ? "✓ APPROVED" : "✕ NOT APPROVED"}
          {d.reason ? ` — ${d.reason}` : ""}
        </div>
      );
    }
    case "phase":
    case "done":
      return <div className="chat-system">{e.message.replace(/^\[MOCK\]\s*/, "")}</div>;
    case "error":
      return (
        <div className="chat-system strong" style={{ color: "var(--red)" }}>
          {e.message}
        </div>
      );
    default: {
      // Raw log lines: keep only the readable ones as faint system lines.
      const text = (e.message || "").trim();
      if (!text || text.startsWith("=") || text.startsWith("-")) return null;
      return <div className="chat-system">{text.replace(/\s+/g, " ").slice(0, 220)}</div>;
    }
  }
}

export default function RunView({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<JobState | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const stopped = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const res = await fetch(`/api/runs/${jobId}`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setJob(data.job);
          if (data.report) setReport(data.report);
          if (data.reportData) setReportData(data.reportData);
          if (TERMINAL.has(data.job.status)) {
            stopped.current = true;
            return;
          }
        }
      } catch {
        /* transient; keep polling */
      }
      if (!stopped.current) timer = setTimeout(poll, 1500);
    }
    poll();
    return () => {
      stopped.current = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  // Autoscroll as new messages land.
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [job?.progress_events?.length]);

  const events = job?.progress_events ?? [];
  const status = job?.status ?? "queued";
  const live = !TERMINAL.has(status);

  return (
    <div className="stack">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: 0 }}>Research Run</h1>
        <span className={`badge ${status}`}>{status}</span>
        <Link href="/dashboard" className="small" style={{ marginLeft: "auto" }}>← Dashboard</Link>
      </div>

      {job?.scope && (
        <p className="muted small" style={{ margin: 0 }}>
          Scope: {job.scope.ticker ? `ticker ${job.scope.ticker}` : job.scope.custom ? `"${job.scope.custom}"` : `${job.scope.field} sector`} ·
          {" "}Estimated cost so far: <span className="mono">${Number(job.cost_usd).toFixed(2)}</span>
        </p>
      )}

      {status === "failed" && (
        <div className="card" style={{ borderColor: "var(--red)" }}>
          <strong style={{ color: "var(--red)" }}>Run failed.</strong>
          <p className="small">{job?.error || "The run could not be completed."}</p>
          <p className="small muted">Your research-run credit was refunded automatically.</p>
        </div>
      )}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>
          The debate {live && <span className="muted small">(live — the panel is arguing…)</span>}
        </h2>
        <div className="chat" ref={chatRef}>
          {events.length === 0 ? (
            <div className="chat-system">Waiting for the run to start… this page updates on its own.</div>
          ) : (
            events.map((e, i) => <Message key={i} e={e} />)
          )}
          {live && events.length > 0 && <div className="chat-system">…</div>}
        </div>
      </section>

      {reportData ? (
        <ReportView data={reportData} jobId={jobId} />
      ) : report ? (
        <section className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h2 style={{ margin: 0 }}>Report</h2>
            <a className="btn secondary" style={{ marginLeft: "auto", padding: "6px 12px" }}
               href={`/api/runs/${jobId}/report`}>
              Download (.txt)
            </a>
          </div>
          <div className="report" style={{ marginTop: 12 }}>{report}</div>
        </section>
      ) : null}
    </div>
  );
}
