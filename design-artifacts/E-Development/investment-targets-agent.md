# 投资标的 Agent · 设计文档

用 Claude Agent SDK 驱动 `ashare-news-investment-targets` 技能，**全量自动**为每个已发布事件生成两件产物：候选标的评分表 + 扎实的深读三段。无运营、成本不敏感。

## 决策锁定

| 项 | 值 |
|---|---|
| 运行时 | `@anthropic-ai/claude-agent-sdk`（自带 Claude Code 二进制） |
| 节奏 | 全量自动。自愈 cron 扫"无 `investment_targets` 行的已发布事件"，逐事件入队 |
| 产物 | ① 新表 `investment_targets`（候选池，`candidates Json`）② 现有 `deep_reads`（深读三段，复用现有投影/渲染） |
| 结构化 | `outputFormat: { type:'json_schema', schema }` —— API 级强制 |
| 技能加载 | 注入 `SKILL.md` 到 `append`（确定性，`promptVersion = skillSha|scope-v1`） |
| 阶段 C | schema 不收 → 不落库；`append` 明示跳过 |
| 护栏 | 候选表走"研究强度"口径（无买卖点/操作建议）；深读三段走现有 `passesRecommendationGuardrail` + ≤120字 |
| 运营 | 无。无 suppress / sampling console / 触发按钮。失败 → null → 不写行（诚实降级） |
| 预算 | `maxBudgetUsd = 2`、`maxTurns = 40`、280s 软超时（BullMQ 300s 硬超时） |

## 数据流

```
cron(每10min) → 找 published events 无 investment_targets 行
              → 逐事件入 investment-targets BullMQ queue
              → job: load HotEvent + member evidence
              → HeadlessAgentTargetsAdapter.generateInvestmentTargets()
                  └─ query() 跑技能阶段A+B，json_schema 强制输出
              → 校验（候选口径 + 深读护栏 + ≤120字）
              → append investment_targets 行 + append deep_reads 行
              → refreshPublishedInvestmentTargets + refreshPublishedReadModel
              → 详情页渲染候选表（新）+ 深读三段（现有块，内容变扎实）
```

一次 agent run 同时产出两件 —— 技能的传导链天然同时给出候选池和影响面/受益方/风险点。深读写进现有 `deep_reads`，走现有 `published_hot_event_deep_reads` 投影和现有详情页块，**不新增深读 UI**，只是内容变扎实。

## Prisma 新模型（镜像 `DeepRead`，去掉 suppress）

```prisma
// append-only 候选标的池（agent 驱动 ashare-news-investment-targets 技能产出）。
// 一行一事件，candidates 是序列化的候选数组（镜像 TrendBriefing.basedOnHotEventIds
// 的 Json 列用法 —— 无运营、无逐标的查询需求，不做规范化）。无 suppressedAt
// （无运营路径；失败即不写行，诚实降级）。publish-orchestrator 投影取最新行。
model InvestmentTarget {
  id               String   @id // UUIDv7 (newTraceId)
  hotEventId       String   @map("hot_event_id")
  newsConclusion   String   @map("news_conclusion")     // 新闻一句话结论
  transmissionPath String   @map("transmission_path")   // 新闻→行业变量→业绩/估值
  candidates       Json     // 候选数组，见下方 schema；含 tier/scores/toVerify/evidenceChain
  downgradeNote    String   @map("downgrade_note")      // "含30分待核验项，按70分口径换算"
  source           String   // ExplanationSource.Ai
  modelId          String   @map("model_id")            // e.g. "claude:sonnet-4-6"
  promptVersion    String   @map("prompt_version")      // "skill:<sha>|scope-v1"
  traceId          String?  @map("trace_id")
  createdAt        DateTime @default(now()) @map("created_at")

  hotEvent HotEvent @relation(fields: [hotEventId], references: [id], onDelete: Cascade)

  @@index([hotEventId])
  @@index([createdAt])
  @@map("investment_targets")
}

// 公开读模型投影（latest 行）。publish-orchestrator 是唯一写者。
model PublishedHotEventInvestmentTargets {
  hotEventId       String   @id @map("hot_event_id")
  newsConclusion   String   @map("news_conclusion")
  transmissionPath String   @map("transmission_path")
  candidates       Json
  downgradeNote    String   @map("downgrade_note")
  generatedAt      DateTime @map("generated_at")
  traceId          String?  @map("trace_id")
  updatedAt        DateTime @updatedAt @map("updated_at")

  hotEvent HotEvent @relation(fields: [hotEventId], references: [id], onDelete: Cascade)

  @@map("published_hot_event_investment_targets")
}
```

