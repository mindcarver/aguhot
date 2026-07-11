---
title: '事件级 AI 深读（DeepRead 真相表 + 生成链 + 详情页投影与渲染）'
type: 'feature'
created: '2026-07-12'
status: 'done'
baseline_revision: '09cc661f07a7acdaaf1eda8a6598a45def0025bd'
final_revision: 'a132f5a1b99dde4865608a176f8a58e71fcfc72f'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-5-1-card-recommendation-reason.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** 详情页「为什么重要」区块今天只渲染确定性模板生成的 `ExplanationVersion.whyItMatters`（单段），其下没有任何 AI 深读。epic AC（epics.md:669-673）要求在该区块**下**生成 AI 深读（影响面/受益方/风险点三段、带 AI 标识），且与证据时间线一致、不得编造（NFR-2），作为 append-only 版本化记录（AD-5/NFR-7）。codebase 现状：`LLMAdapter` 端口（5.1 落地）只有 `generateReason` 单行方法；无 `DeepRead` 表、无生成 service、无投影、详情页无渲染槽。

**Approach:** 照抄 5.1 的端口+service+投影+worker 先例与 2.1/2.2/2.3 的「每关注点一真相表 + 一 published_* 投影」先例：(1) 在 `LLMAdapter` 端口加第二个方法 `generateDeepRead`（5.1 注释已预告 5.2 复用本端口）；(2) 新增 `DeepRead` append-only 真相表（source/modelId/promptVersion/createdAt，NFR-7）+ `published_hot_event_deep_reads` 投影表；(3) 新增 `deep-read-service`（`adapter===undefined`→null 不写库；title/summary/evidence 作上下文；6 类黑名单 + 每段长度 fail-fast 校验）；(4) `projectDeepRead` 作为 `refreshPublishedReadModel` 的第 7 个投影，takedown 一并删除；(5) 新增第 9 个 worker `deep-read-queue`（镜像 5.1 recommendation-reason-queue）；(6) 详情页「为什么重要」下渲染三段 + `AiLabel`。V1 用 Stub 跑通，真实 provider 注入点留好但不接入。

## Boundaries & Constraints

**Always:**
- `DeepRead` 是独立 append-only 真相表（不复用 `ExplanationVersion`——后者固定 summary/whyItMatters/uncertainties 三段且仍在详情页渲染；深读是另一组三段 影响面/受益方/风险点，二者同页共存，不可同表）。epic-5-context 数据模型决策（:55-60）与 5.1 先例（独立 `RecommendationReason` 表）一致；epics.md:673「作为 ExplanationVersion 版本化记录」读作「AD-5/ExplanationVersion 式 append-only 版本化记录」，由独立表满足（NFR-7 字段齐全）。见 Design Notes。
- 端口形态照抄 5.1：`LLMAdapter` 接口加 `generateDeepRead(args:{hotEventId,title,summary,evidence}):Promise<LlmDeepReadResult|null>`；`stub-llm-adapter.ts` 增 `STUB_DEEP_READ`（三段固定串，过黑名单、≤上限）+ `promptVersion="deepread-stub-v1"`；service 首行 `if(adapter===undefined)return null` 不写库；worker `const adapter=undefined` 注入点 + `// ponytail: real provider wired when procured`。
- publish-orchestrator 仍是 `published_hot_event_deep_reads` 的唯一写者（AD-2/AD-3b）。`projectDeepRead` 读最新 `DeepRead`（createdAt desc, id desc tiebreaker）→ upsert；无行 → deleteMany。投影由 `refreshPublishedReadModel({action:"publish"})` 触发；worker append 后对已 published 事件调 `refreshPublishedReadModel` 让新深读立即上详情页（镜像 5.1 调 `refreshPublishedTimelineForEvent`）。
- 深读文本写入前 fail-fast 校验：每段 trim 后非空、码点长度（`[...s].length`）≤ `DEEP_READ_SEGMENT_MAX_LENGTH`、过 `passesRecommendationGuardrail`（PRD §10 六类黑名单，5.1 已导出，PRD-§10 通用非 reason 专属）；modelId/promptVersion 非空。违例抛错 → worker 逐条 try/catch 捕获 → 该事件留 null（缺失态），整批不中止。
- 真实 LLM provider 注入点留好但 V1 不接入，**不新增任何第三方 LLM SDK 依赖**；Stub 仅 verify/e2e 使用，`apps/worker` 运行时不得 import Stub。

