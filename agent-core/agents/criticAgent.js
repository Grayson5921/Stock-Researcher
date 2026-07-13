// Critic agent: reviews a proposed stock ONLY against its own 10 criteria and
// returns approve/deny. Skeptical by default, but updates its view when a
// researcher presents a sound rebuttal with new evidence.
import { BaseAgent } from "./baseAgent.js";
import { makeVerdict } from "./models.js";
import { criticBlock } from "../criteria/criticCriteria.js";
import { config } from "../config.js";

export class CriticAgent extends BaseAgent {
  constructor(client, model, criticName, effort = undefined) {
    super(client, model, criticName, effort);
    this.criteriaBlock = criticBlock(criticName);
  }

  _system() {
    return (
      `You are '${this.name}', a hard-nosed equity investment critic. ` +
      "You evaluate a proposed low/mid-cap stock STRICTLY against your own 10 criteria " +
      "below and nothing else.\n\n" +
      `${this.criteriaBlock}\n\n` +
      "Rules:\n" +
      "- Judge only against YOUR criteria; ignore concerns outside your remit.\n" +
      "- Be skeptical. Do not approve on hype. If evidence for a criterion is missing, " +
      "treat it as not-yet-met and explain what you'd need to see.\n" +
      "- You are NOT a yes-man and NOT a contrarian-for-its-own-sake. Approve when the " +
      "evidence genuinely satisfies enough of your criteria; deny when it does not.\n" +
      "- You may use general knowledge but never invent specific financials. If you lack " +
      "data for a criterion, say so rather than assuming the best case.\n" +
      "- A few unmet criteria can be acceptable; a stock fails when the unmet ones are " +
      "material to your focus area.\n\n" +
      config.GROUNDING
    );
  }

  _stockText(stock, extra = "") {
    const arts =
      stock.articles.map((a) => `  - ${a.title} | ${a.url}\n    ${a.summary}`).join("\n") ||
      "  (none provided)";
    const cats = stock.catalysts.map((c) => `  - ${c}`).join("\n") || "  (none provided)";
    const prior = stock.priorInteraction
      ? `\nRE-SUBMISSION NOTE: ${stock.priorInteraction}\nEvaluate FRESH on today's evidence; the analyst is re-arguing it. Do not rubber-stamp, but do not hold an old grudge if the concern is genuinely addressed now.\n`
      : "";
    const md = stock.marketData ? `\n${stock.marketData}\n` : "";
    return (
      `TICKER: ${stock.ticker}\nCOMPANY: ${stock.company}\nFIELD: ${stock.field}\n` +
      `RESEARCH THESIS:\n${stock.thesis}\n\nCLAIMED CATALYSTS:\n${cats}\n\n` +
      `SUPPORTING ARTICLES:\n${arts}\n${md}${prior}${extra}`
    );
  }

  async review(stock, roundNo = 1) {
    const prompt =
      "Review this stock against your 10 criteria.\n\n" +
      this._stockText(stock) +
      '\n\nRespond in COMPACT JSON. In "passed"/"failed" use SHORT keyword labels ' +
      '(3-6 words each), NOT full sentences. Keep "reasoning" to 2-3 sentences:\n' +
      '{"approved": true|false, "passed": ["short label"], "failed": ["short label"], ' +
      '"reasoning": "2-3 sentences"}';
    try {
      const data = await this.callJson(this._system(), prompt, { maxTokens: 3000 });
      return this._toVerdict(data, roundNo);
    } catch (e) {
      return this._fallbackVerdict(roundNo, e);
    }
  }

  async reReview(stock, argument, newEvidence, roundNo) {
    const ev =
      newEvidence.map((a) => `  - ${a.title} | ${a.url}\n    ${a.summary}`).join("\n") ||
      "  (none)";
    const extra =
      `\n\n--- THE RESEARCH ANALYST IS REBUTTING YOUR DENIAL ---\n` +
      `ARGUMENT:\n${argument}\n\nNEW EVIDENCE PRESENTED:\n${ev}\n`;
    const prompt =
      "You previously denied this stock. The analyst has pushed back with the argument " +
      "and new evidence below. Re-evaluate honestly against your 10 criteria. Change your " +
      "verdict ONLY if the new information genuinely addresses your concerns. Hold firm if " +
      "it does not.\n\n" +
      this._stockText(stock, extra) +
      '\n\nRespond in COMPACT JSON with SHORT keyword labels (not sentences) in ' +
      '"passed"/"failed" and 2-3 sentence "reasoning":\n' +
      '{"approved": true|false, "passed": ["short label"], "failed": ["short label"], ' +
      '"reasoning": "what changed your mind or why you hold firm"}';
    try {
      const data = await this.callJson(this._system(), prompt, { maxTokens: 3000 });
      return this._toVerdict(data, roundNo);
    } catch (e) {
      return this._fallbackVerdict(roundNo, e);
    }
  }

  // If the model response can't be parsed even after a retry, fail safe: treat
  // as a DENY (never a false approval) so one bad reply can't crash the run.
  _fallbackVerdict(roundNo, err) {
    console.warn(`      [warn] ${this.name}: unparseable response (${err.message.slice(0, 60)}). Treating as deny.`);
    return makeVerdict({
      criticName: this.name,
      approved: false,
      passed: [],
      failed: ["response unparseable"],
      reasoning: "Could not parse this critic's response; treated as a denial.",
      round: roundNo,
    });
  }

  _toVerdict(data, roundNo) {
    data = data || {};
    return makeVerdict({
      criticName: this.name,
      approved: Boolean(data.approved),
      passed: (data.passed || []).filter(Boolean),
      failed: (data.failed || []).filter(Boolean),
      reasoning: data.reasoning || "",
      round: roundNo,
    });
  }
}
