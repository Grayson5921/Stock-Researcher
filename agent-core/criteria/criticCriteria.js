// The 50 best-practice criteria, organized into 5 specialist critics of 10 each.
// Each critic reviews every proposed stock ONLY against its own 10 criteria.

export const CRITICS = {
  "The Fundamentalist": {
    focus: "Financial health, profitability, and accounting quality.",
    criteria: [
      "Consistent revenue growth over 3-5 years (ideally 15%+), not one good quarter.",
      "Positive and ideally growing free cash flow (harder to fake than earnings).",
      "Debt-to-equity below ~1.0 for most sectors; smaller firms with heavy debt are fragile.",
      "Return on equity consistently above ~15%, signaling good capital deployment.",
      "Expanding gross and operating margins over time (pricing power / efficiency).",
      "A clear, understandable business model (how it makes money in two sentences).",
      "No persistent negative operating cash flow without a clear path to profitability.",
      "Stable or falling Days Sales Outstanding (receivables not outrunning revenue).",
      "Reasonable goodwill/intangibles; serial acquirers risk future write-downs.",
      "No signs of aggressive revenue recognition (booking revenue before delivery, etc.).",
    ],
  },
  "The Governance Hawk": {
    focus: "Management integrity, ownership alignment, and shareholder treatment.",
    criteria: [
      "Meaningful insider ownership (roughly 10-20%+) aligning management with shareholders.",
      "Recent insider buying (a stronger signal than ambiguous insider selling).",
      "A track record of sensible capital allocation (smart buybacks/M&A, not reckless dilution).",
      "Transparent, candid management on earnings calls, including tough questions.",
      "No troubling related-party transactions with executives, family, or affiliates.",
      "Diversified customer base; no single customer at ~30%+ of revenue.",
      "Stable or shrinking share count; no chronic dilutive secondary offerings.",
      "A clear, written-down investment thesis that survives scrutiny.",
      "Clean signals from the S-1 / prospectus for newer companies.",
      "Validation from respected small/mid-cap funds via 13F filings (corroborating, not deciding).",
    ],
  },
  "The Market Strategist": {
    focus: "Industry dynamics, competitive position, and leading demand signals.",
    criteria: [
      "Operates in a large and growing total addressable market (room to run).",
      "Benefits from durable industry tailwinds (regulation, demographics, technology waves).",
      "Not a commodity business lacking pricing power and subject to macro whims.",
      "Gaining (not losing) market share versus peers.",
      "A durable moat: switching costs, network effects, proprietary tech, or brand.",
      "Positive supply-chain signals (e.g., surging orders reported by suppliers/customers).",
      "Credible geographic or segment expansion catalysts.",
      "Rising R&D and patent activity hinting at an under-priced product pipeline.",
      "Leading indicators of growth such as aggressive, targeted hiring.",
      "Corroborating signals surfaced in SEC full-text filings (capacity expansion, record demand).",
    ],
  },
  "The Valuation Disciplinarian": {
    focus: "Whether the price paid leaves a margin of safety.",
    criteria: [
      "Reasonable EV/EBITDA in addition to P/E (cleaner across capital structures).",
      "Attractive PEG ratio (growth-adjusted valuation, not raw P/E).",
      "Not paying up purely for a 'story' with no earnings and no margin of safety.",
      "Sensible price-to-sales for pre-profit growers reinvesting heavily.",
      "Trading at or below its own 5-year historical valuation average where applicable.",
      "Sum-of-the-parts or hidden-asset value the market may be missing.",
      "Spin-off / newly-independent situations that institutions may be ignoring.",
      "Near 52-week lows for non-fundamental reasons (tax-loss selling, index rebalance).",
      "Opportunity created by broad market or sector selloffs hitting small caps harder.",
      "A defined, disciplined entry point rather than chasing.",
    ],
  },
  "The Risk Manager": {
    focus: "Position-level risk, liquidity, and quality/durability of the thesis.",
    criteria: [
      "Fits a diversified portfolio (not piling into one already-crowded sector).",
      "Some institutional ownership for coverage and liquidity support.",
      "Adequate liquidity (healthy average daily volume) to enter and exit.",
      "For subscription models, net revenue retention above ~110%.",
      "Evidence of converting one-time buyers into recurring, predictable revenue.",
      "Distinguishable as a 'broken stock' (price down, thesis intact) vs a 'broken company'.",
      "A thesis that does not depend on reacting to short-term price noise.",
      "Holds up to a quarterly thesis re-check; no material deterioration.",
      "Within an industry an informed investor can actually understand and monitor.",
      "Risk factors in the 10-K/10-Q reviewed; no disqualifying disclosed risks.",
    ],
  },
  "The Speculation Auditor": {
    focus:
      "Whether this purchase is a grounded investment or a speculative bet. " +
      "APPROVE grounded, well-supported buys; DENY when the stock is primarily speculative.",
    criteria: [
      "Profitable today, or with a clear, near-term, self-funded path to profitability — not a promise years out.",
      "Sufficient cash runway; survival does not depend on imminent capital raises.",
      "Valuation anchored in current earnings/cash flow, not almost entirely in a future-growth or TAM narrative.",
      "Diversified business; the company is not betting itself on a single unproven product, drug, or contract.",
      "Does not hinge on one binary event (FDA/PDUFA decision, a single court ruling or contract) where failure is catastrophic.",
      "Manageable volatility and drawdown history; not an extreme high-beta lottery ticket.",
      "Not heavily shorted or driven by hype/meme/social-media momentum (no crowded-speculation signature).",
      "Adequate float and liquidity; not a thin, easily-manipulated micro/penny stock.",
      "Clean financing posture — no going-concern doubt, chronic dilution, or toxic ATM/convertible reliance.",
      "Established operating history and track record; not a brand-new IPO or de-SPAC with unproven fundamentals.",
    ],
  },
  "The Technical & Timing Analyst": {
    focus:
      "Price action, momentum, and entry timing — is this a good trade to put on NOW, " +
      "not just a good company. Base judgments on actual recent price/volume data you find.",
    criteria: [
      "Price trend is constructive or basing, not in a sustained downtrend.",
      "Positive or improving relative strength versus its sector and the broad market.",
      "Not being chased into a parabolic, overextended spike (poor risk/reward entry).",
      "Healthy, confirming volume on advances; no clear distribution pattern.",
      "Trading above or reclaiming key moving averages (e.g., 50/200-day), or building a base.",
      "A definable support level and entry zone, with a sensible stop below it.",
      "Not sitting immediately before a known binary event with large gap risk (unless intended).",
      "A near-term catalyst is on the calendar (earnings, product, contract) to drive a re-rating.",
      "Volatility is not signaling panic or an imminent blow-up.",
      "Liquidity and bid/ask spread allow entering and exiting at reasonable cost.",
    ],
  },
  "The Solvency & Legal Sentinel": {
    focus:
      "Balance-sheet survival and legal/regulatory landmines — things that can blow up an " +
      "otherwise good thesis. Base judgments on filings and credible reporting you find.",
    criteria: [
      "Cash runway of several quarters at the current burn, or genuinely positive free cash flow.",
      "No near-term debt maturities it cannot plausibly refinance or cover.",
      "No going-concern qualification or expressed auditor doubt.",
      "No reliance on dilutive ATM programs or toxic convertible financing to operate.",
      "Manageable leverage and interest coverage (can service debt from operations).",
      "No material pending litigation that could impair the thesis.",
      "No active regulatory or agency investigation (SEC, DOJ, FTC, FDA, etc.).",
      "No sanctions, export-control, or compliance exposure that could disrupt operations.",
      "No recent financial restatement or disclosed material weakness in internal controls.",
      "Contingent liabilities (recalls, warranties, environmental) are disclosed and bounded.",
    ],
  },
  "The Brand Strategist": {
    focus:
      "Brand differentiation versus the competition — does the company stand apart, or is it a " +
      "commoditized me-too? Ground judgments in real evidence (reviews, share, pricing, coverage).",
    criteria: [
      "A clear, distinctive brand identity that stands apart from direct competitors — not a me-too offering.",
      "Demonstrable brand-driven pricing power or premium (customers pay more specifically for this brand).",
      "Strong brand awareness / recognition in its target market relative to rivals.",
      "High customer loyalty, repeat purchase, or low churn tied to brand preference (beyond mere switching cost).",
      "A defensible, hard-to-copy value proposition (positioning, design, ethos, community).",
      "Positive brand reputation and sentiment (reviews, ratings, NPS, testimonials) versus competitors.",
      "Consistent brand messaging and identity across channels and over time.",
      "Gaining mindshare / share of voice rather than being commoditized or losing relevance.",
      "The brand extends credibly into adjacent products or markets (room to leverage it).",
      "At least part of the moat is brand/intangible, not solely price, subsidy, or distribution.",
    ],
  },
};

