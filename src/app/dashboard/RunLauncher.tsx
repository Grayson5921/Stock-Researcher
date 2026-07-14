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
  const [mode, setMode] = useState<"field" | "ticker" | "custom">("field");
  const [field, setField] = useState<(typeof FIELDS)[number]>("technology");
  const [ticker, setTicker] = useState("");
  const [custom, setCustom] = useState("");
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
      const scope =
        mode === "field"
          ? { field }
          : mode === "ticker"
            ? { ticker: ticker.trim().toUpperCase() }
            : { custom: custom.trim() };
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
            <label>
              <input type="radio" checked={mode === "custom"} onChange={() => setMode("custom")} />
              Custom focus
            </label>
          </div>

          {mode === "field" && (
            <>
              <label>Sector <span className="muted small">(recommended)</span></label>
              <div className="radio-row">
                {FIELDS.map((f) => (
                  <label key={f}>
                    <input type="radio" checked={field === f} onChange={() => setField(f)} />
                    {f}
                  </label>
                ))}
              </div>
            </>
          )}
          {mode === "ticker" && (
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
          {mode === "custom" && (
            <>
              <label htmlFor="custom">Your research focus</label>
              <input
                id="custom"
                type="text"
                placeholder='e.g. "healthcare AI companies" or "defense suppliers"'
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                maxLength={120}
                style={{ maxWidth: 460 }}
              />
              <p className="muted small" style={{ margin: "6px 0 0" }}>
                8–120 characters. The panel still hunts low/mid-cap ($300M–$20B) stocks within your
                focus and applies the same nine-critic gauntlet.
              </p>
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
            disabled={
              busy ||
              (mode === "ticker" && ticker.trim().length === 0) ||
              (mode === "custom" && custom.trim().length < 8)
            }
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
        Each run picks ONE scope: a sector scan, one ticker, or your own custom focus. Runs take
        several minutes and dozens of model calls. Every run delivers a full written report — including
        when nothing passes the gauntlet, which documents every candidate and why. Output is automated
        research, not investment advice.
      </p>
    </section>
  );
}
