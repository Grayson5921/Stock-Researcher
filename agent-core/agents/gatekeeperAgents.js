// Cheap gatekeepers that run BEFORE the expensive 9-critic panel:
// - PreScreenAgent: one inexpensive call asking "does this obviously fail the
//   gauntlet?" Badly-aimed candidates die for pennies instead of dollars.
// - VerifierAgent: fact-checks the researcher's load-bearing claims via a small
//   web search, killing hallucinated catalysts before they poison the panel.
// Both fail OPEN on errors (let the stock proceed) so a glitch can't block a
// good candidate; only a confident negative verdict rejects.
import { config } from "../config.js";
import { BaseAgent } from "./baseAgent.js";
import { researchDigest } from "../criteria/criticCriteria.js";

export class PreScreenAgent extends BaseAgent {
  constructor(client) {
    super(client, config.GATEKEEPER_MODEL, "Pre-Screener", null); // no effort param for Haiku
  }
  // Returns { pass: bool, reason }
  async screen(stock) {
    const sys =
      "You are a fast pre-screener for a strict stock-approval gauntlet. Your ONLY " +
      "job is to catch candidates that OBVIOUSLY fail — clear disqualifiers like " +
      "being far outside the market-cap range, unprofitable with no path, blatantly " +
      "speculative, or plainly contradicting the criteria below. When in doubt, PASS " +
      "it through — the full panel makes the real decision.\n\n" + researchDigest();
    const user =
      `Candidate:\nTICKER: ${stock.ticker}\nCOMPANY: ${stock.company}\n` +
      `THESIS: ${stock.thesis}\nCATALYSTS: ${stock.catalysts.join("; ")}\n` +
      (stock.marketData ? `\n${stock.marketData}\n` : "") +
      '\nRespond in JSON: {"obviousFail": true|false, "reason": "one sentence"}';
    try {
      const d = await this.callJson(sys, user, { maxTokens: 500 });
      return { pass: !d.obviousFail, reason: d.reason || "" };
    } catch (e) {
      console.warn(`      [warn] pre-screen error: ${String(e.message || e).slice(0, 120)}`);
      return { pass: true, reason: "pre-screen unavailable (failed open)" };
    }
  }
}

export class VerifierAgent extends BaseAgent {
  constructor(client) {
    super(client, config.GATEKEEPER_MODEL, "Claim Verifier", null); // no effort param for Haiku
  }
  // Returns { pass: bool, reason, checked: [] }
  async verify(stock) {
    const sys =
      "You are a fact-checker. The research analyst below claims specific catalysts " +
      "for a stock. Verify the 2-3 MOST load-bearing claims via web search (does the " +
      "grant/contract/earnings-beat actually exist and match the company?). You are " +
      "checking FACTS, not judging the investment. Fabricated or unsupported core " +
      "claims = fail. Claims that check out, or are merely imprecise = pass. " +
      "If you cannot verify either way, pass with a note. " + config.GROUNDING;
    const user =
      `TICKER: ${stock.ticker} (${stock.company})\nTHESIS: ${stock.thesis}\n` +
      `CLAIMED CATALYSTS:\n${stock.catalysts.map((c) => "- " + c).join("\n")}\n` +
      `CITED SOURCES:\n${stock.articles.map((a) => `- ${a.title}: ${a.url}`).join("\n") || "(none)"}\n` +
      '\nFinish with ONLY JSON: {"fabricated": true|false, "reason": "one sentence", ' +
      '"checked": ["claim -> verified|unverified|false"]}';
    try {
      const tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }];
      const raw = await this.callText(sys, user, { tools, maxTokens: 1500 });
      const d = BaseAgent.parseJson(raw);
      return { pass: !d.fabricated, reason: d.reason || "", checked: d.checked || [] };
    } catch (e) {
      console.warn(`      [warn] verifier error: ${String(e.message || e).slice(0, 120)}`);
      return { pass: true, reason: "verifier unavailable (failed open)", checked: [] };
    }
  }
}
