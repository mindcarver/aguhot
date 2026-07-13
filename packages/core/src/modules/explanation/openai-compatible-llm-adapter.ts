/**
 * OpenAiCompatibleLlmAdapter — a real LLMAdapter (AD-7) over an OpenAI-compatible
 * chat-completions endpoint (Story 5.1 deferred real-provider procurement).
 *
 * This is the prod counterpart to StubLlmAdapter: where the stub returns fixed
 * fixtures (test-only), this adapter issues `POST {baseUrl}/v1/chat/completions`
 * with the configured model + a guardrail-baked system prompt, then returns the
 * LLM's text. It is constructed by the worker from env (`LLM_BASE_URL` /
 * `LLM_API_KEY` / `LLM_MODEL`); when env is absent the worker resolves
 * `adapter = undefined` and prod degrades honestly (the unchanged 5.1 default).
 *
 * Contract (mirrors StubLlmAdapter / the LLMAdapter port doc):
 *   - Each method returns its result shape + `modelId` (`openai-compat:{model}`)
 *     + `promptVersion` (`{kind}-real-v1`) for the NFR-7 audit chain.
 *   - Returns null on ANY adapter-level failure (network error, non-2xx, parse
 *     failure) → the generator writes nothing → honest degradation (NFR-2).
 *   - Does NOT self-guardrail: the generator's validateReason/validateDeepRead/
 *     validateTrendBriefing enforces the 6-class blacklist + length at write
 *     time (throws on violation; the worker's per-event try/catch isolates it →
 *     that event stays null). The adapter bakes the constraints into the system
 *     prompt so compliant output is the common case, but the hard guard is the
 *     generator (PRD §10: guardrail is the last line of defense, not the only).
 *
 * Security: the API key is read from env at construction (caller passes it in),
 * NEVER hardcoded. The worker resolver reads `process.env.LLM_API_KEY`; this
 * adapter class stores it in a private field for the request Authorization
 * header. .env is gitignored (line 30) so the key never enters git.
 *
 * No third-party SDK: uses the global `fetch` (Node 18+, same as RssAdapter's
 * fetchUrl). The domain layer never imports an LLM SDK (AD-7: port isolation).
 */

import type {
  LLMAdapter,
  LlmDeepReadArgs,
  LlmDeepReadResult,
  LlmReasonResult,
  LlmTrendBriefingArgs,
  LlmTrendBriefingResult,
} from "./types.js";

/**
 * Shared system prompt constraints — the PRD §10 + epic-5-context tone baseline
 * (克制、可证、不煽动) + the six forbidden phrase classes. Baked into every
 * method's system message so the LLM's common-case output is compliant; the
 * generator's passesRecommendationGuardrail is the hard backstop.
 */
const SYSTEM_PROMPT = [
  "你是 A 股热点事件的 AI 解读编辑。输出必须克制、可证、不煽动，只基于给定证据事实陈述。",
  "禁止六类措辞：",
  "1. 动作类：买入/卖出/建仓/加仓/减仓/清仓/持仓/增持/减持/建议买/建议卖",
  "2. 收益预测类：必涨/必跌/翻倍/翻番/暴涨/暴跌/涨停/跌停/大涨/大跌",
  "3. 操纵框架类：主力/庄家/洗盘/拉升/出货/诱多",
  "4. 推荐强度类：强烈推荐/首推/首选/必买",
  "5. 时点建议类：抄底/逃顶/目标价/止损位",
  "6. 过度确定类：必将/一定/必然/肯定",
  "不得给出买卖建议、价格预测、目标价、止损位或任何操盘指令。用中性、事实性语言。",
].join("\n");

/** Provenance prefixes recorded on every appended row (NFR-7 audit chain). */
const PROMPT_VERSION_REASON = "reason-real-v1";
const PROMPT_VERSION_DEEP_READ = "deepread-real-v1";
const PROMPT_VERSION_TREND_BRIEFING = "trendbriefing-real-v1";

