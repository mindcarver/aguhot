---
title: 'AI 生成内容运营抽检（suppress_ai_content 外科式下线 + 抽检台 + SM-6 误导率读数）'
type: 'feature'
created: '2026-07-12'
status: 'done'
baseline_revision: 'd704b446706f1599bde4676c5411d4da7d682fbd'
final_revision: 'db623d38cd9f68b4eea9af232127f573f7e7ec2a'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-5-3-digest-trend-briefing.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Epic 5 已让 reason（列表卡 AI 解读）/deepread（详情页 AI 深读）随事件发布上线（5.1/5.2 done），但运营无手段对单条 AI 内容做抽检与下线——`decideReview` 的四个 outcome（approve/reject/takedown/republish）粒度是整个 HotEvent，takedown 会核平整个事件（连事实带证据一起下线），无法"只下线某条误导性 AI 内容、保留事件本身"。SM-6（运营复核后被判明显误导的公开 AI 内容占比 < 10%）也无可观测读数。codebase 现状：`ReviewDecision`（schema.prisma:230）无 target_type/target_id 列（决策仅 per-HotEvent）；reason/deepread 源表无 suppress 标记；`refreshPublishedTimelineForEvent`/`refreshPublishedReadModel` 从源重投影（refresh-on-publish 会把已下线内容重新投回去）；运营台 `/console` + `/console/[eventId]` 无 AI 内容筛选/标记/误导率读数。研判（TrendBriefing）V1 排除（不可标记/下线，仅 browse）。

**Approach:** 照抄 review-workflow「`decideReview` 在单个 `$transaction` 内 append `ReviewDecision` + 调 publish-orchestrator refresh」的跨模块协调先例，但加一个**sibling** 函数 `suppressAiContent`（**不**经 `decideReview`/`resolveTransition`/`LEGAL_TRANSITIONS`——那三者是 HotEvent 状态机，本 story 不触）：(1) schema 给 `ReviewDecision` 加 `targetType?`/`targetId?` 两列、给 `RecommendationReason`+`DeepRead` 各加 `suppressedAt?`；(2) explanation 模块加 `suppressRecommendationReason`/`suppressDeepRead`（源表 sole writer，置 `suppressedAt`）；(3) review-workflow 加 `suppressAiContent({targetType,targetId,hotEventId,reviewer,note?})`——单 tx 内：核 target 存在且未抑制→置源 `suppressedAt`→append `ReviewDecision(outcome="suppress_ai_content",targetType,targetId,note)`→**仅当事件 `publication_status==="published"`** 时调 `refreshPublishedTimelineForEvent`（reason）/`refreshPublishedReadModel`（deepread）让线上立即反映；两处投影查询加 `where:{suppressedAt:null}` 使抑制跨未来 republish 持久（投不出被抑制的源→published reason=null / deepread 行删除）；(4) review-workflow 加 `getSm6MisleadingRate`（滚动 7 日窗：分子=`ReviewDecision` where outcome=suppress_ai_content 且 targetType∈{reason,deepread} 且 createdAt≥7d前；分母=同期生成的 reason+deepread 行数合计，不含研判；返回 `{rate, numerator, denominator, windowDays}`）；(5) 运营台新页面 `/console/ai-content`：跨事件列出 reason+deepread（`listAiContentForSampling`，explanation 模块新建），`FilterPill` 按 reason/deepread 筛选（研判不出现），每行「标记为误导并下线」server action 调 `suppressAiContent`，顶部 SM-6 读数（inline 文本，照抄 `/console` 既有「· N 条」模式），已下线行显示「已下线」标记（UX-DR14）。V1 不做「重生成」（Gap 3 裁决延后）。

## Boundaries & Constraints

**Always:**
- `suppressAiContent` 是 review-workflow 的 **sibling** 函数，**不**经 `decideReview`、**不**调 `resolveTransition`、**不**改 `LEGAL_TRANSITIONS`、**不**加 `PublicationStatus` 值、**不**写 `HotEvent.publicationStatus`、**不**加 suppress_ai_content 到 `ReviewOutcome` const（那会喂给状态机 selfcheck）。outcome 字符串 `"suppress_ai_content"` 直接写入 `ReviewDecision.outcome`（该列是 free `String`）。本 story 对 HotEvent 状态机零改动——照抄 epic 裁决「不改 decideReview 的 HotEvent 状态机」字面。
- 抑制是**持久信号**：源表 `suppressedAt` + 两处投影查询 `where:{suppressedAt:null}`。源行内容**不删**（NFR-7 溯源/审计），只置 metadata 时间戳。投影「取最新 `suppressedAt:null` 行」——最新行被抑制则回退到上一未抑制版本，全被抑制则 published reason=null / deepread 行删除。这是让 epic 字面「refresh 置 null/删行」机制跨 republish 存活的最少改动（不引入跨模块反向依赖、不查 ReviewDecision 进投影热路径）。见 Design Notes。
- `suppressAiContent` 在单个 `prisma.$transaction(async tx => ...)` 内完成全部三步（置源 suppressedAt + append ReviewDecision + 条件 refresh），把 `tx as unknown as PrismaClient` 传给 explanation suppress fn 与 refresh fn（镜像 `decideReview` 既定形态）。refresh **仅当** `HotEvent.publicationStatus==="published"` 触发——对 candidate/非 published 事件不 refresh（`refreshPublishedTimelineForEvent({action:"publish"})` 会 upsert published 行，对未发布事件是错误的发布；抑制靠源标记持久，待事件后续经 `decideReview` 发布时投影自然跳过）。
- 审计走既有 append-only `ReviewDecision`（**不新建表**）：传统 4 outcome 决策 `targetType/targetId` 为 null；suppress_ai_content 决策 `targetType∈{"reason","deepread"}`、`targetId`=被抑制的 `RecommendationReason.id`/`DeepRead.id`、`note`=运营误导理由（free text）。`reviewer` 复用既有 `"operator"` 共享身份（与 `submitReview` 一致，见 lib/operator-auth.ts:61）。
- SM-6 口径严格照 epic Gap 4：7 日滚动窗，**分子**=`ReviewDecision.count({where:{outcome:"suppress_ai_content", targetType:{in:["reason","deepread"]}, createdAt:{gte:now-7d}}})`；**分母**=同期 `recommendationReason.count({createdAt:{gte:now-7d}})` + `deepRead.count({createdAt:{gte:now-7d}})`（聚合、不含研判）；`rate = denominator===0 ? 0 : numerator/denominator`。SM-6 < 10% 达标。在 review-workflow 落地（它拥有 `ReviewDecision` 分子表）。
- `listAiContentForSampling` 在 explanation 模块落地（它拥有 reason+deepread 两表），返回统一列表项 `{type:"reason"|"deepread", id, hotEventId, eventTitle, content, source, createdAt, suppressedAt|null}`（content = reason 文本 / deepread 三段拼接预览）；**不**按 suppressedAt 过滤（运营要看到已下线项 + 标记）。可按 `type?` 过滤、按 createdAt desc。无分页（对齐既有 console 列表 `listPendingCandidates`/`listPublishedHotEvents` 无分页先例；V1 量级可承载，归 deferred 升级）。

