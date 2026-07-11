---
title: '列表卡 AI 解读生成（LLMAdapter 端口骨架 + RecommendationReason 生成链）'
type: 'feature'
created: '2026-07-12'
status: 'done'
baseline_revision: 'da46e6ea8630b7cf502fdec4cff0fa3be92385db'
final_revision: 'd605befce5f300cf1664df146d6bcfe49ed8f228'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-2-timeline-home-and-card-component.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** 时间流卡的「AI 解读」slot 已由 Story 4.2 渲染好——卡片读 `PublishedTimelineEntry.recommendationReason`，非空时渲染 `AiLabel`+文本，为空则不渲染（`apps/web/.../timeline-card.tsx`）。`published_timeline_entries.recommendation_reason` 列已存在但无任何代码写入。codebase 现状：无 `LLMAdapter` 端口（`explain-service.ts` 明文 deferred）、无 `RecommendationReason` 表、无生成 worker。因此卡面 AI 解读恒为空。

**Approach:** 照抄 `DigestAdapter` 先例落地 `LLMAdapter` 端口骨架（types 接口 + 薄 re-export + TEST-ONLY 确定性 Stub + 服务层 honest-degradation + worker `const adapter = undefined` 注入点）。新增 `RecommendationReason` append-only 表（source/modelId/promptVersion/createdAt，NFR-7 版本化与溯源）。让 `published_timeline_entries.recommendation_reason` 成为「最新 RecommendationReason 行的投影」（publish-orchestrator 仍是该列唯一写者），随发布 gate-atomic 可见。新增 `recommendation-reason` 生成 worker + 6 类措辞黑名单（PRD §10）fail-fast 校验。V1 用 Stub 跑通链路，真实 LLM provider 注入点留好但不接入。

## Boundaries & Constraints

**Always:**
- `LLMAdapter` 端口形态照抄 `DigestAdapter`：`types.ts` 内接口（单方法 `generateReason(args): Promise<{reason:string}|null>`）+ `llm-adapter.ts` 薄 re-export（带 resolve-at-call-site + honest degradation 注释）+ `stub-llm-adapter.ts`（TEST-ONLY 确定性 Stub，导出固定常量 `STUB_RECOMMENDATION_REASON`）+ 服务 `adapter === undefined` 时返回 null 不写库 + worker 内 `const adapter = undefined` 注入点（带 `ponytail:` 注释）。
- publish-orchestrator 仍是 `published_timeline_entries` 的唯一写者（AD-2/AD-3b）。`recommendation_reason` 列由投影（`projectTimelineFields` + 两处 refresh upsert）从最新 `RecommendationReason` 行派生；worker 不直写该列。
- 每条 `RecommendationReason` append-only，携带 `source="ai"` + `modelId` + `promptVersion` + `createdAt`（NFR-7）。
- 措辞黑名单以**正向可枚举常量**承载 PRD §10 六类（动作/收益预测/操纵框架/推荐强度/时点建议/过度确定），生成结果**写入前** fail-fast 校验：命中或超 40 字即抛错 → worker 逐条 try/catch 隔离捕获 → 该事件留 null（缺失态），不中止整批。
- 真实 LLM provider 注入点留好但 V1 不接入：worker resolve `adapter = undefined` → 服务返回 null 不写库 → prod honest degradation。**不新增任何第三方 LLM SDK 依赖**；Stub 仅 verify/e2e 使用，`apps/worker` 运行时不得 import Stub。

**Block If:** 无（真实 provider 采购/接入、retry 循环、worker 自动调度均在范围外，见 Never/Design Notes）。