**Block If:** 无（真实 provider 接入、retry 循环、worker 自动调度、运营抽检台深读筛选均在范围外/5.4）。

**Never:**
- 不复用 `ExplanationVersion` 表承载深读（schema 冲突 + 同页共存语义）。
- 不绕过 publish-orchestrator 直写 `published_hot_event_deep_reads`（worker 只 append `DeepRead` + 触发既有投影）。
- 不让 `apps/worker` 运行时 import `StubLlmAdapter`（TEST-ONLY）。
- 不引入 retry 循环（违例→落缺失态；下次 worker 自然重试，归 deferred）。
- 不新增 LLM SDK 依赖。
- 不在本 story 改运营复核台（console）——深读抽检归 5.4。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 候选/已发布事件 + Stub | 事件有证据、无 DeepRead；传入 StubLlmAdapter | 写一条 DeepRead（source=ai，三段+modelId/promptVersion/createdAt 齐全）；published 事件投影后 `published_hot_event_deep_reads` 出现三段；详情页「为什么重要」下渲染三段 + AiLabel | 无 |
| V1 prod honest degradation | worker 注册运行（adapter=undefined） | service 返回 null、不写库；投影无行；详情页渲染显式缺失态「AI 深读生成中。」 | 无错误，诚实降级 |
| 事件缺失/零证据 | hotEventId 不存在或无成员证据 | 返回 null，不写库 | 无错误 |
| 黑名单/超长/空段命中 | adapter 返回某段命中六类黑名单、或 >上限、或空 | 抛错，不写 DeepRead 行；worker 逐条捕获，该事件留 null | fail-fast，不中止整批 |
| 重发布/self-heal 幂等投影 | 事件已有 DeepRead，重发布或 refresh 重跑 | 投影从最新 DeepRead 重新派生（幂等，published_hot_event_deep_reads 行 stable） | 无 |
| takedown | `refreshPublishedReadModel({action:"takedown"})` | `published_hot_event_deep_reads` 该 hotEventId 行被 deleteMany（与既有六张 published_* 同批） | 无 |

</intent-contract>

## Code Map

- `packages/core/prisma/schema.prisma` -- 新增 `DeepRead` model（真相表）+ `PublishedHotEventDeepRead` model（投影）+ `HotEvent.deepReads` 反向关系。
- `packages/core/src/modules/explanation/types.ts` -- 加 `LlmDeepReadResult`/`LlmDeepReadArgs`/`DeepReadRecord`/`GenerateDeepReadOptions`/`GenerateDeepReadResult`，`LLMAdapter` 接口加 `generateDeepRead`（5.1 已预留 :184 注释）。
- `packages/core/src/modules/explanation/stub-llm-adapter.ts` -- 加 `STUB_DEEP_READ`（三段）+ 实现 `generateDeepRead`。
- `packages/core/src/modules/explanation/reason-service.ts` -- **黑名单先例**（`RECOMMENDATION_FORBIDDEN_PHRASES`/`passesRecommendationGuardrail`/`validateReason` 码点计数先例），逐字对照。
- `packages/core/src/modules/explanation/deep-read-service.ts` -- 新增 `generateDeepRead`/`getLatestDeepRead`/`DEEP_READ_SEGMENT_MAX_LENGTH`/`validateDeepRead`。
- `packages/core/src/modules/explanation/index.ts` + `packages/core/src/index.ts` -- barrel 导出深读相关符号。
- `packages/core/src/modules/publish-orchestrator/publish-service.ts` -- 加 `projectDeepRead`（:223 之后第 7 个投影调用）；takedown 分支（:121-148）加 `publishedHotEventDeepRead.deleteMany`；`getPublishedHotEventDetail`（:627+）加第 6 个 findUnique。
- `packages/core/src/modules/publish-orchestrator/types.ts` -- `PublishedHotEventDetail`（:131-173）加 `deepRead` 字段。
- `apps/worker/src/queues/recommendation-reason-queue.ts` -- **worker 模板**（adapter 注入 + candidate+published 发现 + 逐条隔离 + published 后 refresh），逐字对照。
- `apps/worker/src/index.ts` -- 第 9 个 worker 装配点（当前 8 个，:49-56）。
- `apps/worker/src/verify-reason.ts` -- **verify 脚本模板**（Stub 驱动 + 投影断言 + append-only + 黑名单 fail-fast + 覆盖率），逐字对照。
- `apps/web/app/(public)/events/[hotEventId]/page.tsx` -- 「为什么重要」区块（:219-234）下新增深读子区块；`AiLabel` 来自 `components/chips.tsx:30`。

