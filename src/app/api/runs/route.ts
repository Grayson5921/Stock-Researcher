import { requireUser } from "@/lib/session";
import { scopeSchema } from "@/lib/validation";
import { createRun } from "@/lib/runs";
import { rateLimit } from "@/lib/rateLimit";
import { query } from "@/lib/db";
import { json, error, handleError } from "@/lib/http";

// Create a research run (requires an available paid credit).
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { allowed } = await rateLimit(`runs:${user.id}`, 30, 3600);
    if (!allowed) return error("Rate limit exceeded. Slow down.", 429);

    const body = await req.json().catch(() => ({}));
    const parsed = scopeSchema.safeParse(body.scope ?? body);
    if (!parsed.success) {
      return error(parsed.error.issues[0]?.message || "Invalid scope.", 422);
    }
    const { jobId } = await createRun(user.id, parsed.data);
    return json({ jobId }, 201);
  } catch (e) {
    return handleError(e);
  }
}

// List the user's recent runs.
export async function GET() {
  try {
    const user = await requireUser();
    const rows = await query(
      `SELECT id, kind, status, scope, cost_usd, created_at, finished_at
         FROM jobs WHERE user_id = $1 AND kind = 'run'
        ORDER BY created_at DESC LIMIT 50`,
      [user.id]
    );
    return json({ runs: rows });
  } catch (e) {
    return handleError(e);
  }
}
