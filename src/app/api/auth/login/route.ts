import { one } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSession } from "@/lib/session";
import { emailSchema } from "@/lib/validation";
import { rateLimit } from "@/lib/rateLimit";
import { json, error, handleError } from "@/lib/http";

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const { allowed } = await rateLimit(`login:${ip}`, 20, 900);
    if (!allowed) return error("Too many attempts. Try again later.", 429);

    const body = await req.json().catch(() => ({}));
    const email = emailSchema.safeParse(body.email);
    if (!email.success || typeof body.password !== "string") {
      return error("Invalid email or password.", 401);
    }
    const user = await one<{ id: string; password_hash: string }>(
      "SELECT id, password_hash FROM users WHERE email = $1",
      [email.data.toLowerCase()]
    );
    // Constant-ish path: always run a compare to reduce user-enumeration timing.
    const hash = user?.password_hash || "$2a$10$0000000000000000000000000000000000000000000000000000";
    const ok = await verifyPassword(body.password, hash);
    if (!user || !ok) return error("Invalid email or password.", 401);

    await createSession(user.id);
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