## Tasks & Acceptance

**Execution:**
- `packages/core/prisma/schema.prisma` -- 新增 `DeepRead` model（`id` UUIDv7 app 赋 / `hotEventId` / `impactSurface String @map("impact_surface")` / `beneficiaries String` / `riskPoints String @map("risk_points")` / `source String` / `modelId` / `promptVersion` / `traceId?` / `createdAt`，FK `onDelete: Cascade`，`@@index([hotEventId])` `@@index([createdAt])`，`@@map("deep_reads")`）+ `PublishedHotEventDeepRead` model（`hotEventId String @id` / 三段 / `deepReadSource String @map("deep_read_source")` / `generatedAt DateTime @map("generated_at")` / `traceId?` / `updatedAt DateTime @updatedAt`，`@@map("published_hot_event_deep_reads")`），`HotEvent` 加 `deepReads DeepRead[]` 反向关系 -- 真相表 + 投影（NFR-7）。
- `packages/core/prisma/migrations/20260712000001_add_deep_read/migration.sql` -- `pnpm --filter @aguhot/core db:migrate` 生成并提交 -- schema 落地。
- `packages/core/src/modules/explanation/types.ts` -- 新增 `LlmDeepReadResult`（`{impactSurface;beneficiaries;riskPoints;modelId;promptVersion}`）+ `LlmDeepReadArgs`（`{hotEventId;title;summary;evidence:ReadonlyArray<{sourceName:string;summary:string;publishedAt:Date|null}>}`）+ `DeepReadRecord` + `GenerateDeepReadOptions`（`{prisma;traceId;hotEventId;adapter?:LLMAdapter}`）+ `GenerateDeepReadResult`；`LLMAdapter` 接口加 `generateDeepRead(args:LlmDeepReadArgs):Promise<LlmDeepReadResult|null>` -- 端口契约（对照 5.1 reason 类型块）。
- `packages/core/src/modules/explanation/stub-llm-adapter.ts` -- 加 `STUB_DEEP_READ`（三段固定串，每段 ≤120 字、过六类黑名单，如 影响面「事件波及相关产业链上下游企业。」/受益方「上游原材料供应商短期或受关注。」/风险点「下游需求不确定性仍存。」）+ `STUB_DEEP_READ_PROMPT_VERSION="deepread-stub-v1"`；`StubLlmAdapter.generateDeepRead` `void` 掉 args 后返回 `STUB_DEEP_READ` + 固定 `modelId="stub:v1"` + 该 promptVersion -- TEST-ONLY 确定性（对照 `STUB_RECOMMENDATION_REASON`）。
- `packages/core/src/modules/explanation/deep-read-service.ts` -- 新增 `DEEP_READ_SEGMENT_MAX_LENGTH=120`（码点/字；SM-C3「深读有上限」story-time 默认，可调）+ `generateDeepRead({prisma,traceId,hotEventId,adapter?})`：`adapter===undefined`→null 不写库；加载 HotEvent（`revisions` take1 取 effectiveTitle、`explanationVersions` take1 取 effectiveSummary、`evidence`+成员 evidenceRecord 取 grounding）；事件缺失/无证据→null；调 `adapter.generateDeepRead({hotEventId,title:effectiveTitle,summary:effectiveSummary,evidence})`；raw null→null；`validateDeepRead`（trim + 码点长度 + `passesRecommendationGuardrail` 逐段 + modelId/promptVersion 非空）违例抛错；append 一条 `DeepRead`（source=ai）。导出 `getLatestDeepRead`（createdAt desc+id desc tiebreaker）-- 生成链（NFR-2/NFR-3/NFR-7）。
- `packages/core/src/modules/explanation/index.ts` 与 `packages/core/src/index.ts` -- barrel 导出 `generateDeepRead`/`getLatestDeepRead`/`DEEP_READ_SEGMENT_MAX_LENGTH`/`STUB_DEEP_READ`/`LlmDeepReadResult`/`LlmDeepReadArgs`/`DeepReadRecord`/`GenerateDeepReadOptions`/`GenerateDeepReadResult` -- 对外契约。
- `packages/core/src/modules/publish-orchestrator/publish-service.ts` -- 加私有 `projectDeepRead(prisma,traceId,hotEventId)`（镜像 `projectExplanation`：读最新 `deepRead` orderBy createdAt desc+id desc → 有则 upsert `published_hot_event_deep_reads`（三段+`deepReadSource=latest.source`+`generatedAt=latest.createdAt`+traceId），无则 deleteMany）；`refreshPublishedReadModel` publish 分支在 `projectExplanation` 后调 `projectDeepRead`（第 7 投影），takedown 分支加 `prisma.publishedHotEventDeepRead.deleteMany({where:{hotEventId}})`（与既有六张同批）；`getPublishedHotEventDetail` 加 `publishedHotEventDeepRead.findUnique({where:{hotEventId}})` 并把结果映射进返回 `deepRead`（null 或 `{impactSurface;beneficiaries;riskPoints;source;generatedAt}`）-- 投影随发布 gate-atomic 可见，唯一写者不变。
- `packages/core/src/modules/publish-orchestrator/types.ts` -- `PublishedHotEventDetail` 加 `deepRead: { impactSurface: string; beneficiaries: string; riskPoints: string; source: string; generatedAt: Date } | null` -- 读模型契约。
- `apps/worker/src/queues/deep-read-queue.ts` -- 新增 queue+worker 同文件（`DEEP_READ_QUEUE_NAME="deep-read"`，lazy `getDeepReadQueue` + `enqueueDeepRead(traceId)` + `registerDeepReadWorker`，`removeOnComplete:100`/`removeOnFail:500`，worker `await import("@aguhot/core")`，`const adapter = undefined` + ponytail 注释）；handler 查 `publicationStatus in [candidate,published]` 且 `deepReads:{none:{}}`（排除 rejected/taken_down），逐条 try/catch 调 `generateDeepRead`，成功且事件 published 时调 `refreshPublishedReadModel({prisma,traceId,hotEventId,action:"publish"})` 让新深读立即上详情页 -- 第 9 个生成 worker（对照 recommendation-reason-queue）。
- `apps/worker/src/index.ts` -- import + `registerDeepReadWorker()` + 加入 shutdown `close()` 列表 + 顶部注释追加「Story 5.2 added the deep-read worker」-- 装配。
- `apps/worker/src/verify-deepread.ts` -- 新增 Stub 驱动 verify 脚本（对照 `verify-reason.ts`）：seed → cluster → `generateExplanation` → `decideReview(approve)` 发布 → 用 `StubLlmAdapter` 调 `generateDeepRead` 断言行写入且三段+source=ai+modelId/promptVersion/traceId 齐全 + 三段过黑名单/≤上限 → 调 `refreshPublishedReadModel(action:"publish")` 后断言 `published_hot_event_deep_reads` 三段非空 → append-only（二次 generate count→2 + 投影取最新）→ self-heal（`refreshPublishedReadModel` 重跑存活）→ `adapter===undefined` 返回 null 不写库 → 黑名单/超长/空段 fail-fast 抛错不写行 → 缺失事件→null → 覆盖率（再 seed 一个无深读的已发布事件 → 1/2）。`apps/worker/package.json` 加 `verify:deepread` 脚本 -- 证明链路。
- `apps/web/app/(public)/events/[hotEventId]/page.tsx` -- 「为什么重要」`<section>`（:219-234）内、现有 `whyItMatters` `<p>` **之后**新增深读子区块：`detail.deepRead` 非空 → 渲染 `AiLabel` + 「AI 深读」小标题 + 三段标注（影响面/受益方/风险点，用 `<dl>`/`<dt>`/`<dd>` 或等价分区，文案 `text-sm text-ink-secondary`，视觉权重 ≤ 事实摘要）；为空 → 渲染诚实缺失态「AI 深读生成中。」（muted，对齐既有「系统解释生成中。」模式）-- 详情页落地（UX :89-90，NFR-3）。