**Block If:** 无（真实 LLM provider 接入、重生成 action、研判抽检 schema、运营台分页/排序/批量操作均在范围外/deferred）。

**Never:**
- 不经 `decideReview`/`resolveTransition`/`LEGAL_TRANSITIONS`/`PublicationStatus`/`ReviewOutcome` const 表达 suppress（状态机零改动）。
- 不核平整个事件、不改 `HotEvent.publicationStatus`、不删源 reason/deepread 行（只置 `suppressedAt`）。
- 不新建 suppress 审计表（复用 `ReviewDecision` + 两 nullable 列）。
- 不让投影查 `ReviewDecision`（避免 publish-orchestrator 反向依赖 review-workflow、避免热路径 N+1）——持久信号走源表 `suppressedAt`。
- 不对 TrendBriefing 开标记/下线（V1 排除，Gap 2 裁决）；SM-6 分子/分母均不含研判；抽检台不列出研判。
- 不做「重生成」action（Gap 3 裁决延后，V1 仅 suppress/takedown）。
- 不让 `apps/worker` 运行时 import `StubLlmAdapter`（TEST-ONLY，对齐 5.1/5.2/5.3）；不新增第三方 LLM SDK 依赖。
- 不在 `[eventId]/page.tsx` 既有 4-action 表单里塞第 5 按钮（suppress 主面是抽检台 `/console/ai-content`，避免污染事件决策页状态机语义）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 抑制 published 事件的 reason | 事件 published、有 latest reason（未抑制） | tx 内：源行 `suppressedAt=now`；append ReviewDecision(suppress_ai_content, target_type=reason, target_id=reason.id)；refresh timeline → `published_timeline_entries.recommendation_reason=null`；返回 `{suppressed:true}` | 无 |
| 抑制 published 事件的 deepread | 事件 published、有 latest deepread（未抑制） | tx 内：源行 `suppressedAt=now`；append ReviewDecision(...,target_type=deepread)；refresh read model → `published_hot_event_deep_reads` 行删除；返回 `{suppressed:true}` | 无 |
| 抑制 candidate 事件的 AI 内容（未发布） | 事件 publication_status=candidate、有 reason | 置源 suppressedAt + append ReviewDecision；**不** refresh（无 published 行可改）；后续 decideReview(approve) 发布时投影跳过被抑制源→published reason=null | 无错误，持久抑制 |
| 已抑制目标再次标记 | target 已 `suppressedAt!=null` | 不重复 append ReviewDecision、不重复 refresh；返回 `{suppressed:false, reason:"already-suppressed"}`（幂等，防分子双计） | 幂等拒绝 |
| target 不存在 | targetId 在对应表查不到 | 抛 `TargetNotFoundError`→tx 回滚、不写任何行 | fail-fast |
| targetType=trend_briefing | action 入参 type=trend_briefing | server action 白名单拒绝（不进 `suppressAiContent`）；抽检台列表不含研判 | 前置拒绝 |
| 抑制存活过 republish | reason 已抑制、事件经 revise/republish 再次触发 `refreshPublishedTimelineForEvent({action:"publish"})` | 投影 `where:{suppressedAt:null}` 跳过被抑制源→published reason 保持 null（不复活） | 无 |
| SM-6 读数（有数据） | 过去 7d 有 2 条 suppress 决策、同期生成 30 条 reason+deepread | 返回 `{rate:0.0667,numerator:2,denominator:30,windowDays:7}` | 无 |
| SM-6 读数（无数据） | 过去 7d 分母=0 | 返回 `{rate:0,numerator:0,denominator:0,windowDays:7}`（UI 显示「暂无数据」） | 无 |

</intent-contract>

## Code Map