**Never:**
- 不新增任何 LLM SDK 依赖（V1 仅 Stub）。
- 不让 `apps/worker` 运行时 import `StubLlmAdapter`（TEST-ONLY）。
- 不绕过 publish-orchestrator 直写 `published_timeline_entries.recommendation_reason`（worker 只 append `RecommendationReason` + 触发既有 refresh 投影路径）。
- 不引入 retry 循环（违反→落缺失态；下次 worker 运行自然重试，归 deferred）。
- 不为卡面新增「AI 解读暂缺」显式文案——卡片缺失态即 slot 不渲染（4.2 已实现，见 Design Notes）。
- 不复用 `ExplanationVersion` 表（固定三段式 + NOT NULL hotEventId，不适配单行解读；新增独立表）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 候选事件 + Stub 生成 | 已发布/候选 HotEvent 有证据、无 RecommendationReason；传入 StubLlmAdapter | 写入一条 RecommendationReason（source=ai，modelId/promptVersion/createdAt 齐全）；timeline 投影后该 hotEventId 的 recommendation_reason 非空，卡片渲染 AiLabel+reason | 无 |
| V1 prod honest degradation | worker 注册运行（adapter=undefined） | 服务返回 null、不写库；timeline.recommendation_reason 保持 null；卡片 slot 不渲染（缺失态） | 无错误，诚实降级 |
| 事件缺失/零证据 | hotEventId 不存在或无成员证据 | 返回 null，不写库 | 无错误 |
| 黑名单/超长命中 | adapter 返回命中 6 类黑名单或 >40 字的 reason | 抛错，不写 RecommendationReason 行；worker 逐条捕获，该事件留 null | fail-fast，不中止整批 |
| 重发布/self-heal 幂等 | 事件已有 reason，重发布或 refreshPublishedTimelineAll 重跑 | 投影从最新 RecommendationReason 重新派生该列（幂等，stable id 不变） | 无 |

</intent-contract>

## Code Map

- `packages/core/prisma/schema.prisma` -- 新增 `RecommendationReason` model + HotEvent 反向关系；`PublishedTimelineEntry.recommendation_reason` 列已存在（行 777，无需改）。
- `packages/core/src/modules/explanation/types.ts` -- 新增 `LLMAdapter` 端口接口 + RecommendationReason 相关类型；既有 `ExplanationSource`（"ai" 值已预留）复用。
- `packages/core/src/modules/explanation/explain-service.ts` -- 既有 deferred 注释参考（不改）。
- `packages/core/src/modules/digest/types.ts` + `digest-adapter.ts` + `stub-digest-adapter.ts` + `digest-service.ts` -- **端口先例**，逐字对照形态。
- `packages/core/src/modules/digest/digest-service.ts` -- `noInvestAdvice` + `ADVICE_KEYWORDS` fail-fast 先例（黑名单校验照抄此模式）。
- `packages/core/src/modules/publish-orchestrator/timeline-read-model.ts` -- `projectTimelineFields`（纯函数）+ `refreshPublishedTimelineForEvent`/`refreshPublishedTimelineAll` 两处 upsert；create 现硬写 `recommendationReason: null`（行 260/370），update 现省略该字段（行 263-274/373-384）——改为派生。
- `apps/worker/src/queues/explain-queue.ts` -- worker 模板（job data 仅 traceId、worker 自发现候选、逐条隔离、无 auto-trigger）。
- `apps/worker/src/queues/daily-digest-queue.ts` -- `const adapter = undefined` 注入点先例。
- `apps/worker/src/index.ts` -- 第 8 个 worker 装配点。
- `apps/worker/src/verify-digest.ts` -- Stub 驱动 verify 脚本模板。
- `apps/web/app/(public)/_components/timeline-card.tsx` -- 卡片 slot 已实现（不改）。

## Tasks & Acceptance