## Agent 输出 JSON Schema（`outputFormat`）

```ts
const TARGETS_SCHEMA = {
  type: "object",
  required: ["newsConclusion", "transmissionPath", "candidates", "deepRead", "downgradeNote"],
  properties: {
    newsConclusion: { type: "string" },
    transmissionPath: { type: "string" },
    candidates: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "tier", "benefitLogic", "scores", "toVerify", "evidenceChain"],
        properties: {
          name: { type: "string" },
          code: { type: ["string", "null"] },          // null = 待核验
          codeVerified: { type: "boolean" },           // 阶段B联网核实过没
          tier: { enum: ["一级受益", "二级受益", "三级概念", "伪受益/风险"] },
          benefitLogic: { type: "string" },            // 传导链受益逻辑
          scores: {
            type: "object",
            required: ["newsStrength", "linkStrength", "expectationGap", "earningsElasticity"],
            properties: {
              newsStrength: { type: "number" },         // /20
              linkStrength: { type: "number" },          // /20
              expectationGap: { type: "number" },        // /15
              earningsElasticity: { type: "number" },    // /15
              // 股价位置/板块强度/资金痕迹 = 30分，系统无逐股行情，不评
            }
          },
          toVerify: { type: "array", items: { type: "string" } },
          evidenceChain: { type: "string" },
        }
      }
    },
    deepRead: {
      type: "object",
      required: ["impactSurface", "beneficiaries", "riskPoints"],
      properties: {
        impactSurface: { type: "string" },   // ≤120字，影响面
        beneficiaries: { type: "string" },   // ≤120字，受益方
        riskPoints: { type: "string" },      // ≤120字，风险点
      }
    },
    downgradeNote: { type: "string" },
  }
};
```

## `TargetsAdapter` 端口 + SDK 实现

```ts
// packages/core/src/modules/investment-targets/types.ts
export interface TargetsAdapter {
  generateInvestmentTargets(args: {
    hotEventId: string;
    title: string;
    summary: string;
    evidence: ReadonlyArray<{ sourceName: string; summary: string; publishedAt: Date | null }>;
  }): Promise<LlmTargetsResult | null>; // null = 超时/abort/校验不过 → 诚实降级
}
```

```ts
// packages/core/src/modules/investment-targets/headless-agent-targets-adapter.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const SCOPE_APPEND = `
你在为财经事件平台的批处理 worker 工作。应用 ashare-news-investment-targets 技能的方法论，
只执行阶段A（标的提取+评分）与阶段B（前3名标的的代码/订单/减持核实）。
【禁止阶段C技术面分析】——系统无逐股行情，且不公开买卖点/止损/操作建议。
评分走技能降级规则：股价位置/板块强度/资金痕迹共30分无法获取，按70分口径换算并标注。
deepRead 三段每段≤120字，禁用六类措辞（操作/收益预测/操纵框架/推荐强度/时点/过度确定）。
完成后按 outputFormat schema 输出，不要写文件、不要改代码。
`;

export class HeadlessAgentTargetsAdapter implements TargetsAdapter {
  constructor(private opts: {
    model: string; maxBudgetUsd: number; maxTurns: number;
    skillPath: string; scratchDir: string;
  }) {}

  async generateInvestmentTargets(args): Promise<LlmTargetsResult | null> {
    const skillText = readFileSync(this.opts.skillPath, "utf8");
    const skillSha = createHash("sha256").update(skillText).digest("hex").slice(0, 12);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 280_000);

    try {
      let out: any = null;
      for await (const msg of query({
        prompt: buildPrompt(args),
        options: {
          model: this.opts.model,
          systemPrompt: { type: "preset", preset: "claude_code",
                          append: SCOPE_APPEND + "\n--- 技能方法论 ---\n" + skillText },
          outputFormat: { type: "json_schema", schema: TARGETS_SCHEMA },
          allowedTools: ["WebSearch", "WebFetch"],
          cwd: this.opts.scratchDir,
          maxTurns: this.opts.maxTurns,
          maxBudgetUsd: this.opts.maxBudgetUsd,
          abortController: abort,
          settingSources: [],
        },
      })) {
        if (msg.type === "result" && msg.subtype === "success" && msg.structured_output)
          out = msg.structured_output;
      }
      if (!out) return null; // error_max_structured_output_retries 或 abort
      return mapToResult(out, this.opts.model, `skill:${skillSha}|scope-v1`);
    } finally { clearTimeout(timer); }
  }
}
```

