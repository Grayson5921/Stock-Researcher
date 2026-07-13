// Small helpers for JSON API routes: consistent responses + typed-error mapping.
import { NextResponse } from "next/server";
import { Unauthorized } from "./session";
import { NoCredit } from "./runs";
import { BudgetExceeded, ActiveRunExists } from "./budget";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}
export function error(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

// Map known error types to HTTP statuses; everything else is a 500.
export function handleError(e: unknown) {
  if (e instanceof Unauthorized) return error("Not signed in.", 401);
  if (e instanceof NoCredit) return error(e.message, 402);
  if (e instanceof ActiveRunExists) return error(e.message, 409);
  if (e instanceof BudgetExceeded) return error(e.message, 503);
  const msg = e instanceof Error ? e.message : "Unexpected error.";
  console.error("API error:", msg);
  return error(msg, 500);
}