**Execution:**
- `packages/core/prisma/schema.prisma` -- 新增 `RecommendationReason` model（`id` UUIDv7 app 赋 / `hotEventId` / `reason String` / `source String` / `modelId` / `promptVersion` / `traceId?` / `createdAt`，FK `onDelete: Cascade`，`@@index([hotEventId])` `@@index([createdAt])`，`@@map("recommendation_reasons")`），并在 `HotEvent` 加 `recommendationReasons RecommendationReason[]` 反向关系 -- 真相源表（NFR-7）。
- `packages/core/prisma/migrations/20260712000000_add_recommendation_reason/migration.sql` -- `pnpm --filter @aguhot/core db:migrate` 生成并提交 -- schema 落地。
- `packages/core/src/modules/explanation/types.ts` -- 新增 `LlmSource`/`LlmReasonResult`/`RecommendationReasonRecord` 类型与 `LLMAdapter` 端口接口（`generateReason(args:{ hotEventId:string; title:string; summary:string }): Promise<LlmReasonResult|null>`，含 modelId/promptVersion）；复用 `ExplanationSource` -- 端口契约（对照 `digest/types.ts`）。
- `packages/core/src/modules/explanation/llm-adapter.ts` -- 薄 re-export `LLMAdapter`（from `./types.js`），带 resolve-at-call-site + honest degradation + 「V1 worker resolves undefined」注释，并列出同构兄弟（theme/association/market-reaction/source-ingest/digest adapter） -- 端口主页（对照 `digest-adapter.ts`）。
- `packages/core/src/modules/explanation/stub-llm-adapter.ts` -- TEST-ONLY 确定性 Stub：导出 `STUB_RECOMMENDATION_REASON`（≤40 字、过黑名单的固定中文串，如「证据链已归档，事件仍在演化。」），`generateReason` 每次返回该串 + 固定 `modelId="stub:v1"` `promptVersion="reason-stub-v1"`；首行注释标 `TEST-ONLY: NOT wired in worker/prod runtime` -- verify/e2e 可断言（对照 `stub-digest-adapter.ts`）。
- `packages/core/src/modules/explanation/reason-service.ts` -- 新增 `generateRecommendationReason({prisma,traceId,hotEventId,adapter?})`：`adapter===undefined`→返回 null 不写库；加载 HotEvent（缺失→null）；调 `adapter.generateReason`（传入 title/summary 作上下文）；结果 fail-fast 校验（非空、`reason.length <= 40`、`passesRecommendationGuardrail`）违例抛错；通过则 append 一条 `RecommendationReason`（source=ai）。导出正向可枚举常量 `RECOMMENDATION_FORBIDDEN_PHRASES`（六类分组）+ `passesRecommendationGuardrail(text)` -- 生成链 + 黑名单（NFR-3/NFR-7/SM-7）。
- `packages/core/src/modules/explanation/index.ts` 与 `packages/core/src/index.ts` -- barrel 导出 `generateRecommendationReason` / `LLMAdapter` / `StubLlmAdapter` / `STUB_RECOMMENDATION_REASON` / `RECOMMENDATION_FORBIDDEN_PHRASES` / `passesRecommendationGuardrail` / 相关类型（Stub 需供 verify import，参照 StubDigestAssembly 导出先例） -- 对外契约。
- `packages/core/src/modules/publish-orchestrator/timeline-read-model.ts` -- `TimelineProjectionInput` 加 `recommendationReasons: ReadonlyArray<{reason:string}>`（take 1，orderBy createdAt desc/id desc）；`projectTimelineFields` 返回值加 `recommendationReason: string|null`（最新行?.reason ?? null）；两处事件 load（refreshPublishedTimelineForEvent 行 196-223、refreshPublishedTimelineAll 行 300-328）各加 `recommendationReasons` nested select；两处 upsert 的 `create` 与 `update` 均设置 `recommendationReason: projected.recommendationReason`（删除「create 硬写 null / update 省略」的旧逻辑）-- 让 reason 作为投影随发布 gate-atomic 可见，唯一写者不变。
- `apps/worker/src/queues/recommendation-reason-queue.ts` -- 新增 queue+worker 同文件（`RECOMMENDATION_REASON_QUEUE_NAME="recommendation-reason"`，lazy Queue 单例 `getRecommendationReasonQueue` + `enqueueRecommendationReason(traceId)` + `registerRecommendationReasonWorker`，`removeOnComplete:100`/`removeOnFail:500`，worker `await import("@aguhot/core")`，`const adapter = undefined` + `// ponytail: real provider wired when procured`）；handler 查 `publicationStatus in [candidate,published]` 且无 `recommendationReasons` 的事件（排除 rejected/taken_down），逐条 try/catch 调 `generateRecommendationReason`，成功且事件已 published 时调 `refreshPublishedTimelineForEvent({prisma,traceId,hotEventId,action:"publish"})` 复用同一 upsert 让新 reason 立即上卡 -- 第 8 个生成 worker（对照 explain-queue + daily-digest-queue）。
- `apps/worker/src/index.ts` -- import + `registerRecommendationReasonWorker()` + 加入 shutdown `close()` 列表 + 顶部注释追加「Story 5.1 added the recommendation-reason worker」-- 装配。
- `apps/worker/src/verify-reason.ts` -- 新增 Stub 驱动 verify 脚本（对照 `verify-digest.ts`）：用 `StubLlmAdapter` 跑 `generateRecommendationReason` → 断言 `RecommendationReason` 行写入且字段齐全 → 调投影后断言该 hotEventId 的 `published_timeline_entries.recommendation_reason` 非空 → 断言黑名单/超长路径抛错且不写库 → 断言 `adapter===undefined` 返回 null 不写库 → 打印覆盖率（非空/总数）。`packages/core/package.json` 加 `verify:reason-logic` 脚本（或在 worker 侧以 tsx 运行，遵循既有 verify 约定） -- 证明链路（SM-7 可观测）。

