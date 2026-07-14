// Orchestrator: wires research agents and critics together and runs the
// propose -> critique -> debate -> (rebut | concede & replace) loop until each
// field has produced its approved stocks.
import { config } from "../config.js";
import { makeReview, latestVerdicts, shortName } from "../agents/models.js";
import { NewsAgent } from "../agents/newsAgent.js";
import {
  loadLedger, seenTickers, deniedForField, recordReview, saveLedger, priorInteractionSummary,
} from "../ledger.js";
import { fetchGroundTruth } from "../marketData.js";
import { PreScreenAgent, VerifierAgent } from "../agents/gatekeeperAgents.js";
import { emit } from "../progress.js";

// Route the workflow's existing log() calls through the progress sink so the UI
// can stream the debate live (and the CLI still prints when VERBOSE).
function log(msg = "") {
  emit("log", msg);
}

export class Workflow {
  constructor(researchAgents, critics, simulators = null, newsAgent = null, portfolioAgent = null, ledger = null) {
    this.researchAgents = researchAgents; // ResearchAgent[]
    this.critics = critics; // CriticAgent[]
    this.simulators = simulators; // { bull, bear } | null
    this.newsAgent = newsAgent; // NewsAgent | null
    this.portfolioAgent = portfolioAgent; // PortfolioAgent | null
    this.ledger = ledger || loadLedger(); // persistent record (no repeats + history)
    // Cheap gatekeepers (built from the same client as the first research agent
    // or first critic — any agent's client works).
    const client = (researchAgents[0] || critics[0])?.client;
    this.preScreen = client && config.ENABLE_PRESCREEN ? new PreScreenAgent(client) : null;
    this.verifier = client && config.ENABLE_VERIFIER ? new VerifierAgent(client) : null;
  }

  // Effective approval threshold: null in config means UNANIMOUS (all critics).
  _required() {
    return config.REQUIRED_APPROVALS == null
      ? this.critics.length
      : config.REQUIRED_APPROVALS;
  }

  async _critique(stock, roundNo) {
    // All critics review in PARALLEL — same verdicts, ~9x faster wall-clock.
    const verdicts = await Promise.all(this.critics.map((c) => c.review(stock, roundNo)));
    for (const v of verdicts) {
      log(`      [${v.approved ? "APPROVE" : "DENY"}] ${v.criticName}: ${v.reasoning}`);
      // Structured event so the UI can render critic verdicts as badges as they land.
      emit("verdict", `${v.criticName}: ${v.approved ? "APPROVE" : "DENY"}`, {
        ticker: stock.ticker,
        critic: v.criticName,
        approved: v.approved,
        reasoning: v.reasoning,
        round: roundNo,
      });
    }
    return verdicts;
  }

  _countApprovals(verdicts) {
    return verdicts.filter((v) => v.approved).length;
  }

