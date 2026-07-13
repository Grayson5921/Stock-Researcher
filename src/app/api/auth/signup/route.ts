import { pool, one } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createSession } from "@/lib/session";
import { emailSchema, passwordSchema } from "@/lib/validation";
import { rateLimit } from "@/lib/rateLimit";
import { json, error, handleError } from "@/lib/http";

export async function POST(req: Request) {
  try {
    const { allowed } = await rateLimit(`signup:${ipOf(req)}`, 10, 3600);
    if (!allowed) return error("Too many sign-up attempts. Try again later.", 429);

    const body = await req.json().catch(() => ({}));
    const email = emailSchema.safeParse(body.email);
    const password = passwordSchema.safeParse(body.password);
    if (!email.success) return error("Enter a valid email.", 422);
    if (!password.success) return error("Password must be at least 8 characters.", 422);

    const existing = await one<{ id: string }>("SELECT id FROM users WHERE email = $1", [
      email.data.toLowerCase(),
    ]);
    if (existing) return error("An account with that email already exists.", 409);

    const hash = await hashPassword(password.data);
    const row = await one<{ id: string }>(
      "INSERT INTO users(email, password_hash) VALUES ($1, $2) RETURNING id",
      [email.data.toLowerCase(), hash]
    );
    await createSession(row!.id);
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}

function ipOf(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