**Acceptance Criteria:**
- Given `LLMAdapter` 端口此前不存在，When 5.1 dev 完成，Then `packages/core/src/modules/explanation/` 下出现 `types.ts`(接口) + `llm-adapter.ts`(re-export) + `stub-llm-adapter.ts`(TEST-ONLY) + `reason-service.ts` 四件套，形态与 `digest/` 一致，且 `apps/worker` 不 import Stub。
- Given 候选/已发布 HotEvent 有证据且无 RecommendationReason，When 用 `StubLlmAdapter` 调 `generateRecommendationReason` 并触发该事件 timeline 投影，Then 写入一条 `RecommendationReason`（source=ai、modelId、promptVersion、createdAt 齐全），`published_timeline_entries.recommendation_reason` 非空，卡面渲染 `AiLabel`+reason。
- Given V1 prod（worker `adapter=undefined`），When recommendation-reason worker 运行，Then 服务返回 null、不写库、`recommendation_reason` 保持 null、卡片 slot 不渲染（缺失态），prod honest degradation。
- Given adapter 返回命中黑名单或 >40 字的 reason，When `generateRecommendationReason` 校验，Then 抛错、不写行；worker 逐条捕获、该事件留 null、整批不中止。
- Given 事件已有 reason，When 重发布或 `refreshPublishedTimelineAll` 重跑，Then `recommendation_reason` 由投影从最新 `RecommendationReason` 重新派生（幂等，stable id 不变），且 publish-orchestrator 仍是该列唯一写者。

## Spec Change Log

（空。本次 review 无 bad_spec 回环——所有发现均为实现/测试层 patch 或 defer/reject，未触及 `<intent-contract>` 与 spec 主体。）

## Review Triage Log

### 2026-07-12 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (medium 2, low 3)
- defer: 3: (low 3)
- reject: 7
- addressed_findings:
  - `[medium]` `[patch]` `validateReason` 长度校验改为先 trim 一次、再按 Unicode 码点（`[...str].length`）计数，对齐 CJK「字」契约（原先用 UTF-16 码元、且对未 trim 值计数）；写入与投影均用 trim 后的 reason。reason-service.ts。
  - `[medium]` `[patch]` 黑名单补全：补上原先漏掉的 动作类（持仓/增持/减持/建议买/建议卖）与 收益预测类（涨停/跌停/大涨/大跌）——digest 的 `ADVICE_KEYWORDS` 先例与 PRD §10 类目都要求这些词。reason-service.ts。
  - `[low]` `[patch]` worker 无 adapter 分支去掉每次 job 的 `hotEvent.count` 反连接全表扫描（返回值无人消费；SM-7 在 published 读模型上度量，不在此返回值）——改为返回常量，对齐 daily-digest-queue。recommendation-reason-queue.ts。
  - `[low]` `[patch]` 修正 worker doc：原文谎称 generator 幂等（重跑会追加新行）；实情是幂等性由候选查询的 `recommendationReasons: { none: {} }` 前置过滤保证，generator 每次都追加，调用方须自行去重。recommendation-reason-queue.ts。
  - `[medium]` `[patch]` 补齐 verify-reason 验证缺口：新增 exactly-40（接受）+ exactly-41（拒绝）边界测试钉死上限 off-by-one；新增 self-heal（`refreshPublishedTimelineAll`）reason 投影断言（spec 的最终一致性安全网此前无测试）；让 SM-7 分母有意义（再 seed 一个无 reason 的已发布事件 → 1/2，而非平凡的 1/1）；去歧义 overlength fixture（60 字，原先误标 46）。verify-reason.ts。
  - Rejected（附理由）：缺失态 R1 读法（卡面可见占位）——by design；Story 4.2 已随 `hasRecommendation ? slot : null` 落地卡面，slot 缺席是唯一自洽的缺失态读法，5.1 填充 slot 而非重设计卡面（spec Design Note 已记录该依据）。NFR-3/NFR-7「须在卡面可见」+ V1 prod SM-7 为 0% 均归约到同一已决读法（卡面显式 AiLabel + 审计行隐式溯源 + NFR-7 版本化；V1 honest degradation 由 epic AC 明示，对齐 DigestAdapter）。`source String` + 读侧 cast、包级 barrel 导出 Stub/护栏、动态 import 类型——均为 codebase 既有约定（ExplanationVersion/PublicationStatus 亦是 String 列；digest 同样从包根导出 Stub）。Stub 模块加载期长度断言——verify 已覆盖。verify-timeline resetState 不清 recommendation_reasons——今日靠 FK cascade 安全。完整 BullMQ worker 集成测试——符合既有 verify 约定（直接测 service，不测 worker；append+refresh 组合已被覆盖）。缺失事件「不调用 adapter」的次序不变式——结果已被测。
  - Deferred（见 deferred-work.md）：worker findMany 与逐条 append 之间的 `publicationStatus` TOCTOU（刚被 rejected/taken_down 的事件留下孤儿 reason 行；罕见竞争、后果低）；多 worker 并发锁（今日单 worker，与其余 worker 一致；仅在未来多进程扩容时产生重复行）；dev 库 `20260710141148_association_read_models` 既有迁移 checksum 漂移（早于本 story）。