**Acceptance Criteria:**
- Given `LLMAdapter` 此前只有 `generateReason`，When 5.2 dev 完成，Then 端口增 `generateDeepRead`，`explanation/` 下出现 `deep-read-service.ts` 且 `apps/worker` 不 import Stub。
- Given 候选/已发布 HotEvent 有证据且无 DeepRead，When 用 `StubLlmAdapter` 调 `generateDeepRead` 并触发该事件 `refreshPublishedReadModel(action:"publish")`，Then 写入一条 `DeepRead`（source=ai、三段、modelId/promptVersion/createdAt 齐全），`published_hot_event_deep_reads` 出现三段，详情页「为什么重要」下渲染三段 + `AiLabel`。
- Given V1 prod（worker `adapter=undefined`），When deep-read worker 运行，Then service 返回 null、不写库、投影无行、详情页渲染「AI 深读生成中。」缺失态，prod honest degradation。
- Given adapter 返回命中黑名单或某段 >120 字或空段，When `generateDeepRead` 校验，Then 抛错、不写行；worker 逐条捕获、该事件留 null、整批不中止。
- Given 事件已有 DeepRead，When 重发布或 `refreshPublishedReadModel` 重跑，Then 投影从最新 `DeepRead` 重新派生（幂等，published 行 stable），publish-orchestrator 仍是 `published_hot_event_deep_reads` 唯一写者。
- Given 事件被 takedown，When `refreshPublishedReadModel(action:"takedown")`，Then `published_hot_event_deep_reads` 该 hotEventId 行被删，详情页不再可见深读。

