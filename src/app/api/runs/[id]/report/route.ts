import { requireUser, Unauthorized } from "@/lib/session";
import { one } from "@/lib/db";

// Download the full plain-text report for a run (owner only).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const r = await one<{ body_text: string; created_at: string }>(
      `SELECT rep.body_text, rep.created_at
         FROM reports rep JOIN jobs j ON j.id = rep.job_id
        WHERE rep.job_id = $1 AND j.user_id = $2
        ORDER BY rep.created_at DESC LIMIT 1`,
      [params.id, user.id]
    );
    if (!r) return new Response("Not found", { status: 404 });
    const date = new Date(r.created_at).toISOString().slice(0, 10);
    return new Response(r.body_text, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="nine-critics-report-${date}.txt"`,
      },
    });
  } catch (e) {
    if (e instanceof Unauthorized) return new Response("Not signed in", { status: 401 });
    return new Response("Error", { status: 500 });
  }
}
