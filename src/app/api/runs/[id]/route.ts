import { requireUser } from "@/lib/session";
import { one } from "@/lib/db";
import { json, error, handleError } from "@/lib/http";

// Status + progress events (+ report when done) for one run, scoped to the owner.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const jobRow = await one<any>(
      `SELECT id, kind, status, scope, profile, progress_events, cost_usd, error,
              created_at, started_at, finished_at
         FROM jobs WHERE id = $1 AND user_id = $2`,
      [params.id, user.id]
    );
    if (!jobRow) return error("Run not found.", 404);

    let report: string | null = null;
    let reportData: unknown = null;
    if (jobRow.status === "done") {
      const r = await one<{ body_text: string; body_json: unknown }>(
        "SELECT body_text, body_json FROM reports WHERE job_id = $1 ORDER BY created_at DESC LIMIT 1",
        [params.id]
      );
      report = r?.body_text ?? null;
      reportData = r?.body_json ?? null;
    }
    return json({ job: jobRow, report, reportData });
  } catch (e) {
    return handleError(e);
  }
}
