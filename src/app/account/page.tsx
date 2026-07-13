import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { countPaidCredits } from "@/lib/credits";
import { one } from "@/lib/db";
import LogoutButton from "@/components/LogoutButton";

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [credits, sub] = await Promise.all([
    countPaidCredits(user.id),
    one<{ tier: string; status: string; current_period_end: string | null }>(
      "SELECT tier, status, current_period_end FROM subscriptions WHERE user_id = $1",
      [user.id]
    ),
  ]);

  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>Account</h1>
      <section className="card stack">
        <div><strong>Email</strong><div className="muted">{user.email}</div></div>
        <div><strong>Research-run credits</strong><div className="muted">{credits} available</div></div>
        <div>
          <strong>Daily Monitor subscription</strong>
          <div className="muted">
            {sub ? `${sub.tier} · ${sub.status}` : "None (subscriptions arrive in Phase 2)."}
          </div>
        </div>
      </section>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Billing</h2>
        <p className="muted small">
          One-time Research Runs are billed through Stripe Checkout from the dashboard. The Stripe
          customer portal and subscription management land with the Daily Monitor in Phase 2.
        </p>
        <LogoutButton />
      </section>
    </div>
  );
}
