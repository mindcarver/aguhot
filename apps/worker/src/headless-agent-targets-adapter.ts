/**
 * HeadlessAgentTargetsAdapter — the concrete TargetsAdapter backed by the Claude
 * Agent SDK (worker runtime only).
 *
 * WHY THIS LIVES IN apps/worker, NOT core: the SDK (@anthropic-ai/claude-agent-sdk)
 * bundles the Claude Code binary. Putting it in core would drag that heavy dep into
 * the web build (web imports @aguhot/core). So core owns the TargetsAdapter PORT +
 * service + stub; the worker owns this SDK-backed concrete adapter + resolves it
 * from env (targets-adapter-resolver). Mirrors the OpenAiCompatibleLlmAdapter-in-
 * core / resolver-in-worker split, except the heavy SDK stays fully worker-side.
 *
 * The SDK drives the SAME Claude Code engine the local CLI does — it ships its own
 * bundled executable (pathToClaudeCodeExecutable defaults to the built-in one). The
 * skill's methodology is injected by reading SKILL.md and appending it to the
 * claude_code preset system prompt (deterministic + auditable: promptVersion carries
 * the SKILL.md sha). The agent runs the skill's阶段A (extract+score) +阶段B (verify
 * codes via WebSearch/WebFetch);阶段C (技术面/买卖点) is excluded by the SCOPE_APPEND
 * instruction AND simply has no field in the output schema, so it can never land.
 *
 * outputFormat json_schema forces a structured result; the validated object arrives
 * on the terminal `result` message's `structured_output`. On timeout / abort /
 * error_max_structured_output_retries → returns null (honest degradation, the
 * service writes nothing).
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

import { RECOMMENDATION_FORBIDDEN_PHRASES } from "@aguhot/core";
import type {
  LlmTargetsArgs,
  LlmTargetsResult,
  TargetsAdapter,
  TargetCandidate,
} from "@aguhot/core";

/**
 * The 6-class forbidden phrase list (PRD §10), rendered for the agent so it avoids
 * them in the deepRead segments (which are guardrail-enforced at write time — a
 * forbidden phrase there would drop the deep read). Injecting the exact list cuts
 * failures at the source rather than discovering them at validation.
 */
const FORBIDDEN_PHRASES_TEXT = Object.values(RECOMMENDATION_FORBIDDEN_PHRASES)
  .flat()
  .map((p) => `「${p}」`)
  .join("、");

/**
 * Scoping instructions appended to the claude_code preset. Constrains the skill to
 * 阶段A+B, enforces the 70-point降级口径 (30 realtime points unscorable), and the
 * deep-read segment guardrail + length cap. Authoritative over the skill's own
 * "auto-run阶段C" CHECKPOINT (top-level system instruction wins).
 */
const SCOPE_APPEND = `
你在为财经事件平台的批处理 worker 工作。应用 ashare-news-investment-targets 技能的方法论，
只执行阶段A（标的提取+评分）与阶段B（前3名标的的代码/订单/减持核实）。
【禁止阶段C技术面分析】——系统无逐股行情数据，且不公开买卖点/止损/操作建议，不要输出任何价位或操作建议。
评分走技能降级规则：股价位置/板块强度/资金痕迹共30分无法获取，按70分口径换算，并在 downgradeNote 标注。
tier 只用这四个值之一："一级受益" | "二级受益" | "三级概念" | "伪受益/风险"。
deepRead 三段每段≤120字，禁用六类措辞（操作建议/收益预测/操纵框架/推荐强度/时点建议/过度确定），保持克制、可证。
deepRead 三段中绝对不要出现这些词（出现即判废）：${FORBIDDEN_PHRASES_TEXT}。
用"或受关注/待业绩印证/仍存不确定性"等条件性、描述性表达，不要用"建议/买入/卖出/目标价/止损/将上涨/必涨"等指令性或预测性表达。
完成后严格按 outputFormat 指定的 JSON schema 输出，不要写文件、不要改代码、不要输出额外解释。
`;

/**
 * The JSON schema the agent is forced to conform to (outputFormat). Notice阶段C's
 * price levels / 操作建议 have NO field here — they cannot be persisted even if the
 * agent reasons about them internally.
 */
const TARGETS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["newsConclusion", "transmissionPath", "candidates", "deepRead", "downgradeNote"],
  properties: {
    newsConclusion: { type: "string" },
    transmissionPath: { type: "string" },
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "tier", "benefitLogic", "scores", "toVerify", "evidenceChain"],
        properties: {
          name: { type: "string" },
          code: { type: ["string", "null"] },
          codeVerified: { type: "boolean" },
          tier: { enum: ["一级受益", "二级受益", "三级概念", "伪受益/风险"] },
          benefitLogic: { type: "string" },
          scores: {
            type: "object",
            additionalProperties: false,
            required: ["newsStrength", "linkStrength", "expectationGap", "earningsElasticity"],
            properties: {
              newsStrength: { type: "number" },
              linkStrength: { type: "number" },
              expectationGap: { type: "number" },
              earningsElasticity: { type: "number" },
            },
          },
          toVerify: { type: "array", items: { type: "string" } },
          evidenceChain: { type: "string" },
        },
      },
    },
    deepRead: {
      type: "object",
      additionalProperties: false,
      required: ["impactSurface", "beneficiaries", "riskPoints"],
      properties: {
        impactSurface: { type: "string" },
        beneficiaries: { type: "string" },
        riskPoints: { type: "string" },
      },
    },
    downgradeNote: { type: "string" },
  },
} as const;