`buildPrompt`：把 `title + summary + member evidence 全文`拼成触发技能的 prompt。

## Worker（第 10 个 BullMQ queue）

```
apps/worker/src/queues/investment-targets-queue.ts   ← 镜像 deep-read-queue 结构
apps/worker/src/targets-adapter-resolver.ts          ← 从 env 解析 HeadlessAgentTargetsAdapter
```

job handler：`load HotEvent + evidence → resolve adapter（缺凭证→undefined→null）→ generateInvestmentTargets → 校验 → append investment_targets + append deep_reads → refreshPublishedInvestmentTargets + refreshPublishedReadModel`。

**触发**：`scheduleInvestmentTargetsSelfHeal`，每 10min 扫 `published events 无 investment_targets 行`，逐事件 `queue.add`。镜像 `schedulePublishTimelineSelfHeal` 的写法。逐事件一次（不重跑；evidence 更新后的重算 deferred）。

注册进 `apps/worker/src/index.ts`（第 10 个 worker）。

## publish-orchestrator 投影

新增 `projectInvestmentTargets`（镜像 `projectDeepRead`）：读 latest `investment_targets` 行 → upsert `published_hot_event_investment_targets`。在 `refreshPublishedReadModel` 旁加 `refreshPublishedInvestmentTargets`，job 成功后调。

## 详情页

新增候选标的表组件，读 `published_hot_event_investment_targets`，渲染 `candidates` 数组成表（公司/代码/分层/4维分/待核验）。深读三段继续走现有 `published_hot_event_deep_reads` 块（内容变扎实，UI 不动）。

## Env 配置

```
ANTHROPIC_API_KEY=...          # SDK 鉴权（bare/SDK 都走 API key）
AGENT_MODEL=claude-sonnet-4-6  # 或 alias 'sonnet'
AGENT_MAX_BUDGET_USD=2
AGENT_MAX_TURNS=40
ASHARE_SKILL_PATH=~/.claude/skills/ashare-news-investment-targets/SKILL.md
AGENT_SCRATCH_DIR=/tmp/aguhot-agent
```

`targets-adapter-resolver.ts`：任一缺失 → 返回 undefined → 诚实降级（同 `resolveLlmAdapter` 模式）。

## 失败与降级

- agent 超时 / abort / `error_max_structured_output_retries` → `generateInvestmentTargets` 返回 null → 不写两张表的任何一张 → 下个 cron 周期重试
- 候选口径违规（出现买卖点/操作建议）→ service 层校验抛错 → job 失败 → BullMQ 重试 → 仍失败则该事件本轮无产物（cron 下轮再试）
- 深读三段护栏/≤120字不过 → 同上 fail-fast

## 文件级改动清单

| 层 | 改动 |
|---|---|
| `packages/core/prisma/schema.prisma` | 加 `InvestmentTarget` + `PublishedHotEventInvestmentTargets` |
| `packages/core/src/modules/investment-targets/` | 新模块：`types.ts` / `targets-service.ts` / `headless-agent-targets-adapter.ts` / `index.ts`（barrel） |
| `packages/core/src/modules/publish-orchestrator/` | `projectInvestmentTargets` + `refreshPublishedInvestmentTargets` |
| `packages/core/src/index.ts` | barrel 导出新模块 |
| `apps/worker` | 新依赖 `@anthropic-ai/claude-agent-sdk`；`queues/investment-targets-queue.ts` + `targets-adapter-resolver.ts`；`index.ts` 注册 + `scheduleInvestmentTargetsSelfHeal` |
| `apps/web` | 详情页候选表组件；`getPublishedHotEventDetail` 取 `published_hot_event_investment_targets` |

## 明确不做（deferred）

- 运营 suppress / sampling console（无运营）
- evidence 更新后的 targets 重算（cron 只补"无行"事件）
- 阶段 C 技术面/买卖点（schema 不收，永不公开）
- 逐股实时行情接入（那 30 分永远"待核验"，70 分口径诚实标注）
- 候选代码的 A股主表校验（标 codeVerified + 待核验，不阻塞）
