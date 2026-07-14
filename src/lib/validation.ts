import { z } from "zod";

// The three sector scans the research agents cover.
export const FIELDS = ["technology", "business", "energy"] as const;
export type Field = (typeof FIELDS)[number];

// US-listed ticker shape (1-5 letters, optional .X class suffix). Validated here
// before any spend; the worker additionally verifies via market data.
export const TICKER_RE = /^[A-Z]{1,5}(\.[A-Z])?$/;

export const emailSchema = z.string().email().max(320);
export const passwordSchema = z.string().min(8).max(200);

// Free-text custom research focus (e.g. "healthcare AI companies").
// Plain text only, bounded length — validated again in the agent core.
export const CUSTOM_FOCUS_RE = /^[\w\s.,&()'+\/:-]{8,120}$/;

// Exactly one of { field }, { ticker }, or { custom }.
export const scopeSchema = z
  .object({
    field: z.enum(FIELDS).optional(),
    ticker: z
      .string()
      .trim()
      .toUpperCase()
      .regex(TICKER_RE, "Invalid ticker symbol")
      .optional(),
    custom: z
      .string()
      .trim()
      .transform((s) => s.replace(/\s+/g, " "))
      .pipe(z.string().regex(CUSTOM_FOCUS_RE, "Custom focus must be 8-120 characters of plain text"))
      .optional(),
  })
  .refine((s) => [s.field, s.ticker, s.custom].filter(Boolean).length === 1, {
    message: "Choose exactly one scope: a sector, a single ticker, or a custom focus.",
  });

export type Scope = z.infer<typeof scopeSchema>;
