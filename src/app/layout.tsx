import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { DISCLAIMER_SHORT } from "@/lib/pricing";
import LogoutButton from "@/components/LogoutButton";

export const metadata: Metadata = {
  title: "Stock Researcher — automated multi-agent research",
  description:
    "An automated multi-agent stock research tool. Not investment advice.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="en">
      <body>
        <header className="header">
          <div className="container">
            <Link href="/" className="brand">📈 Stock Researcher</Link>
            <nav>
              {user ? (
                <>
                  <Link href="/dashboard">Dashboard</Link>
                  <Link href="/account">Account</Link>
                  <LogoutButton />
                </>
              ) : (
                <>
                  <Link href="/#pricing">Pricing</Link>
                  <Link href="/login">Log in</Link>
                  <Link href="/signup" className="btn" style={{ padding: "6px 12px" }}>Sign up</Link>
                </>
              )}
            </nav>
          </div>
        </header>
        <main className="container" style={{ paddingTop: 28 }}>{children}</main>
        <footer className="footer">
          <div className="container">
            <p><strong>Disclaimer.</strong> {DISCLAIMER_SHORT}</p>
            <p>
              This is an automated research tool, not investment advice, and creates no fiduciary
              relationship. A securities attorney should review positioning before any launch.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