## Spec Change Log

（空。）

## Review Triage Log

### 2026-07-12 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (medium 2, low 1)
- defer: 3: (low 3)
- reject: 14
- addressed_findings:
  - `[medium]` `[patch]` `packages/core/prisma/schema.prisma` — 实现期 `prisma format` 把全文件 ~286 行无关模型列对齐 churn 进了 feature diff（毁 blame、易冲突）。本仓无 `prisma format` 脚本/hook，baseline 用紧对齐风格（5.1 同样未重排）。回退到 baseline，仅以 baseline 风格重加 `DeepRead` + `PublishedHotEventDeepRead` + 两处 HotEvent 反向关系：diff 现为 70 插入 / 0 无关删除。
  - `[medium]` `[patch]` `apps/worker/src/verify-deepread.ts` — 新增 `getPublishedHotEventDetail.deepRead` 读装配断言：原脚本只断言 `published_hot_event_deep_reads` 投影表行，从未穿透详情页实际调用的公开读查询；读装配回归（选错列/映射坏）会让详情页永远渲染缺失态而 verify 全绿。补一断言经 `getPublishedHotEventDetail` 取 `detail.deepRead` 三段 + source=ai（钉死页面消费的那一跳）。
  - `[low]` `[patch]` `apps/worker/src/verify-deepread.ts` — 新增 takedown 真相存活断言（AD-5）：原 takedown 测试只断言投影行被删，不断言 `deep_reads` 真相行存活；若未来有人把 `deepRead.deleteMany` 误加进 takedown 分支会静默通过。补 takedown 前后 `deepRead.count` 不变的断言。
  - Rejected（附理由）：`ponytail:` 注释（spec Always 明示要求、对齐 5.1）；码点长度上限（spec 定义 `[...s].length`、对齐 5.1 review 明确改成的码点计数）；投影 `trace_id` 指向 refresh 而非生成（对齐 `projectExplanation` 及全部 published_* 投影约定，真相行 `deep_reads.traceId/modelId/promptVersion` 满足 NFR-7）；`void args.*`（对齐 5.1 Stub）；深读在 `<section>` 内作子块（spec Code Map 明示「section 内、whyItMatters 之后新增子区块」）；Stub 文案语气（子串黑名单不能管语气、真实 provider 接入时再调，对齐 5.1 保守黑名单 rationale）；黑名单 false-positive（见 defer）；闭包绑定/断言次序（测试内部、当前正确）；索引选择（对齐 5.1、每事件行数极少 in-memory sort 可忽略）；adapter 抛错未捕获（对齐 5.1、V1 永不调 adapter、worker try/catch 兜底、真实 provider 错误处理 deferred）；空 revision title（对齐 5.1 overlay、退化算子输入）；worker 成功分支返回缺 `skipped`（与已 review 的 5.1 `recommendation-reason-queue` 逐字同形、返回值无人消费、5.1 review 故意去掉 COUNT，单改 deep-read 反而制造兄弟间不一致）；worker 包装层与 index.ts 装配未被 verify 测（本仓约定直接测 generator、5.1 同形、V1 短路）；tag overlay docstring（行为对齐 5.1、cosmetic）。
  - Deferred（见 deferred-work.md）：6 类子串黑名单对合法金融词汇（持仓/增持/主力/一定 等）的 false-positive——深读风险段更易触发，真实 provider 接入时需调（V1 Stub 不触发）；worker append→refresh 一致性洞 + candidate-query TOCTOU——已 published 事件若 worker 的 `refreshPublishedReadModel` 失败则深读投影缺失且 `deepReads:{none:{}}` 不再重扫（retry 为 spec Never，无 detail 读模型 self-heal，与 5.1 deferred 同类）；adapter grounding 的 evidence 无 orderBy（NFR-2 一致性，真实 provider 关注，V1 Stub 忽略上下文）。