  async _evaluateStock(agent, stock) {
    const review = makeReview(stock);
    log(`\n   >>> Evaluating ${shortName(stock)}`);
    emit("stock", `Evaluating ${shortName(stock)}`, { ticker: stock.ticker, company: stock.company });

    // 0a. Ground truth: fetch real market/SEC data and attach it so every
    // downstream agent reasons from data, not model recall.
    if (config.ENABLE_MARKET_DATA || config.ENABLE_SEC_DATA) {
      try {
        const gt = await fetchGroundTruth(stock.ticker);
        if (gt) {
          stock.marketData = gt.text;
          stock.entryPrice = gt.price;
          stock.marketCap = gt.marketCap;
          log(`      Ground truth attached (price: ${gt.price ?? "n/a"}).`);
          // HARD market-cap gate (real data, not prompt guidance).
          if (config.ENFORCE_MARKET_CAP && gt.marketCap != null) {
            if (gt.marketCap < config.MARKET_CAP_MIN || gt.marketCap > config.MARKET_CAP_MAX) {
              const b = (n) => (n / 1e9).toFixed(1) + "B";
              review.finalStatus = "REJECTED";
              review.rejectReason = `Market cap ${b(gt.marketCap)} outside the ${b(config.MARKET_CAP_MIN)}-${b(config.MARKET_CAP_MAX)} low/mid-cap mandate.`;
              log(`   <<< ${shortName(stock)}: REJECTED — ${review.rejectReason}`);
              return review;
            }
          }
        } else {
          stock.marketData = `NOTE: live market/SEC data unavailable for ${stock.ticker}; verify figures independently.`;
          log("      Live market data unavailable; proceeding with note.");
        }
      } catch { /* never block on data */ }
    }

    // 0b. Cheap pre-screen: kill obvious failures for pennies.
    if (this.preScreen && config.ENABLE_PRESCREEN) {
      const ps = await this.preScreen.screen(stock);
      if (!ps.pass) {
        review.finalStatus = "REJECTED";
        review.rejectReason = `Pre-screen: ${ps.reason}`;
        log(`   <<< ${shortName(stock)}: REJECTED at pre-screen — ${ps.reason}`);
        return review;
      }
    }

    // 0c. Claim verifier: fact-check load-bearing catalysts before the panel.
    if (this.verifier && config.ENABLE_VERIFIER) {
      const vf = await this.verifier.verify(stock);
      review.verification = vf;
      if (!vf.pass) {
        review.finalStatus = "REJECTED";
        review.rejectReason = `Claim verification failed: ${vf.reason}`;
        log(`   <<< ${shortName(stock)}: REJECTED by verifier — ${vf.reason}`);
        return review;
      }
      log(`      Claims verified: ${vf.reason || "ok"}`);
    }

    review.verdicts.push(...(await this._critique(stock, 1)));

    const required = this._required();
    let approvals = this._countApprovals(latestVerdicts(review));
    log(
      `      Round 1: ${approvals}/${this.critics.length} approvals ` +
        `(need ${required}${config.REQUIRED_APPROVALS == null ? ", unanimous" : ""}).`
    );

    let debateRound = 1;
    while (approvals < required && debateRound <= config.MAX_DEBATE_ROUNDS) {
      const denials = latestVerdicts(review).filter((v) => !v.approved);
      if (denials.length === 0) break;

      // Credit optimization 1: if a numeric MAX_DEBATE_GAP is set and the
      // researcher would have to flip more critics than that to reach the
      // threshold, skip the expensive rebuttal. null = NO CAP (always allow the
      // researcher to argue every point if it wants to).
      const gap = required - approvals;
      if (config.MAX_DEBATE_GAP != null && gap > config.MAX_DEBATE_GAP) {
        log(`      Gap of ${gap} exceeds MAX_DEBATE_GAP (${config.MAX_DEBATE_GAP}); ` +
            `skipping debate to save credits.`);
        break;
      }

      log(`      -- Debate round ${debateRound}: researcher responds to ${denials.length} denial(s) --`);
      const turns = await agent.respondToVerdicts(stock, denials);
      review.debateLog.push(...turns);

      // Credit optimization 2: if even ALL of the researcher's rebuttals succeeding
      // can't reach the threshold (it conceded too many), don't spend on re-reviews.
      const rebuttals = turns.filter((t) => t.action === "rebut").length;
      if (approvals + rebuttals < required) {
        log(`         Researcher rebuts only ${rebuttals} of the ${denials.length} denial(s) — ` +
            `cannot reach ${required}. Skipping re-reviews.`);
        break;
      }

      const denyingCritics = new Map(
        this.critics
          .filter((c) => denials.some((d) => d.criticName === c.name))
          .map((c) => [c.name, c])
      );

      for (const turn of turns) {
        const critic = denyingCritics.get(turn.criticName);
        if (!critic) continue;
        if (turn.action === "concede") {
          log(`         ${agent.name} CONCEDES to ${turn.criticName}.`);
          emit("debate", `${agent.name} concedes to ${turn.criticName}.`, {
            ticker: stock.ticker,
            actor: "researcher",
            action: "concede",
            critic: turn.criticName,
            argument: turn.argument || "",
          });
          continue; // concession stands; verdict stays a denial
        }
        log(`         ${agent.name} REBUTS ${turn.criticName}: ${turn.argument.slice(0, 140)}`);
        emit("debate", `${agent.name} rebuts ${turn.criticName}.`, {
          ticker: stock.ticker,
          actor: "researcher",
          action: "rebut",
          critic: turn.criticName,
          argument: turn.argument,
        });
        const newV = await critic.reReview(stock, turn.argument, turn.newEvidence, debateRound + 1);
        log(`            -> ${critic.name} now: [${newV.approved ? "APPROVE" : "HOLD DENY"}] ${newV.reasoning}`);
        emit("verdict", `${critic.name}: ${newV.approved ? "APPROVE" : "DENY"}`, {
          ticker: stock.ticker,
          critic: critic.name,
          approved: newV.approved,
          reasoning: newV.reasoning,
          round: debateRound + 1,
        });
        review.verdicts.push(newV);
      }

      if (turns.every((t) => t.action === "concede")) {
        log("         Researcher conceded all open points; ending debate.");
        break;
      }

      approvals = this._countApprovals(latestVerdicts(review));
      log(`      After debate round ${debateRound}: ${approvals}/${this.critics.length} approvals.`);
      debateRound += 1;
    }

    review.approvals = this._countApprovals(latestVerdicts(review));
    const criticApproved = review.approvals >= required;

    if (!criticApproved) {
      review.finalStatus = "REJECTED";
      review.rejectReason = `Cleared only ${review.approvals}/${this.critics.length} critics (need ${required}).`;
      log(`   <<< ${shortName(stock)}: REJECTED by critics (${review.approvals}/${this.critics.length})`);
      return review;
    }

    // Critic gate passed. Gather recent news first so the simulators are grounded in it.
    let newsContext = "";
    if (this.newsAgent && config.ENABLE_NEWS_AGENT) {
      log(`   ~~~ ${shortName(stock)} cleared critics; gathering recent news...`);
      review.news = await this.newsAgent.analyze(stock);
      log(`      News sentiment: ${review.news.sentimentScore} (${review.news.label}) — ${review.news.summary}`);
      emit("news", `News sentiment: ${review.news.label} (${review.news.sentimentScore})`, {
        ticker: stock.ticker,
        label: review.news.label,
        score: review.news.sentimentScore,
        summary: review.news.summary,
      });
      newsContext = NewsAgent.toContext(review.news);

      // News gate: drop stocks fighting net-negative recent news.
      if (config.NEWS_BLOCK_IF_NEGATIVE && review.news.label === "negative") {
        review.finalStatus = "REJECTED";
        review.rejectReason =
          `Recent news flow is net-negative (sentiment ${review.news.sentimentScore}).`;
        log(`   <<< ${shortName(stock)}: REJECTED on negative news`);
        return review;
      }
    }

    // Bull/bear simulation gate (grounded in the news), with magnitude + risk/reward.
    if (this.simulators && config.ENABLE_SIMULATORS) {
      log(`   ~~~ running bull/bear simulation...`);
      const bull = await this.simulators.bull.simulate(stock, newsContext);
      log(`      Bull P(up) ${bull.probabilityIncrease}%, exp ${bull.expectedReturnPct}% — ${bull.reasoning}`);
      const bear = await this.simulators.bear.simulate(stock, newsContext);
      log(`      Bear P(up) ${bear.probabilityIncrease}%, exp ${bear.expectedReturnPct}% — ${bear.reasoning}`);

      const netUpside = Math.round((bull.probabilityIncrease + bear.probabilityIncrease) / 2);
      const expectedReturn = Math.round((bull.expectedReturnPct + bear.expectedReturnPct) / 2);
      const upside = Math.max(bull.expectedReturnPct, 0);
      const downside = Math.abs(Math.min(bear.downsideReturnPct, bull.downsideReturnPct, 0));
      const riskReward = downside > 0 ? Math.round((upside / downside) * 10) / 10 : null;

      const threshold = config.SIMULATION_GATE_THRESHOLD;
      const passed = threshold == null ? true : netUpside >= threshold;
      review.simulation = { bull, bear, netUpside, expectedReturn, upside, downside, riskReward, passed };
      log(`      Net upside confidence ${netUpside}% | expected ${expectedReturn}% | R/R ${riskReward ?? "n/a"}` +
          (threshold == null ? " (ranking)" : ` (gate >= ${threshold}% -> ${passed ? "PASS" : "FAIL"})`));
      emit("sim", `Simulation: ${netUpside}% upside confidence, expected ${expectedReturn}%${riskReward != null ? `, R/R ${riskReward}:1` : ""}`, {
        ticker: stock.ticker,
        netUpside,
        expectedReturn,
        riskReward,
        passed,
      });

      if (!passed) {
        review.finalStatus = "REJECTED";
        review.rejectReason = `Passed critics but simulation confidence ${netUpside}% < ${threshold}%.`;
        log(`   <<< ${shortName(stock)}: ${review.finalStatus}`);
        return review;
      }
    }

    // Passed every gate -> approved. Assess fit with the user's existing holdings.
    review.finalStatus = "APPROVED";
    if (this.portfolioAgent && config.ENABLE_PORTFOLIO_FIT) {
      review.portfolio = await this.portfolioAgent.assess(stock);
      log(`      Portfolio fit ${review.portfolio.fitScore}/100 (${review.portfolio.verdict}) — ${review.portfolio.reasoning}`);
    }

    log(`   <<< ${shortName(stock)}: ${review.finalStatus}`);
    return review;
  }

