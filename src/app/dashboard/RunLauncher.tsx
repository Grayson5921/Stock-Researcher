"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const FIELDS = ["technology", "business", "energy"] as const;

export default function RunLauncher({
  credits,
  enableDevCredits,
}: {
  credits: number;
  enableDevCredits: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"field" | "ticker">("field");
  const [field, setField] = useState<(typeof FIELDS)[number]>("technology");
  const [ticker, setTicker] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function buyRun() {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || "Could not start checkout.");
        return;
      }
      window.location.href = data.url;
    } finally {
      setBusy(false);
    }
  }

  async function grantTestCredit() {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/dev/grant-credit", { method: "POST" });
      if (!res.ok) setErr("Could not grant test credit.");
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function startRun() {
    setErr(null);
    setBusy(true);
    try {
      const scope = mode === "field" ? { field } : { ticker: ticker.trim().toUpperCase() };
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || "Could not start the run.");
        return;
      }
      router.push(`/runs/${data.jobId}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Run Research</h2>
        <span className="badge queued" title="Available research-run credits">
          {credits} credit{credits === 1 ? "" : "s"}
        </span>
      </div>

      <label>Scope</label>
      <div className="radio-row">
        <label>
          <input type="radio" checked={mode === "field"} onChange={() => setMode("field")} />
          Sector scan
        </label>
        <label>
          <input type="radio" checked={mode === "ticker"} onChange={() => setMode("ticker")} />
          Single ticker deep-dive
        </label>
      </div>

      {mode === "field" ? (
        <>
          <label>Sector</label>
          <div className="radio-row">
            {FIELDS.map((f) => (
              <label key={f}>
                <input type="radio" checked={field === f} onChange={() => setField(f)} />
                {f}
              </label>
            ))}
          </div>
        </>
      ) : (
        <>
          <label htmlFor="ticker">Ticker</label>
          <input
            id="ticker"
            type="text"
            placeholder="e.g. NVEE"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            style={{ maxWidth: 220 }}
          />
        </>
      )}

      {err && <p className="error">{err}</p>}

      <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
        {credits > 0 ? (
          <button
            className="btn"
            onClick={startRun}
            disabled={busy || (mode === "ticker" && ticker.trim().length === 0)}
          >
            {busy ? "Starting…" : "Run Research"}
          </button>
        ) : (
          <button className="btn" onClick={buyRun} disabled={busy}>
            {busy ? "Please wait…" : "Buy a Research Run"}
          </button>
        )}
        {enableDevCredits && (
          <button className="btn secondary" onClick={grantTestCredit} disabled={busy}>
            Grant test credit (dev)
          </button>
        )}
      </div>
      <p className="disclaimer" style={{ marginTop: 16 }}>
        Each run picks ONE scope: a sector scan OR one ticker. Runs take several minutes and dozens of
        model calls. Output is automated research, not investment advice.
      </p>
    </section>
  );
}
