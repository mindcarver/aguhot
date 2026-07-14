/**
 * OpenAiCompatibleDigestAdapter — a real DigestAdapter (AD-7) over an OpenAI-
 * compatible chat-completions endpoint. The prod counterpart to
 * StubDigestAdapter: for each eligible hot event it loads the event's context
 * (title + summary + member evidence), asks the LLM for a one-paragraph
 * descriptive conclusion + an editorial category, and returns
 * `{ hotEventId, conclusion, category }`.
 *
 * Constructed by the worker from env (`LLM_BASE_URL` / `LLM_API_KEY` /
 * `LLM_MODEL`, the SAME set the reason/deepread/trend adapter uses — one
 * provider serves all AI text). When env is absent the worker resolves
 * `adapter = undefined` and the digest degrades honestly (no row written).
 *
 * Contract (mirrors OpenAiCompatibleLlmAdapter):
 *   - Per event: returns a NON-EMPTY conclusion (≤120 字, free of advice
 *     keywords) + a category from the fixed daily-report taxonomy. generateDaily
 *     Digest re-validates (non-empty + noInvestAdvice) and throws on violation.
 *   - Returns null on any adapter-level failure (network, non-2xx, parse) → the
 *     generator writes nothing for the whole pass (honest degradation). Per-event
 *     failures are skipped (not null-the-whole-thing) so one bad event does not
 *     blank the day's digest.
 *
 * No third-party SDK — uses global fetch (Node 18+). The domain layer imports no
 * LLM SDK (AD-7). The adapter DOES read prisma (to load event context) — the
 * DigestAdapter port receives only hotEventIds, so the adapter resolves context
 * itself rather than widening the port signature.
 */

import type { PrismaClient } from "../../../generated/client.js";
import type { DigestAdapter, DigestConclusion } from "./types.js";

/**
 * The fixed editorial category taxonomy for the A股日报 sections. The LLM is
 * asked to assign exactly one; an unrecognized/missing value falls back to "其它"
 * at assembly. Order = the render order of the daily-report sections.
 */
export const DAILY_CATEGORIES = [
  "政策动态",
  "行业景气",
  "公司·标的",
  "海外映射",
  "资金面",
  "风险提示",
  "其它",
] as const;

const CATEGORY_SET = new Set<string>(DAILY_CATEGORIES);

const SYSTEM_PROMPT = [
  "你是 A 股热点日报的编辑。输出必须克制、可证、不煽动，只基于给定证据事实陈述。",
  "禁止：买入/卖出/建仓/加仓/减仓/清仓/持仓/增持/减持/目标价/止损/必涨/必跌/涨停/跌停/强烈推荐/必将/一定。",
  "不得给出买卖建议、价格预测或操盘指令。用中性、事实性语言。",
].join("\n");

export interface OpenAiCompatibleDigestAdapterOptions {
  prisma: PrismaClient;
  baseUrl: string;
  apiKey: string;
  model: string;
  providerTag?: string;
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export class OpenAiCompatibleDigestAdapter implements DigestAdapter {
  private readonly prisma: PrismaClient;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options: OpenAiCompatibleDigestAdapterOptions) {
    this.prisma = options.prisma;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.model = options.model;
  }

  async fetchConclusions(args: {
    coverageDate: Date;
    hotEventIds: string[];
  }): Promise<DigestConclusion[] | null> {
    // Bounded-concurrency pool: a day can have dozens of eligible events, each
    // needing its own LLM call (~5-15s). Sequential would blow the cron window;
    // 5-way parallel keeps a full digest under ~2-3 min without hammering the
    // provider. Per-event failures are skipped (do not null the whole pass).
    const concurrency = 5;
    let cursor = 0;
    const conclusions: DigestConclusion[] = [];
    async function run(self: OpenAiCompatibleDigestAdapter): Promise<void> {
      while (true) {
        const idx = cursor++;
        if (idx >= args.hotEventIds.length) return;
        const hotEventId = args.hotEventIds[idx]!;
        try {
          const ctx = await self.loadContext(hotEventId);
          if (ctx === null) continue;
          const got = await self.summarize(ctx);
          if (got !== null) conclusions.push({ hotEventId, ...got });
        } catch {
          // Per-event failure: skip.
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(concurrency, args.hotEventIds.length) }, () => run(this)),
    );
    return conclusions.length > 0 ? conclusions : null;
  }

  /** Load the event's title + latest summary + member evidence for grounding. */
  private async loadContext(
    hotEventId: string,
  ): Promise<{ title: string; summary: string; evidence: string } | null> {
    const event = await this.prisma.hotEvent.findUnique({
      where: { id: hotEventId },
      select: {
        title: true,
        revisions: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { title: true },
        },
        explanationVersions: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { summary: true },
        },
        evidence: {
          select: {
            evidenceRecord: {
              select: {
                source: { select: { name: true } },
                summary: true,
                publishedAt: true,
              },
            },
          },
        },
      },
    });
    if (event === null) return null;
    const effectiveTitle = event.revisions[0]?.title ?? event.title;
    const summary = event.explanationVersions[0]?.summary ?? "";
    const evidence = event.evidence
      .map((l) => `${l.evidenceRecord.source.name}：${l.evidenceRecord.summary ?? ""}`)
      .join("\n");
    return { title: effectiveTitle, summary, evidence };
  }

  /** One LLM call → { conclusion (≤120字), category }. Null on any failure. */
  private async summarize(ctx: {
    title: string;
    summary: string;
    evidence: string;
  }): Promise<{ conclusion: string; category: string } | null> {
    const cats = DAILY_CATEGORIES.filter((c) => c !== "其它").join(" / ");
    const userPrompt = [
      `事件标题：${ctx.title}`,
      ctx.summary !== "" ? `摘要：${ctx.summary}` : null,
      ctx.evidence !== "" ? `证据：\n${ctx.evidence.slice(0, 1200)}` : null,
      "",
      "基于以上证据写一句不超过 120 字的事实性概括（描述发生了什么、影响什么），并从以下分类中选最贴切的一个：",
      cats,
      "",
      '只输出 JSON（不要 markdown 代码块）：{"conclusion":"…","category":"…"}',
    ]
      .filter((l) => l !== null)
      .join("\n");

    const raw = await this.chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      400,
    );
    if (raw === null) return null;
    const m = raw.match(/\{[\s\S]*\}/);
    if (m === null) return null;
    let parsed: { conclusion?: string; category?: string };
    try {
      parsed = JSON.parse(m[0]) as typeof parsed;
    } catch {
      return null;
    }
    const conclusion = parsed.conclusion?.trim();
    const categoryRaw = parsed.category?.trim() ?? "";
    if (conclusion === undefined || conclusion === "") return null;
    // Normalize category into the fixed taxonomy; unrecognized → 其它.
    const category = CATEGORY_SET.has(categoryRaw) ? categoryRaw : "其它";
    return { conclusion, category };
  }

  /** POST /v1/chat/completions → first choice content (trimmed), or null. */
  private async chat(messages: ChatMessage[], maxTokens: number): Promise<string | null> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, messages, temperature: 0.3, max_tokens: maxTokens }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      return null;
    }
    if (!response.ok) return null;
    try {
      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string") return null;
      const trimmed = content.trim();
      return trimmed === "" ? null : trimmed;
    } catch {
      return null;
    }
  }
}
