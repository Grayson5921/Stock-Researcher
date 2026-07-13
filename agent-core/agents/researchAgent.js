// Research agent: a domain expert (technology / business / energy) that finds
// promising low-to-mid-cap stocks backed by recent news, then defends or
// concedes them when critics push back.
import { config } from "../config.js";
import { BaseAgent } from "./baseAgent.js";
import { makeProposal, makeArticle, makeDebateTurn, shortName } from "./models.js";
import { researchDigest } from "../criteria/criticCriteria.js";

export class ResearchAgent extends BaseAgent {
  constructor(client, model, fieldKey, fieldDesc, effort = undefined) {
    super(client, model, `${capitalize(fieldKey)} Research Agent`, effort);
    this.fieldKey = fieldKey;
    this.fieldDesc = fieldDesc;
  }

  _system() {
    return (
      `You are a buy-side equity research analyst specializing in the ` +
      `${this.fieldKey.toUpperCase()} sector (${this.fieldDesc}). ` +
      `You hunt for profitable LOW-to-MID-CAP companies (${config.MARKET_CAP_HINT}). ` +
      "You back every idea with real, recent, verifiable catalysts found via web " +
      "search: government grants or contracts, regulatory wins, earnings beats, new " +
      "products, insider buying, analyst upgrades, etc. " +
      "You are rigorous and intellectually honest. You are NOT a yes-man: you defend " +
      "strong ideas with evidence, but you concede gracefully when a critic raises a " +
      "valid point you cannot rebut. Never fabricate tickers, financials, or sources. " +
      config.GROUNDING +
      "\n\n" +
      researchDigest()
    );
  }

  _searchTool() {
    return [
      { type: "web_search_20250305", name: "web_search", max_uses: config.WEB_SEARCH_MAX_USES },
    ];
  }

  async findStocks(n, exclude = []) {
    const excludeNote = exclude.length
      ? ` Do NOT propose any of these already-considered tickers: ${exclude.join(", ")}.`
      : "";
    const researchPrompt =
      `Find ${n} promising low-to-mid-cap ${this.fieldKey} companies ` +
      `(${config.MARKET_CAP_HINT}) that look profitable or on a credible path to ` +
      "profitability and have RECENT positive catalysts in the news.\n\n" +
      "For each company, search the web for concrete supporting evidence such as " +
      "government grants/contracts, big customer wins, regulatory approvals, earnings " +
      "beats, or insider buying. Capture the article titles and URLs.\n" +
      `${excludeNote}\n\n` +
      "Write a short research brief covering each company, its ticker, why it is " +
      "compelling, the specific catalysts, and the source URLs you found. " +
      "Pre-screen every candidate against the APPROVAL GAUNTLET in your instructions — " +
      "only propose names you genuinely believe can clear ALL the critics and gates.";

    const brief = await this.callText(this._system(), researchPrompt, {
      tools: this._searchTool(),
      maxTokens: 6000,
    });

    const structurePrompt =
      "Convert the research brief below into JSON with this exact schema:\n" +
      '{"stocks": [{"ticker": "STR", "company": "STR", "thesis": "STR", ' +
      '"catalysts": ["STR"], "articles": [{"title":"STR","url":"STR","summary":"STR"}]}]}\n' +
      `Return at most ${n} stocks. Only include companies that genuinely appeared in the ` +
      "brief with real tickers and sources. Omit any company you are unsure is real.\n\n" +
      "--- RESEARCH BRIEF ---\n" +
      brief;

    try {
      const data = await this.callJson(this._system(), structurePrompt, { maxTokens: 4000 });
      return this._toProposals(data);
    } catch (e) {
      console.warn(`   [warn] ${this.name}: could not structure research (${e.message.slice(0, 60)}). Returning no candidates this round.`);
      return [];
    }
  }

  _toProposals(data) {
    const out = [];
    for (const s of (data && data.stocks) || []) {
      const ticker = (s.ticker || "").trim().toUpperCase();
      if (!ticker) continue;
      const articles = (s.articles || []).map((a) =>
        makeArticle(a.title || "", a.url || "", a.summary || "")
      );
      out.push(
        makeProposal({
          ticker,
          company: s.company || ticker,
          field: this.fieldKey,
          thesis: s.thesis || "",
          catalysts: (s.catalysts || []).filter(Boolean),
          articles,
          proposedBy: this.name,
        })
      );
    }
    return out;
  }