## Design Notes

- **LLMAdapter 归属 explanation 模块**：epic AC 明示「照抄 DigestAdapter 先例」，而 DigestAdapter 居其本模块。`ponytail:` 5.2 DeepRead / 5.3 TrendBriefing 到来时若嫌跨模块 import，再提升到 shared 位置——接口形态通用，提升是搬运非重设计。
- **卡片缺失态语义**：AC「生成失败时卡片显示缺失态而非留空」的可观测锚定 = 卡片要么渲染（`AiLabel` + 非空 reason 文本）要么不渲染该 slot，**绝不**渲染「只有 AiLabel 无文本」的空盒（4.2 已实现 `hasRecommendation ? slot : null`）。SM-7 = 非空 `recommendation_reason` 行数 / 总 published 行数。依据：4.2 已随其 spec 把卡片缺失态定为「slot 缺席」；UX「显式缺失态 + 最后更新时间」适用于**详情页深读**（5.2）而非单行卡片 hook；在 ≤5% 卡片上加「暂缺」文案会违反「AI 解读视觉权重 ≤ 事实摘要」。
- **唯一写者不变**：`recommendation_reason` 由 `projectTimelineFields` 派生（非 worker 直写），保持 publish-orchestrator 对 `published_timeline_entries` 的唯一写权（AD-2/AD-3b）。已发布事件新增 reason 时，worker 调既有 `refreshPublishedTimelineForEvent(action:"publish")` 复用同一 upsert，让新 reason 立即上卡而不必等 15min self-heal。
- **黑名单 6 类示例**（正向可枚举，写入前 substring 校验）：动作类「买入/卖出/建仓/加仓/减仓/清仓」、收益预测类「必涨/必跌/翻倍/翻番/暴涨/暴跌」、操纵框架类「主力/庄家/洗盘/拉升/出货/诱多」、推荐强度类「强烈推荐/首推/首选/必买」、时点建议类「抄底/逃顶/目标价/止损位」、过度确定类「必将/一定/必然/肯定」。Stub 固定串须过此黑名单（verify self-check 兜底）。
- **延后**（归入 deferred-work.md 既有 pipeline 编排项）：真实 LLM provider 接入、retry 循环、worker 自动调度与 event-cluster 链式触发。

## Verification

**Commands:**
- `pnpm --filter @aguhot/core db:migrate -- --name add_recommendation_reason` -- 迁移生成并应用成功（表 `recommendation_reasons` + 外键创建）。
- `pnpm typecheck` -- 全仓类型检查通过（含投影派生改动与新端口）。
- `pnpm lint` -- 通过。
- `pnpm --filter @aguhot/core verify:reason-logic`（或 `tsx apps/worker/src/verify-reason.ts`） -- Stub 链路：行写入、投影非空、黑名单/超长落 null、`adapter===undefined` 不写库、覆盖率断言全绿。

**Manual checks (if no CLI):**
- 确认 `apps/worker` 源码 grep 不到 `StubLlmAdapter` import（TEST-ONLY 隔离）。
- 确认 `package.json` 无新增 LLM SDK 依赖。

## Auto Run Result

Status: done