- `packages/core/prisma/schema.prisma` -- `ReviewDecision`(:230) 加 `targetType String? @map("target_type")` + `targetId String? @map("target_id")`；`RecommendationReason`(:838) + `DeepRead`(:874) 各加 `suppressedAt DateTime? @map("suppressed_at")`。**不改** `PublicationStatus`/`ReviewOutcome`/`HotEvent`/状态机。
- `packages/core/prisma/migrations/<ts>_add_ai_content_suppression/migration.sql` -- `db:migrate -- --name add_ai_content_suppression` 生成。
- `packages/core/src/modules/explanation/reason-service.ts` -- 加 `suppressRecommendationReason({prisma,traceId,id})`（`update` where id set suppressedAt=now，`findUniqueOrThrow` 先验存在；接 tx 句柄）。
- `packages/core/src/modules/explanation/deep-read-service.ts` -- 加 `suppressDeepRead({prisma,traceId,id})`（同形）。
- `packages/core/src/modules/explanation/reason-service.ts` 或新 `ai-content-sampling-service.ts` -- 加 `listAiContentForSampling({prisma,traceId,type?})`（并 reason+deepread，映射统一项，含 eventTitle join）。
- `packages/core/src/modules/explanation/types.ts` + `index.ts` + `packages/core/src/index.ts` -- `AiContentType` const（Reason/DeepRead）、`SuppressRecommendationReasonOptions`/`SuppressDeepReadOptions`/`ListAiContentForSamplingOptions`/`AiContentSamplingItem`/`Sm6MisleadingRate` 等类型 + barrel 导出。
- `packages/core/src/modules/publish-orchestrator/timeline-read-model.ts` -- reason 关系 include（~:241）加 `where:{suppressedAt:null}`（投影跳过被抑制源）。
- `packages/core/src/modules/publish-orchestrator/publish-service.ts` -- `projectDeepRead`（~:596）`findFirst` where 加 `suppressedAt:null`。
- `packages/core/src/modules/review-workflow/review-service.ts` -- 加 `suppressAiContent`（sibling，单 tx 协调 explanation suppress + ReviewDecision append + 条件 refresh）+ `getSm6MisleadingRate`（7 日窗聚合）。**不改** `decideReview`。
- `packages/core/src/modules/review-workflow/types.ts` + `index.ts` + `packages/core/src/index.ts` -- `SUPPRESS_AI_CONTENT_OUTCOME` const、`SuppressAiContentOptions`/`SuppressAiContentResult`/`GetSm6MisleadingRateOptions` + barrel。
- `apps/web/app/(operator)/console/ai-content/page.tsx` -- 抽检台页（server component）：`listAiContentForSampling`（按 `searchParams.type` 过滤）+ SM-6 读数 + `FilterPill`(reason/deepread/全部) + 每行抑制 form。
- `apps/web/app/(operator)/console/ai-content/actions.ts` -- `submitSuppressAiContent(formData)` server action（白名单 targetType∈{reason,deepread}、`isOperatorAuthenticated` 守卫、调 `suppressAiContent`、revalidate+redirect）。
- `apps/web/app/(operator)/console/page.tsx` -- 加指向 `/console/ai-content` 的入口链接。
- `apps/worker/src/verify-suppress-ai-content.ts` -- Stub 驱动 verify（镜像 verify-deepread.ts/verify-trendbriefing.ts）。
- `apps/worker/package.json` -- `verify:suppress-ai-content` 脚本。

## Tasks & Acceptance

