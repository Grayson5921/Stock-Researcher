"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || "Something went wrong.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setErr("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 420, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>{mode === "login" ? "Log in" : "Create your account"}</h1>
      <form onSubmit={submit}>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />
        {err && <p className="error">{err}</p>}
        <button className="btn" type="submit" disabled={busy} style={{ marginTop: 16, width: "100%", justifyContent: "center" }}>
          {busy ? "Please wait…" : mode === "login" ? "Log in" : "Sign up"}
        </button>
      </form>
      <p className="small muted" style={{ marginTop: 14 }}>
        {mode === "login" ? (
          <>No account? <Link href="/signup">Sign up</Link></>
        ) : (
          <>Already have an account? <Link href="/login">Log in</Link></>
        )}
      </p>
    </div>
  );
}