## Design Notes

- **为什么独立 DeepRead 表（不复用 ExplanationVersion）：** epics.md:673 与 epic-5-context :55-60 字面冲突。独立表是唯一自洽读法：(a) 深读三段（影响面/受益方/风险点）≠ ExplanationVersion 三段（summary/whyItMatters/uncertainties），二者在详情页同页共存（前者落在「为什么重要」**下**，后者仍是「发生了什么/为什么重要/当前仍不确定」三块），同表会要么覆盖列语义、要么把两个关注点塞进一张 append-only 表；(b) epic-5-context 数据模型决策明确「各自独立 append-only 表」，5.1 已为 `RecommendationReason` 落地同形态；(c) epics.md「作为 ExplanationVersion 版本化记录」由独立表（NFR-7 字段齐全 + AD-5 append-only）同样满足，读作「ExplanationVersion 式版本化记录」。reviewer 若持不同读法请升 intent_gap。
- **投影走 published_hot_event_deep_reads 而非扩列 published_hot_event_explanations：** 2.1/2.2/2.3 先例（market-reaction/association/theme 各自一真相表 + 一 published_* 投影 + getPublishedHotEventDetail 各一 findUnique）是详情页多关注点的既定架构，深读同形跟随，避免把两个独立 append-only 流耦合进同一投影行（projectExplanation 在无 ExplanationVersion 时 deleteMany 会误删深读列）。
- **独立 deep-read-queue（第 9 worker）而非挂 explain-queue：** epic-5-context :65 字面说「深读挂 explain-queue」，但 :108「三者共用 worker resolve 模式」指 5.1/5.3 的 adapter-resolve 队列形态，且 explain-queue 是确定性/仅 candidate/无 adapter/无投影刷新，与深读（LLM/adapter/candidate+published/需刷新）形状不同——与 5.1 recommendation-reason-queue 几乎逐字同形。选独立队列以保持 explain worker 的确定性纯净；这是对 epic 字面意图的偏离，记此以便 reviewer 判断（与 5.1 已为同形 LLM job 开独立队列一致）。
- **6 类黑名单复用：** `passesRecommendationGuardrail`/`RECOMMENDATION_FORBIDDEN_PHRASES` 名含 "recommendation" 但承载 PRD §10 通用六类（epic AC 适用于全部 AI 内容）。复用、不改名（避免 churn 5.1）；5.3 落地时若需可提升到 shared 并改名。
- **每段上限 120 字：** PRD SM-C3 仅述「深读有上限」未给数；120 字/段（码点）为 story-time 默认（可一行编辑调整），fail-fast 违例→null，对齐 5.1 的 40 字 reason 上限先例。
- **缺失态：** 详情页深读缺失渲染显式「AI 深读生成中。」（muted），对齐 5.1 Design Note「详情页深读用显式缺失态」与既有「系统解释生成中。」模式；V1 prod 每个详情页均显示此态（honest degradation，对齐 5.1 卡面 slot 缺席）。
- **延后（归 deferred-work.md 既有 pipeline 编排项）：** 真实 LLM provider 接入、retry 循环、worker 自动调度、运营复核台深读筛选/重生（5.4）。