export interface OpenAiCompatibleLlmAdapterOptions {
  /** Base URL, e.g. "https://api.aicodewith.com". The adapter appends "/v1/chat/completions". */
  baseUrl: string;
  /** API key (read from env by the resolver; never hardcoded). Sent as Bearer token. */
  apiKey: string;
  /** Model name, e.g. "gpt5.5". Recorded in modelId for the audit chain. */
  model: string;
  /** Optional provider tag for modelId (default "openai-compat" → "openai-compat:{model}"). */
  providerTag?: string;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class OpenAiCompatibleLlmAdapter implements LLMAdapter {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly modelId: string;

  constructor(options: OpenAiCompatibleLlmAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.modelId = `${options.providerTag ?? "openai-compat"}:${options.model}`;
  }

  /**
   * POST /v1/chat/completions and return the first choice's message content
   * (trimmed). Returns null on any failure (network, non-2xx, empty/missing
   * content) — the caller degrades honestly. Low temperature (0.3) for factual
   * restraint.
   */
  private async chat(messages: ChatMessage[], maxTokens: number): Promise<string | null> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.3,
          max_tokens: maxTokens,
        }),
        // ponytail: 120s hard cap. gpt-5.5 is a reasoning model that occasionally
        // stalls on a single call indefinitely; without a timeout the
        // recommendation-reason worker hangs on that one call and never reaches
        // the remaining events. 120s is generous for any single chat() — reason
        // (~80 tok) is usually <15s, deepRead/trendBriefing (≤600 tok) stay well
        // under. A timed-out call throws here → caught below → returns null →
        // that event degrades honestly (no AI content), the worker moves on.
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      // Network error / DNS / timeout → honest degradation (no fabricated content).
      return null;
    }

    if (!response.ok) {
      // Non-2xx (auth error, rate limit, 5xx) → null. The worker's per-event
      // try/catch + traceId logging handles observability; this adapter stays
      // null-returning per the LLMAdapter contract.
      return null;
    }

    try {
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string") return null;
      const trimmed = content.trim();
      return trimmed === "" ? null : trimmed;
    } catch {
      // JSON parse error → null.
      return null;
    }
  }

  async generateReason(args: {
    hotEventId: string;
    title: string;
    summary: string;
  }): Promise<LlmReasonResult | null> {
    void args.hotEventId; // hotEventId is for tracing/audit at the generator level
    const userPrompt = [
      `事件标题：${args.title}`,
      args.summary !== "" ? `事件摘要：${args.summary}` : null,
      "",
      "用一句话（不超过 40 个汉字）概括这条热点为什么值得关注。只输出这一句话，不要任何前缀或解释。",
    ]
      .filter((line) => line !== null)
      .join("\n");

    const reason = await this.chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      80, // ~40 CJK chars + headroom
    );
    if (reason === null) return null;
    return {
      reason,
      modelId: this.modelId,
      promptVersion: PROMPT_VERSION_REASON,
    };
  }

  async generateDeepRead(args: LlmDeepReadArgs): Promise<LlmDeepReadResult | null> {
    void args.hotEventId;
    const evidenceLines = args.evidence.map(
      (e, i) => `证据${i + 1}：${e.sourceName}${e.summary !== "" ? ` — ${e.summary}` : ""}`,
    );
    const userPrompt = [
      `事件标题：${args.title}`,
      args.summary !== "" ? `事件摘要：${args.summary}` : null,
      evidenceLines.length > 0 ? `证据时间线：\n${evidenceLines.join("\n")}` : null,
      "",
      "基于以上证据，输出 JSON（仅 JSON，不要 markdown 代码块）：",
      '{"impactSurface":"影响面，≤120字","beneficiaries":"受益方，≤120字","riskPoints":"风险点，≤120字"}',
      "每段必须基于证据事实，不得编造无来源结论。",
    ]
      .filter((line) => line !== null)
      .join("\n");

    const raw = await this.chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      600, // 3 segments × ~120 CJK chars + JSON overhead
    );
    if (raw === null) return null;

    // Lenient JSON extraction: strip markdown fences if present, find the first
    // {...} block, parse. Returns null on any parse failure (honest degradation).
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch === null) return null;
    let parsed: { impactSurface?: string; beneficiaries?: string; riskPoints?: string };
    try {
      parsed = JSON.parse(jsonMatch[0]) as typeof parsed;
    } catch {
      return null;
    }
    const impactSurface = parsed.impactSurface?.trim();
    const beneficiaries = parsed.beneficiaries?.trim();
    const riskPoints = parsed.riskPoints?.trim();
    if (impactSurface === undefined || beneficiaries === undefined || riskPoints === undefined) {
      return null;
    }
    if (impactSurface === "" || beneficiaries === "" || riskPoints === "") return null;
    return {
      impactSurface,
      beneficiaries,
      riskPoints,
      modelId: this.modelId,
      promptVersion: PROMPT_VERSION_DEEP_READ,
    };
  }

  async generateTrendBriefing(args: LlmTrendBriefingArgs): Promise<LlmTrendBriefingResult | null> {
    const eventLines = args.events.map(
      (e, i) => `${i + 1}. ${e.title}${e.summary !== "" ? `：${e.summary}` : ""}`,
    );
    const userPrompt = [
      `日期：${args.coverageDate.toISOString().slice(0, 10)}`,
      `当日已发布热点事件：`,
      eventLines.join("\n"),
      "",
      "用一段话（不超过 200 个汉字）概括当日多条热点的跨事件主线演化。只输出这一段话，不要前缀或解释。标注所依据的事件，不伪造因果。",
    ].join("\n");

    const briefing = await this.chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      400, // ~200 CJK chars + headroom
    );
    if (briefing === null) return null;
    return {
      briefing,
      modelId: this.modelId,
      promptVersion: PROMPT_VERSION_TREND_BRIEFING,
    };
  }
}