**实现摘要：** 落地 Story 5.1「列表卡 AI 解读生成」——照抄 `DigestAdapter` 先例的 `LLMAdapter` 端口骨架（types + 薄 re-export + TEST-ONLY Stub + 服务层 honest-degradation + worker `const adapter = undefined` 注入点）；新增 `RecommendationReason` append-only 表（source/modelId/promptVersion/createdAt，NFR-7 溯源）；让 `published_timeline_entries.recommendation_reason` 成为「最新 RecommendationReason 行的投影」（publish-orchestrator 仍为唯一写者，AD-2/AD-3b）；新增 `recommendation-reason` worker（第 8 个 worker，V1 honest degradation，不接真实 provider）+ 6 类措辞黑名单（PRD §10）fail-fast 校验。卡面 slot 由 Story 4.2 已渲染，本 story 仅填充内容——不新增 LLM SDK 依赖。

**改动文件：**
- `packages/core/prisma/schema.prisma`（+ `RecommendationReason` model + HotEvent 反向关系）
- `packages/core/prisma/migrations/20260712000000_add_recommendation_reason/migration.sql`（新表 + FK Cascade + 索引）
- `packages/core/src/modules/explanation/types.ts`（`LLMAdapter` 接口 + 相关类型）
- `packages/core/src/modules/explanation/llm-adapter.ts`（端口薄 re-export，新文件）
- `packages/core/src/modules/explanation/stub-llm-adapter.ts`（TEST-ONLY 确定性 Stub，新文件）
- `packages/core/src/modules/explanation/reason-service.ts`（生成链 + 6 类黑名单 + 校验，新文件）
- `packages/core/src/modules/explanation/index.ts` / `packages/core/src/index.ts`（barrel 导出）
- `packages/core/src/modules/publish-orchestrator/timeline-read-model.ts`（投影从最新 reason 派生该列）
- `apps/worker/src/queues/recommendation-reason-queue.ts`（第 8 个 worker，新文件）
- `apps/worker/src/index.ts`（装配第 8 个 worker）
- `apps/worker/src/verify-reason.ts`（Stub 驱动 verify，22 断言，新文件）
- `apps/worker/package.json`（`verify:reason` 脚本）

**Review 结果：** 4 层并行 review（blind-hunter / edge-case-hunter / verification-gap / intent-alignment）。无 intent_gap、无 bad_spec。应用 5 个 patch（长度校验改为 trim + 码点计数；黑名单补全 9 个漏词；worker 无 adapter 分支去掉多余 COUNT；修正 worker doc 幂等性误述；verify-reason 补边界测试 + self-heal 投影断言 + SM-7 有意义分母）。defer 3 项（见 deferred-work.md）。reject 7 项（缺失态/标签/版本等 by-design 与既有 codebase 约定）。

**Follow-up review 建议：** false —— 最终 pass 的改动局部（2 medium + 3 low patch，均已类型/lint/verify 覆盖，无 API/数据模型/架构变更）。黑名单为有意保守、按 spec 设计迭代扩充（「一行编辑」），后续 review 可增量补词，非正确性问题。

**Verification 执行：**
- `pnpm typecheck`（全 5 包）→ 绿
- `pnpm lint`（全 5 包）→ 绿
- `prisma migrate status` → up to date（12 migrations），`recommendation_reasons` 表 + FK 已建
- `pnpm --filter @aguhot/worker verify:reason` → **PASS 22/22**（行写入、投影非空、AD-5 append-only、self-heal 投影、adapter-undefined 不写库、6 类 × 全词黑名单拒绝、>40 字拒绝、exactly-40 接受 / exactly-41 拒绝、fail-fast 不写行、缺失事件 → null、SM-7 1/2 分母）
- `pnpm --filter @aguhot/worker verify:timeline` → **PASS 31/31**（投影改动无 4.1 回归）
- grep 确认 `apps/worker` 不 import `StubLlmAdapter`；`package.json` 无 LLM SDK 依赖

**Residual risks / artifacts：**
- dev 库既有迁移 `20260710141148_association_read_models` checksum 漂移（早于本 story；已登记 deferred-work，不影响 5.1 迁移）。
- `verify:reason` / `verify:timeline` 需本地 PG `aguhot_dev` + `REDIS_URL`。
- V1 prod 因 worker 解析 `adapter = undefined`，AI 解读覆盖率为 0%（honest degradation，待真实 provider 接入；epic AC 明示，对齐 DigestAdapter）。

