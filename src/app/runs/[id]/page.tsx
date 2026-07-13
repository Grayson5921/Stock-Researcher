import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { one } from "@/lib/db";
import RunView from "./RunView";

export default async function RunPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const job = await one<{ id: string }>(
    "SELECT id FROM jobs WHERE id = $1 AND user_id = $2",
    [params.id, user.id]
  );
  if (!job) notFound();

  return <RunView jobId={params.id} />;
}
