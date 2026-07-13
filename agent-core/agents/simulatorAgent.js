// Scenario simulator: a forward-looking agent that forecasts a stock's price
// direction over a horizon by reasoning about CURRENT and ANTICIPATED business
// and world events. Two instances are used as an adversarial ensemble:
//   - "bull": hunts aggressively for reasons the stock will rise
//   - "bear": hunts aggressively for reasons the stock will fall
// Each still outputs an HONEST, calibrated probability-of-increase so the two
// estimates can be averaged into a net upside confidence.
import { config } from "../config.js";
import { BaseAgent } from "./baseAgent.js";
import { makeArticle } from "./models.js";

export class SimulatorAgent extends BaseAgent {
  constructor(client, model, stance, effort = undefined) {
    // stance: "bull" | "bear"
    super(
      client,
      model,
      stance === "bull" ? "Bull Scenario Simulator" : "Bear Scenario Simulator",
      effort
    );
    this.stance = stance;
  }

  _system() {
    const lens =
      this.stance === "bull"
        ? "Your analytical lens is BULLISH: you hunt aggressively for reasons this stock " +
          "will RISE — positive catalysts, favorable macro and policy shifts, sector " +
          "tailwinds, and underappreciated strengths — and you stress-test the bear case " +
          "to see whether it really holds."
        : "Your analytical lens is BEARISH: you hunt aggressively for reasons this stock " +
          "will FALL — deteriorating fundamentals, macro and geopolitical risks, sector " +
          "headwinds, competitive threats, and overvaluation — and you stress-test the " +
          "bull case to see whether it really holds.";
    return (
      `You are the ${this.name}, a forward-looking scenario simulator for equities. ` +
      `Over a roughly ${config.SIMULATION_HORIZON} horizon you forecast where this ` +
      "low/mid-cap stock's price is most likely to go, by reasoning about CURRENT and " +
      "ANTICIPATED future business and world events — macroeconomic conditions, interest " +
      "rates, geopolitics, regulation, sector dynamics, and company-specific catalysts.\n\n" +
      `${lens}\n\n` +
      "Use web search to ground your view in current conditions and credible expectations. " +
      "Despite your analytical lens, your final probability MUST be honest and calibrated — " +
      "a genuine probability estimate, not advocacy. " +
      config.GROUNDING
    );
  }

  async simulate(stock, newsContext = "") {
    const cats = (stock.catalysts || []).map((c) => `- ${c}`).join("\n") || "- (none on file)";
    const newsBlock = newsContext
      ? `\nRECENT NEWS (use this to ground your forecast):\n${newsContext}\n`
      : "";
    const prompt =
      `Forecast ${stock.ticker} (${stock.company}) over the next ${config.SIMULATION_HORIZON}.\n\n` +
      `Company thesis on file:\n${stock.thesis}\n\n` +
      (stock.marketData ? `${stock.marketData}\n\n` : "") +
      `Known catalysts:\n${cats}\n${newsBlock}\n` +
      "Search the web for current and anticipated business/world events relevant to this " +
      "company and its sector, then give your calibrated estimate of where the stock goes.\n\n" +
      "Provide BOTH a probability AND a magnitude (expected % price change over the horizon, " +
      "and a plausible downside % in a bad scenario).\n\n" +
      "Finish your reply with ONLY this JSON (nothing after it):\n" +
      '{"probabilityIncrease": <0-100 integer>, "directionCall": "increase|decrease", ' +
      '"expectedReturnPct": <signed integer, base-case % over horizon>, ' +
      '"downsideReturnPct": <signed integer, plausible bad-case %>, ' +
      '"keyEvents": ["event driving your call"], "reasoning": "2-5 sentences", ' +
      '"articles": [{"title":"","url":"","summary":""}]}';

    const tools = [
      { type: "web_search_20250305", name: "web_search", max_uses: config.WEB_SEARCH_MAX_USES },
    ];
    const system = this._system() + "\n\nEnd your reply with the JSON object and nothing after it.";
    let data;
    try {
      const raw = await this.callText(system, prompt, { tools, maxTokens: 3500 });
      data = BaseAgent.parseJson(raw);
    } catch (e) {
      console.warn(`      [warn] ${this.name}: unparseable forecast (${e.message.slice(0, 50)}). Using neutral 50%.`);
      data = { probabilityIncrease: 50, reasoning: "Forecast response unparseable; neutral estimate used." };
    }

    let p = Number(data.probabilityIncrease);
    if (!Number.isFinite(p)) p = 50;
    p = Math.max(0, Math.min(100, Math.round(p)));
    const num = (v, d) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);

    return {
      simulator: this.name,
      stance: this.stance,
      probabilityIncrease: p,
      expectedReturnPct: num(data.expectedReturnPct, this.stance === "bull" ? 10 : -5),
      downsideReturnPct: num(data.downsideReturnPct, -15),
      directionCall: data.directionCall || (p >= 50 ? "increase" : "decrease"),
      keyEvents: (data.keyEvents || []).filter(Boolean),
      reasoning: data.reasoning || "",
      articles: (data.articles || []).map((a) =>
        makeArticle(a.title || "", a.url || "", a.summary || "")
      ),
    };
  }
}