// Return a formatted string of a critic's focus + numbered criteria.
export function criticBlock(name) {
  const c = CRITICS[name];
  const lines = [`Focus: ${c.focus}`, "Your 10 criteria:"];
  c.criteria.forEach((crit, i) => lines.push(`  ${i + 1}. ${crit}`));
  return lines.join("\n");
}

// Compact digest of the entire approval gauntlet, given to the RESEARCH agents
// so they hunt with the criteria in mind instead of proposing blind. Kept
// deliberately short (focus lines + hard gates) to limit token cost — the
// critics still apply their full 10 criteria independently afterward.
export function researchDigest() {
  const lines = [
    "APPROVAL GAUNTLET — every pick must clear ALL of this, so screen candidates " +
      "against it BEFORE proposing:",
    "It must be UNANIMOUSLY approved by these critics:",
  ];
  for (const [name, c] of Object.entries(CRITICS)) {
    lines.push(`- ${name}: ${c.focus}`);
  }
  lines.push(
    "Then it must have non-negative recent news flow, reach a high (80%+) " +
      "bull/bear upside-confidence forecast, and add diversification versus the " +
      "user's existing broad-market ETF + IBM holdings.",
    "So favor candidates that are ALREADY: profitable with clean accounting and " +
      "aligned management; differentiated (moat AND brand) in a growing market; " +
      "reasonably valued with a defined entry near support (not extended); liquid, " +
      "non-speculative, solvent with a dated near-term catalyst and no legal " +
      "overhang; and enjoying positive news momentum. Do not propose names that " +
      "obviously fail any of these — they will be denied and waste the panel's time."
  );
  return lines.join("\n");
}
