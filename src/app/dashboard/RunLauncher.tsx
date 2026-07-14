"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const FIELDS = ["technology", "business", "energy"] as const;
const PACKS = [1, 3, 5, 10] as const;

export default function RunLauncher({
  credits,
  priceCents,
  enableDevCredits,
}: {
  credits: number;
  priceCents: number;
  enableDevCredits: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"field" | "ticker">("field");
  const [field, setField] = useState<(typeof FIELDS)[number]>("technology");
  const [ticker, setTicker] = useState("");
  const [pack, setPack] = useState<(typeof PACKS)[number]>(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

  async function buyCredits() {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quantity: pack }),
      });
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

      {credits > 0 && (
        <>
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
        </>
      )}

      <label>{credits > 0 ? "Buy more credits" : "Buy research credits"}</label>
      <div className="radio-row">
        {PACKS.map((p) => (
          <label key={p}>
            <input type="radio" checked={pack === p} onChange={() => setPack(p)} />
            {p} run{p === 1 ? "" : "s"} — {dollars(priceCents * p)}
          </label>
        ))}
      </div>

      {err && <p className="error">{err}</p>}

      <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
        {credits > 0 && (
          <button
            className="btn"
            onClick={startRun}
            disabled={busy || (mode === "ticker" && ticker.trim().length === 0)}
          >
            {busy ? "Working…" : "Run Research"}
          </button>
        )}
        <button className={credits > 0 ? "btn secondary" : "btn"} onClick={buyCredits} disabled={busy}>
          {busy ? "Working…" : `Buy ${pack} credit${pack === 1 ? "" : "s"} (${dollars(priceCents * pack)})`}
        </button>
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