  async runField(agent) {
    log("\n" + "=".repeat(70));
    log(`FIELD: ${agent.fieldKey.toUpperCase()}  (${agent.name})`);
    log("=".repeat(70));

    const ledger = this.ledger;
    const approved = [];
    const allReviews = [];
    // Cross-run dedup: never re-propose a ticker already in the ledger.
    const seen = seenTickers(ledger);
    const evaluatedThisRun = new Set();
    const target = config.TARGET_APPROVED_PER_FIELD ?? 1;
    const maxRounds = config.MAX_SEARCH_ROUNDS;
    let round = 0;
    let emptyStreak = 0;

    while (approved.length < target && round < maxRounds) {
      round += 1;
      const batchSize = round === 1 ? config.STOCKS_PER_FIELD : config.MAX_NEW_RESEARCH_AT_ONCE;
      log(`\n[${agent.name}] Search round ${round}/${maxRounds}: researching ${batchSize} candidate(s)...`);

      let batch = await agent.findStocks(batchSize, seen);
      batch = batch.filter((s) => !seen.includes(s.ticker) && !evaluatedThisRun.has(s.ticker));
      seen.push(...batch.map((s) => s.ticker));

      // Re-open previously-denied stocks to argue them again (bounded).
      if (config.ENABLE_REVISIT) {
        const candidates = deniedForField(ledger, agent.fieldKey)
          .filter((e) => !evaluatedThisRun.has(e.ticker))
          .slice(0, config.REVISITS_PER_ROUND);
        for (const e of candidates) {
          log(`[${agent.name}] Re-opening previously-denied ${e.ticker} to re-argue (attempt ${(e.revisits || 0) + 1}).`);
          const revisit = await agent.reResearch(e, priorInteractionSummary(e));
          if (revisit) batch.push(revisit);
        }
      }

      if (batch.length === 0) {
        emptyStreak += 1;
        log(`[${agent.name}] No new candidates this round (${emptyStreak}/${config.MAX_EMPTY_ROUNDS}).`);
        if (emptyStreak >= config.MAX_EMPTY_ROUNDS) {
          log(`[${agent.name}] Out of fresh ideas for this field; stopping search.`);
          break;
        }
        continue;
      }
      emptyStreak = 0;
      log(`[${agent.name}] Candidates: ${batch.map(shortName).join(", ")}`);

      for (const stock of batch) {
        evaluatedThisRun.add(stock.ticker);
        const review = await this._evaluateStock(agent, stock);
        emit("stock-result", `${stock.ticker}: ${review.finalStatus}${review.rejectReason ? " — " + review.rejectReason : ""}`, {
          ticker: stock.ticker,
          status: review.finalStatus,
          reason: review.rejectReason || "",
        });
        allReviews.push(review);
        // Persist to the ledger immediately so a crash mid-run is not lost.
        recordReview(ledger, agent.fieldKey, review);
        saveLedger(ledger);
        if (review.finalStatus === "APPROVED") {
          approved.push(review);
          log(`\n[${agent.name}] ✓ Viable stock found: ${shortName(stock)} (${approved.length}/${target}).`);
          if (approved.length >= target) break;
        }
      }
    }

    if (approved.length === 0) {
      log(`\n[${agent.name}] No viable stock found in ${round} round(s) ` +
          `(evaluated ${allReviews.length}). Try raising MAX_SEARCH_ROUNDS or relaxing the gates.`);
    } else {
      log(`\n[${agent.name}] DONE. ${approved.length} viable of ${allReviews.length} evaluated.`);
    }
    return allReviews;
  }

