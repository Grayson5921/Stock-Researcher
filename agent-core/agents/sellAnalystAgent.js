// Sell-side analyst: re-evaluates a HELD position daily and recommends
// HOLD / TRIM / SELL / ADD. It is the buy gauntlet's mirror: instead of "is
// this worth buying", it asks "is the reason we own this still true, and is
// the price telling us anything the thesis doesn't?"
// Guardrails against the classic mistakes: it is explicitly told not to
// anchor on the entry price, not to punish an intact thesis for a red day,
// and not to reward a broken thesis for a green one.
import { config } from "../config.js";
import { BaseAgent } from "./baseAgent.js";

export class SellAnalystAgent extends BaseAgent {
  constructor(client) {
    super(client, config.MODEL, "Sell Analyst");
  }

  _system() {
    return (
      "You are a disciplined sell-side portfolio analyst. You re-evaluate one HELD " +
      "position and recommend exactly one action: HOLD, TRIM, SELL, or ADD.\n" +
      "Principles:\n" +
      "- Thesis first: sell when the ORIGINAL thesis is broken or completed, not " +
      "merely because the price moved. A drawdown with an intact thesis can be a " +
      "HOLD or ADD; a rally on hype unrelated to the thesis can be a TRIM.\n" +
      "- The entry price is the holder's anchor, not the market's. Judge forward " +
      "prospects from TODAY's price.\n" +
      "- Respect hard risk flags: a breached stop or a clearly broken/expired " +
      "catalyst weighs heavily toward SELL.\n" +
      "- Target discipline: at or beyond the bull target, favor TRIM/SELL unless " +
      "genuinely new evidence extends the thesis.\n" +
      "- Be decisive and honest; do not default to HOLD out of indecision.\n" +
      config.GROUNDING
    );
  }

  // context: { entry, price, returnPct, targets, flags, priorVerdicts }
  async assess(holding, context) {
    const prompt =
      `POSITION: ${holding.ticker} (${holding.company})\n` +
      `ORIGINAL THESIS (why it was bought):\n${holding.thesis || "(not recorded)"}\n` +
      `ORIGINAL CATALYSTS:\n${(holding.catalysts || []).map((c) => "- " + c).join("\n") || "(none)"}\n` +
      `APPROVED: ${String(holding.approvedAt || "").slice(0, 10)} at ${context.entry ?? "n/a"}\n\n` +
      `TODAY:\n${context.marketText || "(live market data unavailable)"}\n` +
      `Return since entry: ${context.returnPct == null ? "n/a" : context.returnPct.toFixed(1) + "%"}\n` +
      `Targets from the original simulation: bull +${context.targets?.upside ?? "?"}% / bear ${context.targets?.downside ?? "?"}% ` +
      `(expected ${context.targets?.expectedReturn ?? "?"}%, confidence ${context.targets?.netUpside ?? "?"}%)\n` +
      `RULE FLAGS: ${context.flags.length ? context.flags.join("; ") : "none"}\n` +
      (context.priorVerdicts ? `Recent monitor verdicts: ${context.priorVerdicts}\n` : "") +
      "\nSearch the web for the latest news, results, and developments on this company " +
      "since approval. Re-test the thesis against what you find.\n\n" +
      "Finish with ONLY this JSON:\n" +
      '{"action":"HOLD|TRIM|SELL|ADD","confidence":0-100,"thesisIntact":true|false,' +
      '"catalystStatus":"pending|fired|expired|broken","keyDevelopments":["..."],' +
      '"reasoning":"3-5 sentences"}';
    const tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }];
    try {
      const raw = await this.callText(this._system(), prompt, { tools, maxTokens: 2500 });
      const d = BaseAgent.parseJson(raw);
      const action = ["HOLD", "TRIM", "SELL", "ADD"].includes((d.action || "").toUpperCase())
        ? d.action.toUpperCase() : "HOLD";
      return {
        action,
        confidence: Math.max(0, Math.min(100, Number(d.confidence) || 50)),
        thesisIntact: d.thesisIntact !== false,
        catalystStatus: d.catalystStatus || "pending",
        keyDevelopments: (d.keyDevelopments || []).filter(Boolean).slice(0, 5),
        reasoning: d.reasoning || "",
      };
    } catch (e) {
      console.warn(`      [warn] sell analyst error: ${String(e.message || e).slice(0, 100)}`);
      return {
        action: "HOLD", confidence: 0, thesisIntact: true, catalystStatus: "pending",
        keyDevelopments: [], reasoning: "Analyst unavailable; defaulting to HOLD — re-run later.",
      };
    }
  }
}