**Execution:**
- `packages/core/prisma/schema.prisma` -- `ReviewDecision` model 加 `targetType String? @map("target_type")` + `targetId String? @map("target_id")`（nullable，传统 4 outcome 决策留 null）；`RecommendationReason` + `DeepRead` 各加 `suppressedAt DateTime? @map("suppressed_at")`（nullable metadata，内容列不动）-- 审计靶列 + 持久抑制信号（NFR-7 溯源不破坏，照 epic Gap 1/4）。
- `packages/core/prisma/migrations/<ts>_add_ai_content_suppression/migration.sql` -- `pnpm --filter @aguhot/core db:migrate -- --name add_ai_content_suppression` 生成并提交 -- schema 落地。
- `packages/core/src/modules/explanation/types.ts` -- 加 `AiContentType` const（`{Reason:"reason",DeepRead:"deepread"} as const` + 导出 type）、`AiContentSamplingItem`（`{type;id;hotEventId;eventTitle;content;source;createdAt;suppressedAt:Date|null}`）、`ListAiContentForSamplingOptions`（`{prisma;traceId;type?:"reason"|"deepread"}`）、`SuppressRecommendationReasonOptions`/`SuppressDeepReadOptions`（`{prisma;traceId;id}`）-- 契约。
- `packages/core/src/modules/explanation/reason-service.ts` -- 加 `suppressRecommendationReason({prisma,traceId,id})`：`prisma.recommendationReason.findUniqueOrThrow({where:{id},select:{suppressedAt:true}})`→已 `!=null` 返回 `{suppressed:false,reason:"already-suppressed"}`；否则 `update({where:{id},data:{suppressedAt:new Date()}})` 返回 `{suppressed:true}`。接 tx 句柄（与 `getLatestRecommendationReason` 同 prisma 形态）-- 源表 sole writer（AD-2）。
- `packages/core/src/modules/explanation/deep-read-service.ts` -- 加 `suppressDeepRead({prisma,traceId,id})`（同形，操作 `prisma.deepRead`）-- 源表 sole writer。
- `packages/core/src/modules/explanation/ai-content-sampling-service.ts` -- 新文件 `listAiContentForSampling({prisma,traceId,type?})`：并行/串行 `recommendationReason.findMany`（type 未指定或=reason，where type 过滤、orderBy createdAt desc、take 上限如 200 防爆量、select 含 hotEvent.title via include）+ `deepRead.findMany`（同形）；映射为 `AiContentSamplingItem[]`（content：reason→reason 文本；deepread→三段拼接预览）；按 createdAt desc 合并排序；**不**按 suppressedAt 过滤。`take` 上限带 ponytail 注释（V1 量级够，分页归 deferred）-- 抽检台数据源。
- `packages/core/src/modules/explanation/index.ts` + `packages/core/src/index.ts` -- barrel 导出 `AiContentType`、`listAiContentForSampling`、`suppressRecommendationReason`、`suppressDeepRead` 及对应类型 -- 对外契约。
- `packages/core/src/modules/publish-orchestrator/timeline-read-model.ts` -- reason 关系 include（~:241 `recommendationReasons:{orderBy,take,select}`）加 `where:{suppressedAt:null}` -- 投影跳过被抑制源（持久抑制，跨 republish 存活；与 5.1 latest-wins 投影语义一致，仅排除被抑制行）。
- `packages/core/src/modules/publish-orchestrator/publish-service.ts` -- `projectDeepRead`（~:596 `findFirst({where:{hotEventId},...})`）where 改为 `{hotEventId, suppressedAt:null}` -- 同上（最新未抑制 deepread 胜出，全抑制→null→删 published 行）。
- `packages/core/src/modules/review-workflow/types.ts` -- 加 `SUPPRESS_AI_CONTENT_OUTCOME="suppress_ai_content" as const`（**独立 const，不进 `ReviewOutcome`**——状态机 selfcheck 零影响）、`SuppressAiContentOptions`（`{prisma;traceId;targetType:"reason"|"deepread";targetId;hotEventId;reviewer;note?}`）、`SuppressAiContentResult`（`{suppressed:boolean;reason?:"already-suppressed"}`）、`GetSm6MisleadingRateOptions`（`{prisma;traceId;windowDays?:number}` 默认 7）、`Sm6MisleadingRate`（`{rate:number;numerator:number;denominator:number;windowDays:number}`）、`TargetNotFoundError` -- 契约。
- `packages/core/src/modules/review-workflow/review-service.ts` -- 加 `suppressAiContent(options)`：`prisma.$transaction(async tx=>{ const client=tx as unknown as PrismaClient; const tgt = targetType==="reason" ? await suppressRecommendationReason({prisma:client,traceId,id:targetId}) : await suppressDeepRead({...}); if(!tgt.suppressed) return {suppressed:false,reason:"already-suppressed"}; await client.reviewDecision.create({data:{id:newTraceId(),hotEventId,outcome:SUPPRESS_AI_CONTENT_OUTCOME,reviewer,note,targetType,targetId,traceId}}); const ev=await client.hotEvent.findUniqueOrThrow({where:{id:hotEventId},select:{publicationStatus:true}}); if(ev.publicationStatus==="published"){ if(targetType==="reason") await refreshPublishedTimelineForEvent({prisma:client,traceId,hotEventId,action:"publish"}); else await refreshPublishedReadModel({prisma:client,traceId,hotEventId,action:"publish"}); } return {suppressed:true}; })`。注：explanation suppress fn 内 `findUniqueOrThrow` 在 target 不存在时抛→tx 回滚（封装为 `TargetNotFoundError` 或让 Prisma P2025 透传，verify 覆盖）。**绝不**调 `decideReview`/`resolveTransition` -- sibling（照 epic「不改 decideReview 状态机」）。
- `packages/core/src/modules/review-workflow/review-service.ts` -- 加 `getSm6MisleadingRate({prisma,traceId,windowDays=7})`：`since=new Date(Date.now()-windowDays*86400000)`；`numerator=prisma.reviewDecision.count({where:{outcome:SUPPRESS_AI_CONTENT_OUTCOME,targetType:{in:["reason","deepread"]},createdAt:{gte:since}}})`；`denominator=(await prisma.recommendationReason.count({where:{createdAt:{gte:since}}}))+ (await prisma.deepRead.count({where:{createdAt:{gte:since}}}))`；`rate=denominator===0?0:numerator/denominator`；返回 `{rate,numerator,denominator,windowDays}` -- SM-6 读数（epic Gap 4 口径）。
- `packages/core/src/modules/review-workflow/index.ts` + `packages/core/src/index.ts` -- barrel 导出 `suppressAiContent`、`getSm6MisleadingRate`、`SUPPRESS_AI_CONTENT_OUTCOME`、`TargetNotFoundError` 及类型 -- 对外契约（跨模块：review-workflow→explanation suppress fn + publish-orchestrator refresh，镜像 decideReview 既定跨模块形态）。
- `apps/web/app/(operator)/console/ai-content/page.tsx` -- 新 server component：`searchParams.type`（`"reason"|"deepread"|undefined`）→`listAiContentForSampling({prisma,traceId,type})`；顶部 SM-6 读数块 `getSm6MisleadingRate({prisma,traceId})`（inline 文本「AI 内容误导率（近 7 日）：{rate*100}% · {numerator}/{denominator}」，照 `/console` 既有「· N 条」模式，den=0 显「暂无数据」）；`FilterPill` 三态（全部/reason/deepread，href=`/console/ai-content?type=...`，对齐 chips.tsx:87 FilterPill）；列表每项：`AiLabel`（chips.tsx:30，AI 内容标识）+ 类型标 + 事件标题（链 `/console/{hotEventId}`）+ content 预览 + createdAt + 已下线标记（`suppressedAt!==null`→「已下线」muted，UX-DR14）+ 未下线项内嵌 `<form action={submitSuppressAiContent}>`（hidden: targetType/targetId/hotEventId + note textarea +「标记为误导并下线」submit，`confirm` 由 JS-free 直接提交，对齐既有 ReviewForm form-action 模式）。`export const dynamic="force-dynamic"`（对齐 operator layout）-- 抽检台落地（epic AC「进入复核台→按类型筛选→标记→误导率读数」）。
- `apps/web/app/(operator)/console/ai-content/actions.ts` -- `"use server"` `submitSuppressAiContent(formData)`：`if(!(await isOperatorAuthenticated())) redirect("/console/login")`（对齐 `[eventId]/actions.ts:50` 守卫）；解析 targetType（白名单 `["reason","deepread"].includes`，否则 throw）、targetId、hotEventId、note；`await suppressAiContent({prisma,traceId:newTraceId(),targetType,targetId,hotEventId,reviewer:"operator",note})`；`revalidatePath("/console/ai-content")` + `redirect("/console/ai-content")` -- 抑制 action（研判 type 白名单天然排除）。
- `apps/web/app/(operator)/console/page.tsx` -- 在既有两段列表（candidates/published）旁/上加一个入口区块：链接 `/console/ai-content`「AI 内容抽检（reason / 深读）」-- 抽检台可达性（对齐 epic「进入复核台」）。
- `apps/worker/src/verify-suppress-ai-content.ts` -- 新 Stub 驱动 verify（对照 verify-deepread.ts 骨架）：seed evidenceSource+evidenceRecord→clusterEvents→generateExplanation+Stub reason→generateDeepRead(Stub)→decideReview(approve) 发布→断言 published reason/deepread 上线→`suppressAiContent(reason)` 断言：源 suppressedAt set、ReviewDecision 行(outcome=suppress_ai_content,targetType=reason,targetId)、`published_timeline_entries.recommendation_reason=null`、事件 publicationStatus 仍==="published"（未核平）→`suppressAiContent(deepread)` 断言：源 suppressedAt set、`published_hot_event_deep_reads` 行删除、事件仍 published→已抑制重标返回 `{suppressed:false,reason:"already-suppressed"}` 不新增 ReviewDecision 行→candidate 事件抑制（先不 approve：seed 第二 candidate 事件 + reason，suppress，断言无 refresh 报错、源 suppressedAt set、ReviewDecision 行写入；再 decideReview(approve) 发布→published reason=null 持久存活）→republish 存活（对已抑制 reason 事件触发 reviseHotEvent 或直接再 refresh→published reason 保持 null 不复活）→SM-6 读数（seed 已知分子/分母→断言 ratio）→targetType=trend_briefing 由 action 层拒绝（或 core 层不处理，verify 跳过/断言列表不含）→target 不存在 throw。`resetState` 清 reviewDecisions（含新 target 列）+ recommendationReasons+deepReads 的 suppressedAt（或 truncate）。-- 证明链路。
- `apps/worker/package.json` -- 加 `"verify:suppress-ai-content":"tsx src/verify-suppress-ai-content.ts"` -- verify 入口。