/** Options for constructing the adapter. */
export interface HeadlessAgentTargetsAdapterOptions {
  /** Claude model id or alias (e.g. "sonnet", "claude-sonnet-4-6"). */
  model: string;
  /** Per-event USD cost ceiling (enforced by the SDK, print/headless only). */
  maxBudgetUsd: number;
  /** Max agent turns. */
  maxTurns: number;
  /** Path to the installed skill's SKILL.md. */
  skillPath: string;
  /** Scratch cwd for the agent (it must not touch the aguhot repo). */
  scratchDir: string;
  /** Soft timeout (ms) — aborts the query; should sit under the BullMQ hard timeout. */
  timeoutMs: number;
}

/**
 * SDK-backed TargetsAdapter. Reads + hashes SKILL.md once per process (the file is
 * immutable for the worker's lifetime; a skill update redeploys the worker).
 */
export class HeadlessAgentTargetsAdapter implements TargetsAdapter {
  private readonly opts: HeadlessAgentTargetsAdapterOptions;
  private readonly skillText: string;
  private readonly skillSha: string;

  constructor(opts: HeadlessAgentTargetsAdapterOptions) {
    this.opts = opts;
    this.skillText = readFileSync(opts.skillPath, "utf8");
    this.skillSha = createHash("sha256").update(this.skillText).digest("hex").slice(0, 12);
  }

  async generateInvestmentTargets(args: LlmTargetsArgs): Promise<LlmTargetsResult | null> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.opts.timeoutMs);
    try {
      let output: Record<string, unknown> | null = null;
      for await (const msg of query({
        prompt: buildPrompt(args),
        options: {
          model: this.opts.model,
          systemPrompt: {
            type: "preset",
            preset: "claude_code",
            append: SCOPE_APPEND + "\n--- 技能方法论（ashare-news-investment-targets）---\n" + this.skillText,
          },
          outputFormat: { type: "json_schema", schema: TARGETS_SCHEMA },
          // Web tools feed阶段B code/order/reduction verification only. No file
          // writes / shell — the agent is a read-only research run in a scratch cwd.
          allowedTools: ["WebSearch", "WebFetch"],
          cwd: this.opts.scratchDir,
          maxTurns: this.opts.maxTurns,
          maxBudgetUsd: this.opts.maxBudgetUsd,
          abortController: abort,
          // Deterministic: do not load project CLAUDE.md / settings (the skill is
          // injected via append above; the worker's own repo must not influence runs).
          settingSources: [],
        },
      })) {
        if (msg.type === "result" && msg.subtype === "success" && msg.structured_output !== undefined) {
          output = msg.structured_output as Record<string, unknown>;
        }
      }
      if (output === null) return null; // timeout / abort / error_max_structured_output_retries
      return mapToResult(output, this.opts.model, `skill:${this.skillSha}|scope-v1`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Build the user prompt that triggers + grounds the skill on this event's evidence. */
function buildPrompt(args: LlmTargetsArgs): string {
  const evidence = args.evidence
    .map(
      (e, i) =>
        `[${i + 1}] 来源：${e.sourceName}${e.publishedAt !== null ? `（${e.publishedAt.toISOString().slice(0, 10)}）` : ""}\n${e.summary}`,
    )
    .join("\n\n");
  return [
    "对以下财经事件执行 ashare-news-investment-targets 技能（阶段A + 阶段B），从证据中提取候选投资标的并评分。",
    "",
    `事件标题：${args.title}`,
    `摘要：${args.summary}`,
    "",
    "证据原文：",
    evidence,
    "",
    "完成后按 outputFormat 输出结构化结果。",
  ].join("\n");
}

/** Map the SDK's loosely-typed structured_output to the domain LlmTargetsResult. */
function mapToResult(
  raw: Record<string, unknown>,
  modelId: string,
  promptVersion: string,
): LlmTargetsResult {
  const deepRead = (raw.deepRead ?? {}) as Record<string, unknown>;
  return {
    newsConclusion: String(raw.newsConclusion ?? ""),
    transmissionPath: String(raw.transmissionPath ?? ""),
    candidates: Array.isArray(raw.candidates)
      ? (raw.candidates as TargetCandidate[])
      : [],
    deepRead: {
      impactSurface: String(deepRead.impactSurface ?? ""),
      beneficiaries: String(deepRead.beneficiaries ?? ""),
      riskPoints: String(deepRead.riskPoints ?? ""),
    },
    downgradeNote: String(raw.downgradeNote ?? ""),
    modelId: `claude:${modelId}`,
    promptVersion,
  };
}

/** Default skill path if env does not override (~/.claude/skills/...). */
export function defaultSkillPath(): string {
  return join(homedir(), ".claude", "skills", "ashare-news-investment-targets", "SKILL.md");
}