## Verification

**Commands:**
- `pnpm --filter @aguhot/core db:migrate -- --name add_deep_read` -- 迁移生成并应用成功（`deep_reads` + `published_hot_event_deep_reads` + FK/索引创建）。
- `pnpm typecheck` -- 全仓类型检查通过（含端口扩展、新 service、投影、详情页类型）。
- `pnpm lint` -- 通过。
- `pnpm --filter @aguhot/worker verify:deepread`（或 `tsx apps/worker/src/verify-deepread.ts`） -- Stub 链路：行写入、投影三段非空、AD-5 append-only、self-heal 投影、adapter-undefined 不写库、六类黑名单/超长/空段 fail-fast、缺失事件→null、覆盖率 1/2 全绿。

**Manual checks (if no CLI):**
- 确认 `apps/worker` 源码 grep 不到 `StubLlmAdapter` import（TEST-ONLY 隔离）。
- 确认 `package.json` 无新增 LLM SDK 依赖。
- 确认详情页「为什么重要」下深读三段视觉权重 ≤ 事实摘要，`AiLabel` 紧邻。

## Auto Run Result

Status: done

**实现摘要：** 落地 Story 5.2「事件级 AI 深读」——在 5.1 的 `LLMAdapter` 端口上加第二个方法 `generateDeepRead`（5.1 注释已预告复用）；新增 `DeepRead` append-only 真相表 + `published_hot_event_deep_reads` 投影表（per-HotEvent，三段 影响面/受益方/风险点，source/modelId/promptVersion/createdAt，NFR-7 溯源，AD-5）；`deep-read-service`（`adapter===undefined`→null 不写库、title/summary/evidence grounding、6 类黑名单 + 每段 120 字码点 fail-fast）；`projectDeepRead` 作为 `refreshPublishedReadModel` 第 7 投影 + takedown 同批删除 + `getPublishedHotEventDetail` 第 6 findUnique；第 9 个 worker `deep-read-queue`（镜像 5.1 recommendation-reason-queue，V1 honest degradation）；详情页「为什么重要」下渲染三段 + `AiLabel`，缺失态「AI 深读生成中。」。V1 用 Stub 跑通，真实 provider 注入点留好但不接入，不新增 LLM SDK 依赖。