**Acceptance Criteria:**
- Given reason/deepread 随事件发布已上线，When 运营进入 `/console/ai-content`，Then 页面列出 reason+deepread（研判不出现），`FilterPill` 可按 reason/deepread/全部筛选，顶部显示 SM-6 误导率读数（7 日窗、reason+deepread 聚合）。
- Given 一条已上线 published reason/deepread，When 运营点「标记为误导并下线」，Then 该条源行 `suppressedAt` 置位、append 一条 `ReviewDecision(outcome=suppress_ai_content,targetType,targetId,note)`、published reason=null（timeline）/ deepread 行删除（read model）、**事件 `publication_status` 仍为 `published`**（未核平整个事件、未改状态机）。
- Given 某条 reason 已被抑制，When 该事件经 revise/republish 再次触发 `refreshPublishedTimelineForEvent({action:"publish"})`，Then 投影 `where:{suppressedAt:null}` 跳过被抑制源，published reason 保持 null（不复活）。
- Given 某条 AI 内容已抑制，When 运营再次提交抑制，Then 返回幂等 `{suppressed:false,reason:"already-suppressed"}`、不新增 ReviewDecision 行（防 SM-6 分子双计）。
- Given 事件 publication_status=candidate（未发布），When 运营抑制其 reason，Then 置源 suppressedAt + append ReviewDecision、**不** refresh（无 published 行被错误创建）；后续该事件 decideReview(approve) 发布时 published reason=null（抑制持久）。
- Given 过去 7 日有 N 条 suppress 决策、同期生成 D 条 reason+deepread，When 调 `getSm6MisleadingRate`，Then 返回 `{rate:N/D,numerator:N,denominator:D,windowDays:7}`（D=0 时 rate=0）；研判不计入分子/分母。
- Given 本 story 完成，When `grep -r "suppress_ai_content" packages/core/src/modules/review-workflow/transitions.ts packages/core/src/shared/publication-status.ts`，Then 无命中（状态机零改动：suppress 不进 `LEGAL_TRANSITIONS`/`PublicationStatus`/`resolveTransition`）。
- Given `decideReview` 既有 4-outcome 路径，When 跑既有 verify-reason/verify-deepread/verify-digest，Then 全绿无回归（sibling 不触 decideReview，投影 `where:{suppressedAt:null}` 在无抑制行时与原行为一致）。

## Spec Change Log

（空。）

## Review Triage Log

