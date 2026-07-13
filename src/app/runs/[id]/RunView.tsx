"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

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

export default function RunView({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<JobState | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
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

  // Autoscroll the feed as events arrive.
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [job?.progress_events?.length]);

  const events = job?.progress_events ?? [];
  const status = job?.status ?? "queued";

  return (
    <div className="stack">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: 0 }}>Research Run</h1>
        <span className={`badge ${status}`}>{status}</span>
        <Link href="/dashboard" className="small" style={{ marginLeft: "auto" }}>← Dashboard</Link>
      </div>

      {job?.scope && (
        <p className="muted small" style={{ margin: 0 }}>
          Scope: {job.scope.ticker ? `ticker ${job.scope.ticker}` : `${job.scope.field} sector`} ·
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
        <h2 style={{ marginTop: 0 }}>Live progress {!TERMINAL.has(status) && <span className="muted small">(streaming…)</span>}</h2>
        <div className="feed" ref={feedRef}>
          {events.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>Waiting for the run to start…</p>
          ) : (
            events.map((e, i) => (
              <div key={i} className={`evt ${e.type}`}>
                {e.type === "verdict" && e.data ? (
                  <>
                    <span className={`badge ${e.data.approved ? "approve" : "deny"}`}>
                      {e.data.approved ? "APPROVE" : "DENY"}
                    </span>{" "}
                    <strong>{e.data.critic}</strong> — {e.data.reasoning}
                  </>
                ) : (
                  <span className="mono">{e.message}</span>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      {report && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Report</h2>
          <div className="report">{report}</div>
        </section>
      )}
    </div>
  );
}
