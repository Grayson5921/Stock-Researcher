import { env } from "./env";

// Product pricing/framing constants used by the UI + checkout.
export const PRICING = {
  researchRun: {
    cents: env.RESEARCH_RUN_PRICE_CENTS,
    label: "Research Run",
    blurb: "One-time deep research run: one sector scan or one ticker deep-dive.",
  },
  monitorTiers: [
    { id: "base", name: "Base", cents: 750, positions: 5, blurb: "Daily monitor, up to 5 positions." },
    { id: "plus", name: "Plus", cents: 1500, positions: 15, blurb: "Daily monitor, up to 15 positions." },
    { id: "pro", name: "Pro", cents: 3000, positions: 40, blurb: "Deeper analysis, up to 40 positions." },
  ],
} as const;

export const DISCLAIMER_SHORT =
  "Automated research tool — NOT investment advice. Outputs may be wrong. Verify everything and you are solely responsible for any trades.";