  // Evaluate SPECIFIC user-supplied tickers through the full gauntlet.
  // If a ticker is already in the ledger, its prior interaction history is
  // attached so the researcher argues with that context (like a revisit).
  async runTickers(tickers, agent) {
    log("\n" + "=".repeat(70));
    log(`USER-REQUESTED STOCKS: ${tickers.join(", ")}`);
    log("=".repeat(70));
    const ledger = this.ledger;
    const reviews = [];
    for (const ticker of tickers) {
      const prior = ledger.stocks?.[ticker];
      const priorSummary = prior ? priorInteractionSummary(prior) : "";
      if (prior) log(`\n[${agent.name}] ${ticker} is in the ledger (${prior.status}); prior history attached.`);
      log(`[${agent.name}] Researching user-requested ${ticker}...`);
      const stock = await agent.researchTicker(ticker, priorSummary);
      if (!stock) {
        log(`[${agent.name}] Could not verify ${ticker} as a real listed ticker — skipping.`);
        continue;
      }
      const review = await this._evaluateStock(agent, stock);
      reviews.push(review);
      emit("stock-result", `${ticker}: ${review.finalStatus}${review.rejectReason ? " — " + review.rejectReason : ""}`, {
        ticker,
        status: review.finalStatus,
        reason: review.rejectReason || "",
      });
      recordReview(ledger, agent.fieldKey, review);
      saveLedger(ledger);
      log(`\n[${agent.name}] ${ticker}: ${review.finalStatus}${review.rejectReason ? " — " + review.rejectReason : ""}`);
    }
    return reviews;
  }

  async run() {
    const results = {};
    for (const agent of this.researchAgents) {
      results[agent.fieldKey] = await this.runField(agent);
    }
    return results;
  }
}
