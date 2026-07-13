// Base class wrapping the Anthropic Messages API with JSON + web-search helpers.
import { config } from "../config.js";
import { costTracker, CostCeilingError } from "../costTracker.js";

export class BaseAgent {
  constructor(client, model, name, effort = undefined) {
    this.client = client;
    this.model = model;
    this.name = name;
    // Fall back to the global config value; null/undefined -> omit the param.
    this.effort = effort !== undefined ? effort : config.EFFORT;
  }

  // -- raw text call ------------------------------------------------------
  async callText(system, user, { tools = null, maxTokens = 4000 } = {}) {
    const params = {
      model: this.model,
      max_tokens: maxTokens,
      // Prompt caching: system prompts (critic criteria, digest) repeat on
      // every call, so mark them cacheable to cut input cost dramatically.
      system: config.ENABLE_PROMPT_CACHE
        ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]
        : system,
      messages: [{ role: "user", content: user }],
    };
    if (this.effort) params.output_config = { effort: this.effort };
    if (tools) params.tools = tools;

    const resp = await this.client.messages.create(params);
    if (config.ENABLE_COST_TRACKER) {
      costTracker.record(this.model, resp.usage);
      // Hard per-job spend ceiling: abort before the NEXT expensive call once the
      // running estimate crosses the ceiling. Fail-closed so a run can never blow
      // past its COGS cap.
      const ceiling = config.COST_CEILING_USD;
      if (ceiling && costTracker.total() >= ceiling) {
        throw new CostCeilingError(costTracker.total(), ceiling);
      }
    }
    return BaseAgent.extractText(resp);
  }

  // -- JSON call ----------------------------------------------------------
  // Retries once with a "be compact" nudge if the first reply is truncated or
  // not valid JSON. Throws only if every attempt fails.
  async callJson(system, user, { maxTokens = 4000, retries = 1 } = {}) {
    const sys =
      system +
      "\n\nIMPORTANT: Respond with ONLY valid JSON. No markdown fences, no " +
      "commentary before or after. Keep all string values short. If you are unsure " +
      "of a value, use null or an empty array rather than inventing data.";
    let lastErr;
    let prompt = user;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const text = await this.callText(sys, prompt, { maxTokens });
      try {
        return BaseAgent.parseJson(text);
      } catch (e) {
        lastErr = e;
        // Strengthen the instruction and shrink expected output before retrying.
        prompt =
          user +
          "\n\n(Your previous reply was not valid JSON or was cut off. Reply again " +
          "with COMPACT valid JSON only — keep every string under ~15 words so it fits.)";
      }
    }
    throw lastErr;
  }

  // -- helpers ------------------------------------------------------------
  static extractText(resp) {
    // Concatenate text blocks; ignore tool_use / web_search_tool_result blocks.
    return (resp.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  }

  static parseJson(text) {
    if (!text) throw new Error("Empty response, cannot parse JSON.");
    let cleaned = text.trim();

    // strip markdown fences if present
    const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) cleaned = fence[1].trim();

    // try direct parse
    try {
      return JSON.parse(cleaned);
    } catch {
      // fall back to slicing the outermost {} or []
      for (const [open, close] of [
        ["{", "}"],
        ["[", "]"],
      ]) {
        const start = cleaned.indexOf(open);
        const end = cleaned.lastIndexOf(close);
        if (start !== -1 && end !== -1 && end > start) {
          try {
            return JSON.parse(cleaned.slice(start, end + 1));
          } catch {
            /* keep trying */
          }
        }
      }
    }
    throw new Error(`Could not parse JSON from model output:\n${text.slice(0, 500)}`);
  }
}