  // Research a SPECIFIC user-supplied ticker: verify it's real, build a
  // grounded profile (thesis, catalysts, sources) via web search, then let the
  // normal gauntlet judge it. Returns null if the ticker can't be verified.
  async researchTicker(ticker, priorSummary = "") {
    const priorNote = priorSummary
      ? `\nPrior evaluation on record: ${priorSummary}\nAddress those concerns where the latest evidence allows.\n`
      : "";
    const prompt =
      `The user has asked you to evaluate the stock with ticker "${ticker}". ` +
      "Search the web to verify this ticker exists and identify the company. If you " +
      "cannot verify it is a real, currently-listed ticker, say so.\n" +
      "If it is real: research the company's current fundamentals, recent catalysts, " +
      "and news, and build an honest, grounded investment brief. Do NOT inflate the " +
      "case — the critics will judge it; your job is an accurate picture." +
      priorNote +
      "\n\nFinish with ONLY this JSON (use verified=false if the ticker isn't real):\n" +
      '{"verified": true|false, "ticker": "STR", "company": "STR", "thesis": "STR", ' +
      '"catalysts": ["STR"], "articles": [{"title":"","url":"","summary":""}]}';
    try {
      const raw = await this.callText(this._system(), prompt, {
        tools: this._searchTool(),
        maxTokens: 4000,
      });
      const data = BaseAgent.parseJson(raw);
      if (!data || data.verified === false) return null;
      data.ticker = ticker; // trust the user's ticker string
      const props = this._toProposals({ stocks: [data] });
      const p = props[0] || null;
      if (p) {
        p.userRequested = true;
        if (priorSummary) {
          p.revisitOf = true;
          p.priorInteraction = priorSummary;
        }
      }
      return p;
    } catch (e) {
      console.warn(`   [warn] ${this.name}: could not research ${ticker} (${e.message.slice(0, 50)}).`);
      return null;
    }
  }

  // Re-open a previously-denied stock: re-research it fresh (so the critics get
  // current evidence) and attach the recorded prior-interaction context so the
  // researcher can argue against the critics that denied it last time.
  async reResearch(entry, priorSummary) {
    const prompt =
      `Re-examine ${entry.ticker} (${entry.company}), a ${this.fieldKey} stock that was ` +
      `previously NOT approved. Prior context:\n${priorSummary}\n\n` +
      "Search the web for the LATEST evidence on this specific company (recent results, " +
      "catalysts, filings, news). Build the strongest grounded, honest case for it now, " +
      "directly addressing the prior concerns where you legitimately can. Do not fabricate.\n\n" +
      "Finish with ONLY this JSON:\n" +
      '{"ticker":"' + entry.ticker + '","company":"' + entry.company + '","thesis":"STR",' +
      '"catalysts":["STR"],"articles":[{"title":"","url":"","summary":""}]}';
    try {
      const brief = await this.callText(this._system(), prompt, {
        tools: this._searchTool(),
        maxTokens: 4000,
      });
      const data = BaseAgent.parseJson(brief);
      const props = this._toProposals({ stocks: [data] });
      const p = props[0];
      if (!p) return null;
      p.revisitOf = true;
      p.priorInteraction = priorSummary;
      p.thesis = `[RE-ARGUED] ${p.thesis}`;
      return p;
    } catch (e) {
      console.warn(`   [warn] ${this.name}: could not re-research ${entry.ticker} (${e.message.slice(0, 50)}).`);
      return null;
    }
  }

  // For each denying critic, decide to rebut (with new evidence) or concede.
  async respondToVerdicts(stock, denials) {
    const denialText = denials
      .map(
        (v) =>
          `CRITIC: ${v.criticName}\nFAILED CRITERIA: ${JSON.stringify(v.failed)}\n` +
          `REASONING: ${v.reasoning}`
      )
      .join("\n\n");

    const priorNote = stock.priorInteraction
      ? `\nNOTE: this is a RE-ARGUMENT of a previously-denied stock. Prior context: ${stock.priorInteraction}\n`
      : "";
    const prompt =
      `Your pick ${shortName(stock)} was denied by the following critics:\n\n` +
      `${denialText}\n${priorNote}\n` +
      "For EACH critic above, decide honestly whether to:\n" +
      "  - 'rebut': you have a genuine, evidence-based case the critic is wrong or " +
      "missed something. Provide a tight argument. If you can cite a fact, do so.\n" +
      "  - 'concede': the critic has a fair point you cannot honestly refute.\n\n" +
      "Do not rebut just to win. Concede when the criticism is valid. Respond in JSON:\n" +
      '{"responses": [{"critic": "STR", "action": "rebut|concede", "argument": "STR", ' +
      '"new_evidence": [{"title":"STR","url":"STR","summary":"STR"}]}]}';

    const system =
      this._system() +
      "\n\nYou MUST finish your reply with the JSON object described by the user, and " +
      "nothing after it.";

    const raw = await this.callText(system, prompt, {
      tools: this._searchTool(),
      maxTokens: 5000,
    });
    let data;
    try {
      data = BaseAgent.parseJson(raw);
    } catch (e) {
      console.warn(`         [warn] ${this.name}: could not parse rebuttal (${e.message.slice(0, 60)}). Conceding all.`);
      return []; // no turns -> treated as conceding every denial (safe default)
    }

    return ((data && data.responses) || []).map((r) => {
      let action = (r.action || "concede").toLowerCase();
      action = action.startsWith("rebut") ? "rebut" : "concede";
      const ev = (r.new_evidence || []).map((a) =>
        makeArticle(a.title || "", a.url || "", a.summary || "")
      );
      return makeDebateTurn({
        criticName: r.critic || "",
        action,
        argument: r.argument || "",
        newEvidence: ev,
      });
    });
  }
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