### 2026-07-12 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (low 2)
- defer: 8: (low 8)
- reject: 13
- addressed_findings:
  - `[low]` `[patch]` `apps/worker/src/verify-suppress-ai-content.ts` — 新增 self-heal 存活断言：抑制 reason 后调 `refreshPublishedTimelineAll`（周期全量重投影），断言 `published_timeline_entries.recommendation_reason` 仍为 null。`refreshPublishedTimelineAll` 是本 story 新加 `where:{suppressedAt:null}` 的三处投影之一（另两处 per-event timeline + deepread 已覆盖），却无任何 verify 触及——若该分支回归，下次 self-heal job 会复活所有被抑制 reason，且无测试失败。对齐 5.3 review 为 verify-trendbriefing 补 stale-clear 分支先例。
  - `[low]` `[patch]` `apps/worker/src/verify-suppress-ai-content.ts` — 新增 fallback 分支断言：为同一事件生成 r2(live)+r3(live)，抑制 r3（最新）后断言 published reason 回退到 r2（上一未抑制版本），非 null。投影契约「最新未抑制行胜出、全抑制→null」的回退半支此前无 verify 覆盖（既有断言每事件仅 1 行，只触发「全抑制→null」）；若投影误改为「有任意被抑制即 null」，无测试失败。两断言加入后 verify 由 31→34 全绿。
  - Rejected（附理由）：SM-6 分子/分母时钟错配 + 旧内容被抑制致 rate 虚高（照搬 epic Gap 4 字面口径——分子=窗口内 suppress 决策、分母=窗口内生成行数，跨期错配是该口径的固有属性，非本 story 偏差）；silent redirect on 伪造/缺字段 form（可信运营共享身份 + 既有 `submitReview` 同形，且 targetType 已白名单守卫）；P2025 脆性/瞬态 DB 500（与既有 action 错误处理一致）；`AiContentType` 双导出（镜像既有 `ExplanationSource` 先例）；verify 时间戳 2024 vs 迁移 2026 的注释困惑（cosmetic；createdAt=now() 始终在 7 日窗内，非实际 flaky）；hardcoded numerator=3（标准测试字面，flow 改时同步改）；windowDays≤0 守卫（内部 API、唯一调用方用默认 7、无输入路径）；redirect 依赖 throw（全 operator action 既定 Next.js 模式）；garbage `?type=`→空列表（page.tsx:53-54 已将 garbage 归一为 undefined，注释正确，非 issue）；预发布 suppress 计入分子（照搬 epic 口径）；双空态 UX（cosmetic）；UI 层无 e2e（与 epic-5 全部 story verify-at-core-layer 惯例一致，本 story 未引入该缺口）；研判 browse 无独立入口（可辩护读法——研判在日报页 5.3 可 browse，抽检台排除符合「不可标记+不计入 SM-6」）。
  - Deferred（见 deferred-work.md）：并发同 targetId 抑制竞态致 SM-6 双计（条件 update 守卫）；跨事件 targetId/hotEventId 错配审计归属校验；suppress 与并发 takedown 竞态致 ghost publication（publicationStatus FOR UPDATE）；`suppress_ai_content` 未进 `ReviewOutcome` 联合体的未来 exhaustive consumer 硬化；`note` 无长度上限（镜像既有 note 先例）；SM-6/`suppressedAt` 查询缺索引（V1 低量级）；deepread 抑制触发 whole-read-model 重投影成本（已注释）；`listAiContentForSampling` take:200/kind 合并未再截断 + 静默溢出（V1 量级，真分页归 deferred）。

## Design Notes

- **为什么 suppress 是 sibling 函数而非 `decideReview` 新 outcome：** `decideReview` 的结构=HotEvent 状态机：`resolveTransition(fromStatus,outcome)→{to,action}` + 乐观锁 `updateMany` HotEvent.publicationStatus + 按 `action` 调 refresh。outcome 字面就是状态机输入字母表（`ReviewOutcome` const → `LEGAL_TRANSITIONS` → `transitions.selfcheck.ts` 的 `LEGAL_TRANSITIONS.length===6` 断言）。epic 裁决明示「**不改 decideReview 的 HotEvent 状态机**、不新增 publication_status」。把 `suppress_ai_content` 塞进 `ReviewOutcome`/`LEGAL_TRANSITIONS` 会：① 需要一条 published→published 自环 transition（虽不改可达状态图，但改 selfcheck 计数与 resolveTransition 分支）；② 让 `action` 必须表达「只刷这一块 AI 内容」——而 `PublishAction` 是 whole-event 粒度（publish/takedown/none），不匹配。sibling 函数 `suppressAiContent` 复用 `decideReview` 的「单 tx + append ReviewDecision + 调 refresh」**协调形态**，但绕开状态机，对 `decideReview`/`resolveTransition`/`LEGAL_TRANSITIONS`/`PublicationStatus`/`ReviewOutcome` const **零改动**（selfcheck 不动）。outcome 串 `"suppress_ai_content"` 直接写 `ReviewDecision.outcome`（free `String` 列）。这是 epic 字面最忠实的落地。
- **为什么持久信号放源表 `suppressedAt`（不放 ReviewDecision-tombstone、不放新表、不只改 published 投影）：** epic 的下线机制字面是「refresh 置 reason=null / deepread 删行」——即重投影。但 refresh 从源重投影：若抑制只改 published 投影列/行，下一次 whole-event refresh（revise/republish/重投影）会把被抑制内容**重新投回去**（违反 story 主旨「误导性 AI 内容不长期滞留公开页」）。让抑制跨 refresh 存活，必须有一个 refresh 会读到的持久信号。三选一：①投影热路径查 ReviewDecision tombstone——publish-orchestrator 反向依赖 review-workflow + N+1，最差；②新 suppress 表——多一张表 + 多一次 join，违反「审计走既有 ReviewDecision」；③源表 `suppressedAt` + 投影 `where:{suppressedAt:null}`——co-located（投影本来就读源），一行 where，无跨模块依赖，内容列不删（NFR-7 溯源完整）。选③。语义「最新未抑制行胜出」与 5.1/5.2 既定 latest-wins 投影一致（仅加一行排除子句），最新行被抑制则回退上一未抑制版本，全抑制→null/删行。
- **为什么 refresh 仅在 published 触发：** `refreshPublishedTimelineForEvent({action:"publish"})` 会 upsert published 行（不检 publication_status，信任 caller 只在转 published 时调）。对 candidate 事件调它=错误地发布该事件。故 `suppressAiContent` 读 `publicationStatus`，仅 `==="published"` 才 refresh（让线上立即反映）；candidate 等非 published 事件靠源 `suppressedAt` 持久，待 `decideReview` 发布时投影自然跳过。读 publicationStatus 不写它——仍守「不改状态机」。taken_down 事件不 refresh（无 live published 行需更新）。
- **为什么 SM-6 分子查 outcome+targetType 不查 note 文本：** epic Gap 4 字面「ReviewDecision where note misleading, target_type∈{reason,deepread}」是简述——结构化查询需可索引列。「misleading」语义=本条 suppress_ai_content 决策（该决策的存在即「被判误导」），由 `outcome="suppress_ai_content" AND targetType∈{reason,deepread}` 表达；`note` 是运营 free-text 理由（非查询字段）。故给 ReviewDecision 加 `targetType`/`targetId` 结构化列（传统 4 outcome 决策留 null），SM-6 走 `count(where outcome+targetType+createdAt)`，无字符串解析。`targetId`=被抑制源行 id（精确审计到哪条生成内容）。
- **为什么抽检台是 `/console/ai-content` 独立页（不塞进 `[eventId]` 4-action 表单）：** AC「进入复核台→按类型筛选 reason/deepread」要求跨事件列 AI 内容 + 类型筛选——`[eventId]` 是单事件决策页，承载不下跨事件筛选列表；且把第 5 个非状态机 outcome 按钮塞进状态机表单会混淆语义。独立页 + FilterPill（复用 chips.tsx:87 URL 驱动、JS-free）对齐既有 console 列表模式。路由：`/console/ai-content`（static）与 `/console/[eventId]`（dynamic）共存——Next App Router 静态段优先于动态段，且 eventId 是 UUID 不会 collide（对齐 Next 既定 static+dynamic 共存模式）。
- **缺失态/已下线标记：** 抽检台已下线项显示「已下线」muted（UX-DR14「已下线」状态），不渲染抑制按钮（幂等，已抑制不可重复标）。published 侧 reason=null / deepread 缺失自然走 5.1/5.2 既定缺失态（卡无 AI 槽 / 详情页「AI 深读生成中。」式降级）。
- **延后（归 deferred-work.md）：** 真实 LLM provider 接入后「重生成」action（Gap 3）、研判（TrendBriefing）抽检/下线 schema（Gap 2，待 coverageDate 复核 schema 另开 story）、抽检台分页/排序/批量操作、SM-6 历史趋势曲线（V1 仅当期读数）、`listAiContentForSampling` 的 `take` 上限改真分页。

