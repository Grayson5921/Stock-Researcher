import { z } from "zod";

// The three sector scans the research agents cover.
export const FIELDS = ["technology", "business", "energy"] as const;
export type Field = (typeof FIELDS)[number];

// US-listed ticker shape (1-5 letters, optional .X class suffix). Validated here
// before any spend; the worker additionally verifies via market data.
export const TICKER_RE = /^[A-Z]{1,5}(\.[A-Z])?$/;

export const emailSchema = z.string().email().max(320);
export const passwordSchema = z.string().min(8).max(200);

// Exactly one of { field } or { ticker }.
export const scopeSchema = z
  .object({
    field: z.enum(FIELDS).optional(),
    ticker: z
      .string()
      .trim()
      .toUpperCase()
      .regex(TICKER_RE, "Invalid ticker symbol")
      .optional(),
  })
  .refine((s) => !!s.field !== !!s.ticker, {
    message: "Choose exactly one scope: a sector field OR a single ticker.",
  });

export type Scope = z.infer<typeof scopeSchema>;
