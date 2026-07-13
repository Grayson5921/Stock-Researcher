// News & Sentiment agent: searches recent news on a stock, classifies each item
// as positive or negative for the company, scores net sentiment, and summarizes
// the catalysts and risks. Its output is shown in the report AND fed to the
// simulators so their forecast is grounded in real, recent reporting.
import { config } from "../config.js";
import { BaseAgent } from "./baseAgent.js";

export class NewsAgent extends BaseAgent {
  constructor(client, model, effort = undefined) {
    super(client, model, "News & Sentiment Agent", effort);
  }

  _system() {
    return (
      "You are a financial news analyst. For a given stock you gather RECENT news, " +
      "classify each item as positive or negative for the company's prospects, judge how " +
      "material it is, and produce a net sentiment read that correlates the news flow to " +
      "the likely effect on the share price.\n\n" +
      config.GROUNDING +
      "\nOnly include real, datelined items you actually found. Do not manufacture headlines."
    );
  }

  async analyze(stock) {
    const prompt =
      `Research news on ${stock.ticker} (${stock.company}) from ${config.NEWS_LOOKBACK}.\n\n` +
      "Search for: earnings results and guidance, contracts/customers, products/launches, " +
      "regulatory or legal developments, analyst rating changes, insider transactions, and " +
      "any management or macro news that moves the stock.\n\n" +
      "Classify each notable item as positive or negative for the company, note how material " +
      "it is, and give an overall net sentiment.\n\n" +
      "Finish with ONLY this JSON (nothing after it):\n" +
      '{"sentimentScore": <-100 to 100 integer, negative = bearish>, ' +
      '"label": "positive|neutral|negative", ' +
      '"positives": [{"headline":"","url":"","impact":"why it helps the stock"}], ' +
      '"negatives": [{"headline":"","url":"","impact":"why it hurts the stock"}], ' +
      '"summary": "2-4 sentences correlating the news flow to the share price"}';

    const tools = [
      { type: "web_search_20250305", name: "web_search", max_uses: config.WEB_SEARCH_MAX_USES },
    ];
    const system = this._system() + "\n\nEnd your reply with the JSON object and nothing after it.";

    let data;
    try {
      const raw = await this.callText(system, prompt, { tools, maxTokens: 3500 });
      data = BaseAgent.parseJson(raw);
    } catch (e) {
      console.warn(`      [warn] ${this.name}: unparseable news read (${e.message.slice(0, 50)}). Using neutral.`);
      data = {};
    }

    let score = Number(data.sentimentScore);
    if (!Number.isFinite(score)) score = 0;
    score = Math.max(-100, Math.min(100, Math.round(score)));

    const clean = (arr) =>
      (arr || [])
        .filter((x) => x && (x.headline || x.url))
        .map((x) => ({ headline: x.headline || "", url: x.url || "", impact: x.impact || "" }));

    return {
      sentimentScore: score,
      label: data.label || (score > 15 ? "positive" : score < -15 ? "negative" : "neutral"),
      positives: clean(data.positives),
      negatives: clean(data.negatives),
      summary: data.summary || "No clear net sentiment found.",
    };
  }

  // Compact text the simulators can read for grounding.
  static toContext(news) {
    if (!news) return "No news summary available.";
    const pos = news.positives.slice(0, 4).map((p) => `+ ${p.headline}`).join("; ") || "none";
    const neg = news.negatives.slice(0, 4).map((n) => `- ${n.headline}`).join("; ") || "none";
    return (
      `Recent news net sentiment: ${news.sentimentScore} (${news.label}).\n` +
      `Positive items: ${pos}\nNegative items: ${neg}\nSummary: ${news.summary}`
    );
  }
}