## Verification

**Commands:**
- `pnpm --filter @aguhot/core db:migrate -- --name add_ai_content_suppression` -- 迁移生成并应用成功（`review_decisions` 加 target_type/target_id；`recommendation_reasons`+`deep_reads` 加 suppressed_at；无 FK、无 publication_status 改动）。
- `pnpm typecheck` -- 全 5 包类型检查通过（含新 sibling fn、投影 where 改动、新 console 页/action、verify 脚本）。
- `pnpm lint` -- 通过。
- `pnpm --filter @aguhot/worker verify:suppress-ai-content` -- Stub 链路全绿：published reason 抑制→源 suppressedAt + ReviewDecision + published reason=null + 事件仍 published；deepread 抑制→源 suppressedAt + published 行删除；幂等重标不新增审计行；candidate 抑制不 refresh 且持久存活到发布；republish 不复活；SM-6 读数口径；trend_briefing 排除；target 不存在 fail-fast。
- `pnpm --filter @aguhot/worker verify:reason` / `verify:deepread` / `verify:digest` / `verify:trendbriefing` -- 投影 `where:{suppressedAt:null}` 改动无回归（无抑制行时行为与原一致；sibling 不触 decideReview）。

**Manual checks (if no CLI):**
- `grep -rn "suppress_ai_content" packages/core/src/modules/review-workflow/transitions.ts packages/core/src/shared/publication-status.ts` -- 无命中（状态机零改动）。
- `grep -rn "StubLlmAdapter" apps/worker/src/queues apps/web` -- worker 运行时/公开页不 import Stub（TEST-ONLY 隔离）。
- 抽检台 `/console/ai-content` 视觉：SM-6 读数 inline、FilterPill 三态、AiLabel 紧邻内容、已下线项 muted；抑制后事件仍可访问 `/console/{eventId}` 且 `publication_status=published`。

## Auto Run Result

Status: done

**实现摘要：** 落地 Story 5.4「AI 生成内容运营抽检」——在 review-workflow 加 **sibling** 函数 `suppressAiContent`（**不**经 `decideReview`/`resolveTransition`/`LEGAL_TRANSITIONS`、**不**改 `PublicationStatus`/`ReviewOutcome` const、状态机 selfcheck `LEGAL_TRANSITIONS.length===6` 零变动，照 epic「不改 decideReview 状态机」字面）：单 `$transaction` 内置源 `suppressedAt`（explanation 模块 sole-writer `suppressRecommendationReason`/`suppressDeepRead`）→ append `ReviewDecision(outcome="suppress_ai_content",targetType,targetId,note)`（既有审计表 +2 nullable 列 `targetType`/`targetId`，传统 4-outcome 决策留 null）→ **仅当 `publicationStatus==="published"`** 调 `refreshPublishedTimelineForEvent`（reason）/`refreshPublishedReadModel`（deepread）让线上立即反映。抑制持久信号 = 源表 `suppressedAt`（RecommendationReason + DeepRead 各加 nullable 列）+ 三处投影加 `where:{suppressedAt:null}`（per-event timeline、`refreshPublishedTimelineAll` self-heal、`projectDeepRead`）→ 抑制跨 republish/self-heal 存活（不复活），内容列不删（NFR-7 溯源完整）。`getSm6MisleadingRate`（7 日滚动窗、reason+deepread 聚合分子/分母、研判排除、查 `ReviewDecision` 审计表）。运营台新页 `/console/ai-content`：`listAiContentForSampling`（explanation 模块，跨事件 reason+deepread 统一列表、研判排除、不按 suppressedAt 过滤）+ `FilterPill`(全部/reason/deepread) + 顶部 SM-6 inline 读数 + 每行「标记为误导并下线」server action（`submitSuppressAiContent`，targetType 白名单 reason|deepread 拒 trend_briefing）+ 已下线「已下线」标记（UX-DR14）。V1 不做重生成（Gap 3 延后）。审计复用既有 `ReviewDecision`（不新建表）。