**改动文件：**
- `packages/core/prisma/schema.prisma`（+ `DeepRead` + `PublishedHotEventDeepRead` + HotEvent 反向关系；实现期 `prisma format` 全文 churn 已在 review 期回退，仅保留 baseline 风格的 70 行新增）
- `packages/core/prisma/migrations/20260712000001_add_deep_read/migration.sql`（两表 + FK Cascade + 索引）
- `packages/core/src/modules/explanation/types.ts`（`LLMAdapter.generateDeepRead` + 深读类型）
- `packages/core/src/modules/explanation/stub-llm-adapter.ts`（`STUB_DEEP_READ` 三段 + `generateDeepRead`）
- `packages/core/src/modules/explanation/deep-read-service.ts`（生成链 + 校验，新文件）
- `packages/core/src/modules/explanation/index.ts` / `packages/core/src/index.ts`（barrel 导出）
- `packages/core/src/modules/publish-orchestrator/publish-service.ts`（`projectDeepRead` 第 7 投影 + takedown 删除 + 详情读装配）
- `packages/core/src/modules/publish-orchestrator/types.ts` / `index.ts`（`PublishedHotEventDetail.deepRead` 契约）
- `apps/worker/src/queues/deep-read-queue.ts`（第 9 个 worker，新文件）
- `apps/worker/src/index.ts`（装配第 9 个 worker）
- `apps/worker/src/verify-deepread.ts`（Stub 驱动 verify，26 断言，新文件）
- `apps/worker/src/verify-reason.ts`（端口加法 fallout：5 处内联 LLMAdapter 字面量补 `generateDeepRead` stub）
- `apps/worker/package.json`（`verify:deepread` 脚本）
- `apps/web/app/(public)/events/[hotEventId]/page.tsx`（「为什么重要」下深读子区块）

**Review 结果：** 4 层并行 review（blind-hunter / edge-case-hunter / verification-gap / intent-alignment）。无 intent_gap、无 bad_spec。应用 3 个 patch（schema 回退 `prisma format` churn 仅留 DeepRead 新增；verify-deepread 补 `getPublishedHotEventDetail.deepRead` 读装配断言钉死页面消费的那一跳；补 takedown 真相存活 AD-5 断言）。defer 3 项（黑名单 false-positive、worker 一致性洞/TOCTOU、evidence orderBy，均真实 provider 接入时显现）。reject 14 项（ponytail 注释/码点上限/投影 traceId/void args/section 内子块等 by-design 与既有 codebase 约定，逐项附理由）。

**Follow-up review 建议：** false —— 最终 pass 的改动局部（schema 仅 diff-hygiene 回退、+2 测试断言），无 API/数据模型/架构/行为变更；3 个 patch 全部类型/lint/verify 覆盖。

**Verification 执行：**
- `pnpm typecheck`（全 5 包）→ 绿
- `pnpm lint`（全 5 包）→ 绿
- `prisma validate` → schema valid；`prisma migrate status` → up to date（13 migrations），`deep_reads` + `published_hot_event_deep_reads` 表 + FK 已建
- `pnpm --filter @aguhot/worker verify:deepread` → **PASS 26/26**（行写入、投影三段非空、公开读查询 `getPublishedHotEventDetail.deepRead` 装配、AD-5 append-only、self-heal 投影、takedown 清投影 + 真相存活、adapter-undefined 不写库、6 类黑名单/超长/空段 fail-fast、exactly-120 接受/121 拒绝、缺失事件→null、覆盖率 1/2）
- `pnpm --filter @aguhot/worker verify:reason` → **PASS 22/22**（端口扩展无回归）
- `pnpm --filter @aguhot/worker verify:timeline` → **PASS 31/31**（投影改动无 4.1 回归）
- grep 确认 `apps/worker` 不 import `StubLlmAdapter`；`package.json` 无 LLM SDK 依赖

**Residual risks / artifacts：**
- dev 库既有迁移 `20260710141148_association_read_models` checksum 漂移（早于本 story，5.1 已登记 deferred；本 story 迁移 checksum 已正确记录）。
- `verify:deepread` / `verify:reason` 需本地 PG `aguhot_dev`；`verify:timeline` 另需 `REDIS_URL`。
- V1 prod 因 worker 解析 `adapter = undefined`，AI 深读覆盖率为 0%（每个详情页显示「AI 深读生成中。」honest degradation，待真实 provider 接入；epic AC 明示，对齐 5.1）。
- `_bmad-output/implementation-artifacts/.review-diff-5-2.patch` 为本次 review 快照（已随 story 提交，对齐 5.1 惯例）。
