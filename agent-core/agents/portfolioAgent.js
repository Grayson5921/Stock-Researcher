// Portfolio-fit agent: judges whether a finally-approved pick adds genuine
// diversification to the user's CURRENT holdings or just piles into exposure
// they already have. Runs only on stocks that passed every gate.
import { config } from "../config.js";
import { BaseAgent } from "./baseAgent.js";

export class PortfolioAgent extends BaseAgent {
  constructor(client, model, effort = undefined) {
    super(client, model, "Portfolio Fit Agent", effort);
  }

  _holdingsText() {
    return (config.HOLDINGS || [])
      .map((h) => {
        const id = h.ticker ? `${h.ticker} (${h.name || h.ticker})` : h.name;
        return `- ${id}${h.weight ? `, ${h.weight}` : ""}${h.note ? ` — ${h.note}` : ""}`;
      })
      .join("\n");
  }

  _system() {
    return (
      "You are a portfolio construction advisor. You assess how a candidate stock fits " +
      "alongside an investor's EXISTING holdings: sector and factor overlap, correlation, " +
      "and whether it adds diversification or concentrates exposure they already have.\n\n" +
      config.GROUNDING
    );
  }

  async assess(stock) {
    const prompt =
      `The investor already holds:\n${this._holdingsText()}\n\n` +
      "Note: broad-market index funds already contain almost every US stock, so a new " +
      "single-stock pick adds CONCENTRATED exposure on top of the index. Judge whether " +
      `${stock.ticker} (${stock.company}) meaningfully diversifies this portfolio or ` +
      "doubles down on existing tilts (e.g., overlap with IBM's IT/tech exposure).\n\n" +
      `Sector/business of the pick (from research): ${stock.thesis}\n\n` +
      "Finish with ONLY this JSON (nothing after it):\n" +
      '{"fitScore": <0-100, higher = better diversifier>, ' +
      '"verdict": "diversifying|neutral|overlapping", ' +
      '"overlap": "what existing exposure it overlaps with", ' +
      '"reasoning": "2-3 sentences on portfolio fit and sizing"}';

    let data;
    try {
      data = await this.callJson(this._system(), prompt, { maxTokens: 1200 });
    } catch (e) {
      console.warn(`      [warn] ${this.name}: unparseable fit (${e.message.slice(0, 50)}).`);
      data = {};
    }

    let fit = Number(data.fitScore);
    if (!Number.isFinite(fit)) fit = 50;
    fit = Math.max(0, Math.min(100, Math.round(fit)));

    return {
      fitScore: fit,
      verdict: data.verdict || "neutral",
      overlap: data.overlap || "unknown",
      reasoning: data.reasoning || "",
    };
  }
}
