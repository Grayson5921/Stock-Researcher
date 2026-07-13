// Session auth. A random opaque token is stored in the `sessions` table; the
// cookie carries `${token}.${hmac(token)}` (httpOnly) so tampered/garbage cookies
// are rejected before any DB lookup. Cookie work happens in Route Handlers /
// Server Actions where next/headers cookies() is writable.
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { pool, one } from "./db";
import { env } from "./env";

export const SESSION_COOKIE = "sr_session";
const SESSION_TTL_DAYS = 30;

function sign(token: string): string {
  const mac = crypto.createHmac("sha256", env.SESSION_SECRET).update(token).digest("base64url");
  return `${token}.${mac}`;
}
function unsign(value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const token = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  const expected = crypto.createHmac("sha256", env.SESSION_SECRET).update(token).digest("base64url");
  if (mac.length !== expected.length) return null;
  const ok = crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
  return ok ? token : null;
}

export interface SessionUser {
  id: string;
  email: string;
}

// Create a session for userId and set the cookie. Returns the token.
export async function createSession(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 864e5);
  await pool.query(
    "INSERT INTO sessions(id, user_id, expires_at) VALUES ($1, $2, $3)",
    [token, userId, expires]
  );
  cookies().set(SESSION_COOKIE, sign(token), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
    path: "/",
    expires,
  });
  return token;
}

export async function destroySession(): Promise<void> {
  const raw = cookies().get(SESSION_COOKIE)?.value;
  const token = unsign(raw);
  if (token) await pool.query("DELETE FROM sessions WHERE id = $1", [token]);
  cookies().delete(SESSION_COOKIE);
}

// Resolve the current user from the cookie, or null. Also lazily clears expired
// sessions it encounters.
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = unsign(cookies().get(SESSION_COOKIE)?.value);
  if (!token) return null;
  const row = await one<{ id: string; email: string; expires_at: string }>(
    `SELECT u.id, u.email, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1`,
    [token]
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await pool.query("DELETE FROM sessions WHERE id = $1", [token]);
    return null;
  }
  return { id: row.id, email: row.email };
}

// For API routes: throw a typed 401 sentinel if not authenticated.
export class Unauthorized extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "Unauthorized";
  }
}
export async function requireUser(): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) throw new Unauthorized();
  return u;
}
