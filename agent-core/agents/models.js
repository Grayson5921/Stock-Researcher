// Shared data structures passed between agents and the orchestrator.
// Plain objects with small factory/helper functions (no classes needed).

export function makeArticle(title = "", url = "", summary = "") {
  return { title, url, summary };
}

export function makeProposal({
  ticker,
  company,
  field,
  thesis = "",
  catalysts = [],
  articles = [],
  proposedBy = "",
}) {
  return { ticker, company, field, thesis, catalysts, articles, proposedBy };
}

export function shortName(stock) {
  return `${stock.ticker} (${stock.company})`;
}

export function makeVerdict({
  criticName,
  approved,
  passed = [],
  failed = [],
  reasoning = "",
  round = 1,
}) {
  return { criticName, approved, passed, failed, reasoning, round };
}

// One researcher response to a denying critic: action is "rebut" or "concede".
export function makeDebateTurn({ criticName, action, argument = "", newEvidence = [] }) {
  return { criticName, action, argument, newEvidence };
}

export function makeReview(stock) {
  return {
    stock,
    verdicts: [], // all verdicts across rounds
    debateLog: [], // DebateTurn[]
    simulation: null, // { bull, bear, netUpside, expectedReturn, riskReward, passed }
    news: null, // { sentimentScore, label, positives, negatives, summary }
    portfolio: null, // { fitScore, verdict, overlap, reasoning }
    rejectReason: "", // human-readable reason if not approved
    finalStatus: "PENDING", // APPROVED / REJECTED
    approvals: 0,
  };
}

// Most recent verdict per critic.
export function latestVerdicts(review) {
  const latest = new Map();
  for (const v of review.verdicts) {
    const cur = latest.get(v.criticName);
    if (!cur || v.round >= cur.round) latest.set(v.criticName, v);
  }
  return [...latest.values()];
}