**改动文件：**
- `packages/core/prisma/schema.prisma`（`ReviewDecision` +targetType/targetId；`RecommendationReason`+`DeepRead` +suppressedAt；状态机零改）
- `packages/core/prisma/migrations/20260712000003_add_ai_content_suppression/migration.sql`（4 nullable 列，无 FK、无 status 改动）
- `packages/core/src/modules/explanation/types.ts`（`AiContentType` + suppress/sampling/SM-6 相关类型）
- `packages/core/src/modules/explanation/reason-service.ts`（`suppressRecommendationReason`）
- `packages/core/src/modules/explanation/deep-read-service.ts`（`suppressDeepRead`）
- `packages/core/src/modules/explanation/ai-content-sampling-service.ts`（`listAiContentForSampling` + take 上限，新文件）
- `packages/core/src/modules/explanation/index.ts` + `packages/core/src/index.ts`（barrel 导出）
- `packages/core/src/modules/publish-orchestrator/timeline-read-model.ts`（reason 投影 per-event + All 加 `where:{suppressedAt:null}`）
- `packages/core/src/modules/publish-orchestrator/publish-service.ts`（`projectDeepRead` 加 `suppressedAt:null`）
- `packages/core/src/modules/review-workflow/types.ts`（`SUPPRESS_AI_CONTENT_OUTCOME` 独立 const + suppress/SM-6 类型）
- `packages/core/src/modules/review-workflow/review-service.ts`（`suppressAiContent` sibling + `getSm6MisleadingRate`，**不改** `decideReview`）
- `packages/core/src/modules/review-workflow/index.ts` + `packages/core/src/index.ts`（barrel）
- `apps/web/app/(operator)/console/ai-content/page.tsx`（抽检台：SM-6 读数 + FilterPill + 列表 + 抑制 form + 已下线标记，新文件）
- `apps/web/app/(operator)/console/ai-content/actions.ts`（`submitSuppressAiContent` server action，新文件）
- `apps/web/app/(operator)/console/page.tsx`（入口链接）
- `apps/worker/src/verify-suppress-ai-content.ts`（Stub 驱动 verify，34 断言，新文件）
- `apps/worker/package.json`（`verify:suppress-ai-content` 脚本）

**Review 结果：** 4 层并行 review（blind-hunter / edge-case-hunter / verification-gap / intent-alignment）。无 intent_gap、无 bad_spec。应用 2 个 patch（均低危、均加 verify 断言）：①self-heal 存活断言——`refreshPublishedTimelineAll`（周期全量重投影）须跳过被抑制 reason，此前该投影路径无 verify 覆盖；②fallback 分支断言——抑制最新 reason 后 published 应回退到上一未抑制版本（非 null），此前「全抑制→null」半支之外「回退」半支无 verify。verify 由 31→34 全绿。defer 8 项（并发同 target 竞态双计、跨事件 targetId 归属校验、suppress×takedown ghost publication 竞态、outcome 未进 ReviewOutcome 的未来 exhaustive 硬化、note 无长度上限、SM-6/suppressedAt 缺索引、deepread 抑制 whole-read-model 重投影成本、sampling take:200 静默溢出——均 V1 低量/低并发/既定模式，post-V1 硬化）。reject 13 项（SM-6 时钟错配=epic Gap 4 字面口径、silent redirect/P2025 脆性/瞬态 500=既有 action 既定模式、AiContentType 双导出=镜像 ExplanationSource、verify 时间戳/numerator=标准实践、windowDays/redirect-throw=内部 API+Next 既定模式、garbage type=page 已归一、UI 无 e2e=epic-5 verify-at-core 惯例、研判 browse=可辩护读法等）。

**Follow-up review 建议：** false —— 最终 pass 的 2 个 patch 全部是 verify-script 断言新增（self-heal 存活 + fallback 分支），局部、低后果（纯测试覆盖、无行为/API/数据/安全变更），且 typecheck/lint/34 断言 verify 全绿。无独立 follow-up 必要。

**Verification 执行：**
- `pnpm --filter @aguhot/core db:migrate`（`add_ai_content_suppression`）→ 迁移应用（4 nullable 列、无 FK、无 status 改动；`aguhot_dev` 库 `\d` 确认）
- `pnpm typecheck`（全 5 包）→ 绿
- `pnpm lint`（全 5 包）→ 绿
- `pnpm --filter @aguhot/worker verify:suppress-ai-content` → **PASS 34/34**（含 patch 后新增：self-heal 存活、fallback 回退；覆盖 published reason/deepread 抑制+投影刷新、状态机不动、幂等不双计、candidate 抑制不误发且持久到发布、republish 存活、self-heal 存活、fallback 回退、SM-6 口径、研判排除、list 过滤、缺失 target fail-fast）
- `pnpm --filter @aguhot/worker verify:reason` / `verify:deepread` / `verify:digest` / `verify:trendbriefing` → 全绿（投影 `where:{suppressedAt:null}` 在无抑制行时与原行为一致，sibling 不触 decideReview，无回归）
- `pnpm --filter @aguhot/core verify:review-logic`（selfcheck）→ PASS（`LEGAL_TRANSITIONS.length===6`，状态机完整）
- grep 确认 `suppress_ai_content` 不出现在 `transitions.ts`/`publication-status.ts`；`ReviewOutcome` const 仍 4 值；`PublicationStatus` 仍 4 值；`apps/worker` 运行时 + `apps/web` 不 import `StubLlmAdapter`；无新增 LLM SDK 依赖

**Residual risks / artifacts：**
- V1 prod 运营 auth 尚未接真实 token（`isOperatorAuthenticated` 非 prod 恒 true，与既有 `/console` 同——真实 auth 归 user-profile epic）。
- SM-6 7 日窗在低量级下单次抑制即令 ratio 大幅波动（epic Gap 4 字面口径；历史趋势曲线归 deferred）。
- `_bmad-output/implementation-artifacts/.review-diff-5-4.patch` 为本次 review 快照（随 story 提交，对齐 5.1/5.2/5.3 惯例）。
- verify 脚本需本地 PG（`aguhot_dev`）+ core `dist/` 重建后 worker 方见新导出（仓库既定约定）。
