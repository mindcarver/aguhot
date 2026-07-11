---
title: '日报页 AI 趋势研判（TrendBriefing 真相表 + 生成链 + 日报投影与渲染）'
type: 'feature'
created: '2026-07-12'
status: 'done'
baseline_revision: '900a200ca86941ac6013cfbc74b49c657329d07c'
final_revision: 'c25d101460b082c048743ad7e8fb8d9d5bd2889e'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-5-2-event-deep-read.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** 日报页（`/daily`）今天只渲染 `published_daily_digests` 投影出的当日事件条目列表（每条一句话 conclusion），其上没有任何跨事件 AI 研判。epic AC（epics.md 对应 Story 5.3、epic-5-context :13/:22）要求日报页生成一段跨事件「趋势研判」（带 AI 标识、与证据一致、不得编造 NFR-2、append-only 版本化 NFR-7/AD-5），主题页研判（5.3b）延后 v1.1。codebase 现状：`LLMAdapter` 端口（5.1/5.2 落地）有 `generateReason`/`generateDeepRead` 两法，均 per-HotEvent；无 `TrendBriefing` 表、无 coverageDate 键的生成 service、无日报级投影、日报页无研判槽。日报生成 job（`daily-digest-queue`）已是 adapter 驱动 + `const adapter = undefined` honest-degradation 形态，epic 明示研判挂此 job（epic-5-context :22「趋势研判随日报生成 job 发布」、:65「趋势研判挂这里」）。

**Approach:** 照抄 5.2 的端口+service+投影先例与日报模块「coverageDate 键真相表 + 一 published_* 投影 + sibling refresh 函数」先例（`DailyDigest`/`PublishedDailyDigest`/`refreshPublishedDailyDigest`）：(1) 在 `LLMAdapter` 端口加第三个方法 `generateTrendBriefing`（epic-5-context :108「三者共用端口」）；(2) 新增 `TrendBriefing` append-only 真相表（coverageDate 键、source/modelId/promptVersion/createdAt + data-only `basedOnHotEventIds` Json，NFR-7，**无 FK 到 hot_events**——日报模块不变量）+ `published_trend_briefings` 投影表（coverageDate @id）；(3) 新增 digest 模块 `trend-briefing-service`（`adapter===undefined`→null 不写库；复用 `listPublishedHotEvents`+`filterByCoverageDay` 发现当日事件、取 title/summary 作 grounding；6 类黑名单 + 长度 fail-fast 校验）；(4) 新增 sibling `refreshPublishedTrendBriefing`（镜像 `refreshPublishedDailyDigest`：读最新→upsert 或 deleteMany）+ `getPublishedTrendBriefing` 读查询；(5) 扩展 `daily-digest-queue` worker 在日报生成旁用同一 job 生成研判（双 adapter 注入点，V1 均 undefined→短路 honest degradation）；(6) 日报页 `<DigestContent>` 内、`<dl>` 与 `<ol>` 之间渲染研判段 + `AiLabel`，缺失态「AI 趋势研判生成中。」。V1 用 Stub 跑通，真实 provider 注入点留好但不接入，不新增第三方 LLM SDK 依赖。

## Boundaries & Constraints

**Always:**
- `TrendBriefing` 是 coverageDate 键独立 append-only 真相表（不复用 `DailyDigest`——后者 `items Json` 承载事件条目列表，研判是单段跨事件段落，二者同页共存不可同表；不复用 `ExplanationVersion`/`DeepRead`——它们 per-HotEvent，研判 per-coverageDate）。照抄日报模块既定「coverageDate 键、无 FK 到 hot_events、data-only 链接」不变量（`digest/types.ts:1-34` 与 barrel 注释）：`basedOnHotEventIds Json` 承载「依据的事件集合」（满足 epic `TREND_BRIEFING }o--o{ HOT_EVENT : based_on` 的逻辑关系，物理落地为 data-only Json 而非 m2m + FK，与 `DailyDigest.items` 同形）。见 Design Notes。
- 端口形态照抄 5.2（5.1 注释 :238 已预告「三者共用端口」）：`LLMAdapter` 接口加 `generateTrendBriefing(args:LlmTrendBriefingArgs):Promise<LlmTrendBriefingResult|null>`；`LlmTrendBriefingArgs={coverageDate:Date; events:ReadonlyArray<{hotEventId:string;title:string;summary:string}>}`；`LlmTrendBriefingResult={briefing:string;modelId:string;promptVersion:string}`；`stub-llm-adapter.ts` 增 `STUB_TREND_BRIEFING`（单段固定串，过六类黑名单、≤上限、中性语气）+ `STUB_TREND_BRIEFING_PROMPT_VERSION="trendbriefing-stub-v1"`；service 首行 `if(adapter===undefined)return null` 不写库；worker 双 adapter 注入点（`const digestAdapter=undefined` + `const llmAdapter=undefined`）+ `// ponytail: real provider wired when procured`。
- `refreshPublishedTrendBriefing` 是 `published_trend_briefings` 的唯一写者（AD-2/AD-3b），**sibling 函数**而非 `refreshPublishedReadModel` 的分支（研判 coverageDate 键，非 hotEventId 键，镜像 `refreshPublishedDailyDigest`）。读最新 `TrendBriefing`（createdAt desc, id desc tiebreaker）→ upsert；无行 → deleteMany。worker 在 `generateTrendBriefing` 成功后调 `refreshPublishedTrendBriefing` 让新研判立即上报页（镜像日报 worker append 后调 `refreshPublishedDailyDigest`）。
- 研判文本写入前 fail-fast 校验：briefing trim 后非空、码点长度（`[...s].length`）≤ `TREND_BRIEFING_MAX_LENGTH`（=200，story-time 默认，可一行编辑调整）、过 `passesRecommendationGuardrail`（PRD §10 六类黑名单，5.1 已导出，PRD-§10 通用非 reason 专属，5.2 已复用）；modelId/promptVersion 非空。违例抛错 → worker try/catch 捕获 → 该 coverageDate 留 null（缺失态），job 失败重抛让 BullMQ 标记。
- `source` 写 `ExplanationSource.Ai`（已存在枚举值，对齐 reason/deepread；**不改 `DigestSource` 枚举**——研判表 `source` 列保持 String，TS 侧用 ExplanationSource.Ai 赋值）。
- 真实 LLM provider 注入点留好但 V1 不接入，**不新增任何第三方 LLM SDK 依赖**；Stub 仅 verify/e2e 使用，`apps/worker` 运行时不得 import Stub。

**Block If:** 无（真实 provider 接入、retry 循环、worker 自动调度/cron、主题页研判 5.3b、运营抽检台研判筛选均在范围外/5.4/5.3b）。

**Never:**
- 不复用 `DailyDigest`/`ExplanationVersion`/`DeepRead` 表承载研判（schema 冲突 + 键不同）。
- 不给 `TrendBriefing` 加 FK 到 `hot_events` 或在 `HotEvent` 加反向关系（违反日报模块「no FK, data-only link」不变量；`basedOnHotEventIds` 是 data-only）。
- 不绕过 `refreshPublishedTrendBriefing` 直写 `published_trend_briefings`（worker 只 append `TrendBriefing` + 触发 sibling 投影）。
- 不让 `apps/worker` 运行时 import `StubLlmAdapter`（TEST-ONLY）。
- 不引入 retry 循环（违例→落缺失态；下次 worker 自然重试，归 deferred）。
- 不新增 LLM SDK 依赖，不改 `DigestSource` 枚举。
- 不在本 story 做主题页研判（5.3b）、不改运营复核台（5.4）。
- 不为研判开第 10 个 worker 队列（epic 明示挂 daily-digest-queue，且二者同 coverageDate、同 adapter 驱动形态一致，与 5.2「深读开独立队列」情形不同——这里 epic 字面与形态都对齐）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 当日有已发布事件 + Stub | coverageDate 有 ≥1 已发布事件、无 TrendBriefing；传入 StubLlmAdapter | 写一条 TrendBriefing（source=ai、briefing=STUB、modelId/promptVersion/createdAt/basedOnHotEventIds 齐全）；refresh 后 `published_trend_briefings` 出现 briefing；日报页 `<DigestContent>` 渲染研判段 + AiLabel | 无 |
| V1 prod honest degradation | worker 注册运行（digestAdapter=undefined, llmAdapter=undefined） | 双短路返回 `{generated:0,considered:1,skipped:1}`；service 返回 null、不写库；投影无行；日报页渲染缺失态「AI 趋势研判生成中。」 | 无错误，诚实降级 |
| 当日无已发布事件 | coverageDate 无已发布事件（filterByCoverageDay 返回空） | 返回 null，不写库 | 无错误 |
| 黑名单/超长/空段命中 | adapter 返回 briefing 命中六类黑名单、或 >200 字、或空 | 抛错，不写 TrendBriefing 行；worker catch 捕获、重抛、该 coverageDate 留 null | fail-fast |
| 重生成/self-heal 幂等投影 | 同 coverageDate 已有 TrendBriefing，再次 generate 或 refresh 重跑 | append 新版本（count→2），投影从最新重新派生（幂等，published 行 stable） | 无 |
| 投影随日报生成 job | daily-digest-queue handler 成功生成研判 | 调 `refreshPublishedTrendBriefing`，`published_trend_briefings` upsert 该 coverageDate 行 | 日报/研判互不阻塞（各自 if-adapter 独立） |

</intent-contract>

## Code Map

- `packages/core/prisma/schema.prisma` -- 新增 `TrendBriefing` model（coverageDate 键真相表，data-only `basedOnHotEventIds`，无 FK）+ `PublishedTrendBriefing` model（coverageDate @id 投影）。**不改 HotEvent**（无反向关系）。
- `packages/core/src/modules/explanation/types.ts` -- 加 `LlmTrendBriefingResult`/`LlmTrendBriefingArgs`，`LLMAdapter` 接口加 `generateTrendBriefing`（第三法）。
- `packages/core/src/modules/explanation/stub-llm-adapter.ts` -- 加 `STUB_TREND_BRIEFING` + 实现 `generateTrendBriefing`。
- `packages/core/src/modules/explanation/index.ts` + `packages/core/src/index.ts` -- barrel 导出研判相关符号。
- `packages/core/src/modules/digest/trend-briefing-service.ts` -- 新增 `generateTrendBriefing`/`getLatestTrendBriefing`/`TREND_BRIEFING_MAX_LENGTH`/`validateTrendBriefing`（复用 `filterByCoverageDay` + explanation 的 `passesRecommendationGuardrail`）。
- `packages/core/src/modules/digest/index.ts` -- barrel 导出研判 service 符号。
- `packages/core/src/modules/publish-orchestrator/publish-service.ts` -- 加 sibling `refreshPublishedTrendBriefing`（镜像 `refreshPublishedDailyDigest`）+ `getPublishedTrendBriefing`（findUnique by coverageDate）。
- `packages/core/src/modules/publish-orchestrator/types.ts` + `index.ts` + `packages/core/src/index.ts` -- `PublishedTrendBriefing` 契约 + barrel。
- `apps/worker/src/queues/daily-digest-queue.ts` -- handler 扩展双 adapter（digestAdapter + llmAdapter），V1 双 undefined 短路；llmAdapter 路径调 `generateTrendBriefing` + `refreshPublishedTrendBriefing`。
- `apps/worker/src/verify-trendbriefing.ts` -- 新增 Stub 驱动 verify 脚本（镜像 verify-digest.ts + verify-deepread.ts fail-fast 段）。
- `apps/worker/src/verify-reason.ts` + `apps/worker/src/verify-deepread.ts` -- 端口加法 fallout：内联 `LLMAdapter` 字面量补 `generateTrendBriefing: () => null` stub（对齐 5.2 为 verify-reason 补 generateDeepRead 先例）。
- `apps/worker/package.json` -- 加 `verify:trendbriefing` 脚本。
- `apps/web/app/(public)/daily/page.tsx` -- 调 `getPublishedTrendBriefing`；`<DigestContent>` 内 `<dl>` 与 `<ol>` 之间新增研判子区块（AiLabel + 段落，缺失态「AI 趋势研判生成中。」）。

## Tasks & Acceptance

**Execution:**
- `packages/core/prisma/schema.prisma` -- 新增 `TrendBriefing` model（`id String @id` UUIDv7 app 赋 / `coverageDate DateTime @map("coverage_date")` / `briefing String` / `basedOnHotEventIds Json @map("based_on_hot_event_ids")` / `source String` / `modelId String @map("model_id")` / `promptVersion String @map("prompt_version")` / `traceId String? @map("trace_id")` / `createdAt DateTime @default(now()) @map("created_at")`，`@@index([coverageDate])` `@@index([createdAt])`，`@@map("trend_briefings")`，**无 FK、无 HotEvent 反向关系**）+ `PublishedTrendBriefing` model（`coverageDate DateTime @id @map("coverage_date")` / `briefing String` / `source String` / `generatedAt DateTime @map("generated_at")` / `traceId String? @map("trace_id")` / `updatedAt DateTime @updatedAt @map("updated_at")`，`@@map("published_trend_briefings")`）-- coverageDate 键真相表 + 投影（NFR-7，日报模块 no-FK 不变量）。
- `packages/core/prisma/migrations/20260712000002_add_trend_briefing/migration.sql` -- `pnpm --filter @aguhot/core db:migrate -- --name add_trend_briefing` 生成并提交 -- schema 落地。
- `packages/core/src/modules/explanation/types.ts` -- 新增 `LlmTrendBriefingResult`（`{briefing;modelId;promptVersion}`）+ `LlmTrendBriefingArgs`（`{coverageDate:Date; events:ReadonlyArray<{hotEventId:string;title:string;summary:string}>}`）；`LLMAdapter` 接口加 `generateTrendBriefing(args:LlmTrendBriefingArgs):Promise<LlmTrendBriefingResult|null>`（第三法，注释说明 5.3 复用本端口、epic-5-context :108「三者共用」、grounding 为当日事件 title/summary、NFR-2）-- 端口契约（对照 5.2 generateDeepRead 块）。
- `packages/core/src/modules/explanation/stub-llm-adapter.ts` -- 加 `STUB_TREND_BRIEFING`（单段固定中性串 ≤200 字、过六类黑名单，如「当日热点围绕若干产业链环节展开，相关事件在证据归档基础上呈现一定延续性，部分细节仍待进一步确认。」）+ `STUB_TREND_BRIEFING_PROMPT_VERSION="trendbriefing-stub-v1"`；`StubLlmAdapter.generateTrendBriefing` `void` 掉 args 后返回 `{briefing:STUB_TREND_BRIEFING, modelId:"stub:v1", promptVersion:STUB_TREND_BRIEFING_PROMPT_VERSION}` -- TEST-ONLY 确定性（对照 `STUB_DEEP_READ`）。
- `packages/core/src/modules/digest/trend-briefing-service.ts` -- 新增 `TREND_BRIEFING_MAX_LENGTH=200`（码点/字；SM-C3「研判有上限」story-time 默认，可调）+ `generateTrendBriefing({prisma,traceId,coverageDate,adapter?})`：`adapter===undefined`→null 不写库；`listPublishedHotEvents({prisma,traceId})` + 复用本模块 `filterByCoverageDay(all,coverageDate)` 发现当日事件；空→null；按 evidenceCount desc 排序、取 top 12（bound prompt，对齐日报条目排序先例）作 `{hotEventId,title,summary}`（title=latest revision overlay、summary=latest ExplanationVersion overlay，对齐 reason/deep-read overlay 取法）；调 `adapter.generateTrendBriefing({coverageDate,events})`；raw null→null；`validateTrendBriefing`（trim + 码点长度 ≤200 + `passesRecommendationGuardrail` + modelId/promptVersion 非空）违例抛错；append 一条 `TrendBriefing`（`source: ExplanationSource.Ai`（从 explanation 模块导入）、`basedOnHotEventIds` = 当日事件 id 数组、`id:newTraceId()`、modelId/promptVersion/traceId carried verbatim）。导出 `getLatestTrendBriefing`（where coverageDate，createdAt desc+id desc tiebreaker）-- 生成链（NFR-2/NFR-3/NFR-7）。
- `packages/core/src/modules/digest/index.ts` -- barrel 导出 `generateTrendBriefing`/`getLatestTrendBriefing`/`TREND_BRIEFING_MAX_LENGTH` -- 对外契约。
- `packages/core/src/modules/explanation/index.ts` 与 `packages/core/src/index.ts` -- barrel 导出 `LlmTrendBriefingResult`/`LlmTrendBriefingArgs`/`STUB_TREND_BRIEFING` -- 端口契约对外。
- `packages/core/src/modules/publish-orchestrator/publish-service.ts` -- 加 `refreshPublishedTrendBriefing({prisma,traceId,coverageDate})`（**sibling**，镜像 `refreshPublishedDailyDigest:1036-1083`：读最新 `trendBriefing` where coverageDate orderBy `[{createdAt:"desc"},{id:"desc"}]` select briefing+source+createdAt → 有则 upsert `published_trend_briefings` where `{coverageDate}`（briefing+`source`+`generatedAt=latest.createdAt`+traceId），无则 `prisma.publishedTrendBriefing.deleteMany({where:{coverageDate}})`；幂等）；加 `getPublishedTrendBriefing({prisma,traceId,coverageDate})`（`publishedTrendBriefing.findUnique({where:{coverageDate}})` → 返回 `{coverageDate,briefing,source,generatedAt}|null`）-- 投影 + 读查询（唯一写者不变）。
- `packages/core/src/modules/publish-orchestrator/types.ts` + `index.ts` + `packages/core/src/index.ts` -- 加 `PublishedTrendBriefing`（`{coverageDate:Date;briefing:string;source:string;generatedAt:Date}`）+ `RefreshPublishedTrendBriefingOptions`/`GetPublishedTrendBriefingOptions` + barrel 导出 `refreshPublishedTrendBriefing`/`getPublishedTrendBriefing` -- 读模型契约。
- `apps/worker/src/queues/daily-digest-queue.ts` -- handler 扩展：动态 import 增 `generateTrendBriefing`/`refreshPublishedTrendBriefing`；`const adapter=undefined` 拆为 `const digestAdapter: DigestAdapter|undefined = undefined` + `const llmAdapter: LLMAdapter|undefined = undefined`（各带 ponytail 注释）；V1 双 undefined → 仍 `return {generated:0,considered:1,skipped:1}`（短路 honest degradation）；`try` 块内先（若 `digestAdapter!==undefined`）走既有 `generateDailyDigest`+`refreshPublishedDailyDigest`，再（若 `llmAdapter!==undefined`）调 `generateTrendBriefing({prisma,traceId,coverageDate,adapter:llmAdapter})`→非 null 则 `refreshPublishedTrendBriefing`，累计 `generated`；catch 不变（log+rethrow）-- 日报/研判同 job、同 coverageDate、各自 adapter 独立、互不阻塞。
- `apps/worker/src/verify-trendbriefing.ts` -- 新增 Stub 驱动 verify 脚本（对照 `verify-digest.ts` 骨架 + `verify-deepread.ts` fail-fast 段）：seed evidenceSource + 2 条同 UTC 日 evidenceRecord → clusterEvents → generateExplanation → decideReview(approve) 发布 → `new StubLlmAdapter()` 调 `generateTrendBriefing` 断言行写入（briefing===STUB、source=ai、modelId/promptVersion/traceId 齐全、basedOnHotEventIds 含当日事件 id、≤200 字、过黑名单）→ 调 `refreshPublishedTrendBriefing` 后断言 `published_trend_briefings` 行非空 + `getPublishedTrendBriefing` 读查询返回 briefing → append-only（二次 generate count→2 + 投影取最新）→ self-heal（`refreshPublishedTrendBriefing` 重跑存活）→ `adapter===undefined` 返回 null 不写库 → 黑名单/超长(201)/空 fail-fast 抛错不写行（边界 200 接受/201 拒绝）→ 无当日事件→null。`resetState` 先清 `publishedTrendBriefing` + `trendBriefing`。`apps/worker/package.json` 加 `verify:trendbriefing` -- 证明链路。
- `apps/worker/src/verify-reason.ts` + `apps/worker/src/verify-deepread.ts` -- 端口加第三法后，文件内所有内联 `LLMAdapter` 字面量补 `generateTrendBriefing: () => null` stub（对齐 5.2 为 verify-reason 补 `generateDeepRead` 先例），保持 `implements LLMAdapter` 类型完整 -- 端口扩展无回归。
- `apps/web/app/(public)/daily/page.tsx` -- 服务端组件 `page` 内、取 `getPublishedDailyDigest` 后增 `getPublishedTrendBriefing({prisma,traceId,coverageDate})`；把结果（`{briefing,source,generatedAt}|null`）作 `trendBriefing` prop 传入 `<DigestContent>`；`<DigestContent>` 内 `<dl>`（:158-171）**之后**、`<ol>`（:173）**之前**新增研判子区块：`trendBriefing` 非空 → `<AiLabel/>` + 「AI 趋势研判」小标题 + `<p className="text-sm text-ink-secondary">`（视觉权重 ≤ 事实条目，对齐 5.2 深读权重约束）；为空 → 渲染诚实缺失态「AI 趋势研判生成中。」（muted，对齐既有「日报生成中。」与 5.2「AI 深读生成中。」模式）-- 日报页落地（UX :96，NFR-3）。

**Acceptance Criteria:**
- Given `LLMAdapter` 此前有 `generateReason`/`generateDeepRead`，When 5.3 dev 完成，Then 端口增 `generateTrendBriefing`，`digest/` 下出现 `trend-briefing-service.ts` 且 `apps/worker` 不 import Stub、不新增 LLM SDK 依赖。
- Given coverageDate 有已发布事件且无 TrendBriefing，When 用 `StubLlmAdapter` 调 `generateTrendBriefing` 并 `refreshPublishedTrendBriefing`，Then 写入一条 `TrendBriefing`（source=ai、briefing=STUB、basedOnHotEventIds 含当日事件 id、modelId/promptVersion/createdAt 齐全），`published_trend_briefings` 出现 briefing，日报页 `<DigestContent>` 渲染研判段 + `AiLabel`。
- Given V1 prod（worker 双 adapter 均 undefined），When daily-digest worker 运行，Then 双短路返回 skipped、service 返回 null、不写库、投影无行、日报页渲染「AI 趋势研判生成中。」缺失态。
- Given adapter 返回命中黑名单或 briefing >200 字或空，When `generateTrendBriefing` 校验，Then 抛错、不写行；边界 200 字接受、201 字拒绝。
- Given 同 coverageDate 已有 TrendBriefing，When 再次 generate 或 `refreshPublishedTrendBriefing` 重跑，Then append 新版本（count→2），投影从最新重新派生（幂等，published 行 stable），`refreshPublishedTrendBriefing` 仍是 `published_trend_briefings` 唯一写者。
- Given 日报生成 job 运行且 llmAdapter 已注入，When handler 走研判分支，Then `generateTrendBriefing` 成功后调 `refreshPublishedTrendBriefing`，研判与日报互不阻塞（任一 adapter undefined 时另一路径仍可独立产出）。

## Spec Change Log

（空。）

## Review Triage Log

### 2026-07-12 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (medium 1, low 1)
- defer: 4: (low 4)
- reject: 18
- addressed_findings:
  - `[medium]` `[patch]` `apps/worker/src/verify-trendbriefing.ts` — 新增 `refreshPublishedTrendBriefing` 空真相行→`deleteMany` 清投影分支断言（第 25 条）。sibling `verify-digest.ts:40-41` 断言 #10 明确覆盖 `refreshPublishedDailyDigest` 同一 stale-clear 分支，本 story 的 verify 未覆盖（`emptyCoverageDate` 只用于 adapter-missing/no-eligible 测试，从未传给 refresh）。该分支是投影自纠正、`/daily` 不长期服务 stale briefing 的保证，否则未来有人误删 `deleteMany` 或改错条件会静默通过。照抄 5.2 review 为 verify-deepread 补 takedown 真相存活断言的先例。
  - `[low]` `[patch]` `packages/core/src/modules/digest/trend-briefing-service.ts` — 合并重复的 `import type { Prisma }` / `import type { PrismaClient }`（同源两行）为一行。
  - Rejected（附理由）：`basedOnHotEventIds` 存全量 eligible 而非 top-12 adapter 输入（spec Tasks 明示「`basedOnHotEventIds` = 当日事件 id 数组」，dev 注释解释为 data-only 审计链接，对齐 `DailyDigest.items` 先例——spec 定义如此，非偏差）；worker 共享 try/catch 致 trend throw 标记整 job 失败（spec AC「任一 adapter undefined 时另一路径独立产出」指 undefined 情形，code 的独立 `if` 块满足；throw 情形 benign：append-only latest-wins + V1 无 retry + 返回值无人消费——记 defer）；DB 无 CHECK 长度约束 / modelId-promptVersion 无上限（对齐 reason/deepread/digest 全部既有 AI 表，皆无 CHECK，adapter 为受控信任边界非用户输入——一致模式）；`GetPublishedTrendBriefingOptions.traceId` 未使用（镜像 sibling `getPublishedDailyDigest` 同样 drop traceId，API 形态一致）；verify 内联 adapter 重复（test-internal，对齐 5.2 verify 结构）；内部空白未折叠（trim 仅首尾为既定模式）；NaN coverageDate（`new Date` 解析失败→filterByCoverageDay 返回空→null，benign 降级，对齐 2.4 digest worker 先例）；coverageDate 非 UTC 午夜归一化（日报/研判投影共用同一 job 的 coverageDate 键，键源一致对齐，2.4 既定模式）；evidenceCount=0 排序任意（确定性 by hotEventId desc，已发布事件必有证据，边沿 benign）；空 modelId+空 briefing 错误次序（cosmetic 诊断次序）；并发 refresh read-then-upsert 非原子（镜像 sibling，BullMQ job 级隔离，低并发）；verify rankAndBound 单事件 exercise 弱（确定性函数，对齐 verify-digest 少种子模式）；verify basedOnHotEventIds 全量 vs 有界断言弱（单事件，低后果）；verify step 6b 禁词空表 vacuous-pass（RECOMMENDATION_FORBIDDEN_PHRASES 为 PRD §10 核心常量不会空、且 step 8 count 断言会捕获 guardrail 失效，自检测）；adapter hang 无 timeout（真实 provider 关注，V1 stub 不会 hang，归 procurement deferred）。
  - Deferred（见 deferred-work.md）：render-gating 解耦（briefing fetch gate `digest!==null`——spec 明示 briefing 渲染于 `<DigestContent>` 内，正常操作下 digest-null⟺无事件⟺briefing-null，仅 post-V1 双 adapter 且 digest adapter 失败的窄边沿方丢，dev 照 spec 做）；worker per-path try/catch 部分-成功上报（post-V1 硬化）；`loadEventContext` N+1 findUnique→batch findMany（bounded ≤12、已注释、一行可改）；6 类子串黑名单对合法金融词汇的 false-positive（5.3 现为第 3 个消费者，真实 provider 接入时调，5.2 已登记）。

## Design Notes

- **为什么 coverageDate 键 + sibling 投影（非 per-HotEvent、非挂 `refreshPublishedReadModel`）：** 研判是跨当日事件的聚合段落，键是 coverageDate（epic-5-context :22/:58「按 coverageDate/Theme 键」「随日报生成 job 发布」），与 `DailyDigest` 同键。日报模块既定架构（`digest/types.ts:1-34` + barrel 注释）以「coverageDate 键、无 FK 到 hot_events、sibling `refreshPublishedDailyDigest` 投影」处理日报聚合——研判同形跟随，故 `TrendBriefing`+`PublishedTrendBriefing`+sibling `refreshPublishedTrendBriefing`，而非塞进 hotEventId 键的 `refreshPublishedReadModel`（那是详情页多关注点投影，键不匹配）。与 5.2 深读（per-HotEvent，挂 `refreshPublishedReadModel` 第 7 投影）形成对照：键决定形态。
- **为什么 data-only `basedOnHotEventIds` 而非 epic 字面 m2m（`TREND_BRIEFING }o--o{ HOT_EVENT`）：** epic D2 图是逻辑数据模型；物理落地照抄 `DailyDigest.items` 的 data-only 链接先例（日报模块「no FK, data-only link, cross-page navigation is not a module」不变量）。m2m + FK + cascade 会违反该不变量、增加迁移/resetState 复杂度、且对一段研判无功能增益（依据集合只需可审计记录，不需可导航关系）。`basedOnHotEventIds Json` 满足 NFR-2「与证据一致、可追溯」与 epic「based_on HotEvent 集合」意图。reviewer 若坚持物理 m2m 请升 intent_gap。
- **为什么挂 daily-digest-queue（非第 10 个 worker）：** epic 字面（:22/:65）明示研判挂日报 job。与 5.2「深读开独立 deep-read-queue」情形不同：5.2 的 explain-queue 是「确定性/仅 candidate/无 adapter/无投影刷新」，与深读形态不匹配故偏离；而 daily-digest-queue 本就是 adapter 驱动 + coverageDate 键 + append 后 refresh 投影，与研判形态完全一致，epic 字面与形态对齐，故遵循字面、不开新队列（ponytail：最少文件）。
- **为什么双 adapter 而非扩 `DigestAdapter`：** epic-5-context :108「三者共用端口」——reason/deepread/trendbriefing 共用 `LLMAdapter`。研判虽落 digest 模块，但其生成端口是 explanation 模块的 `LLMAdapter`（跨模块端口类型依赖，非聚合写依赖，不违 AD-2；digest 模块已跨模块 import publish-orchestrator 的 `listPublishedHotEvents`）。digest 模块的 `DigestAdapter.fetchConclusions` 是日报条目级 conclusion 端口，语义不同于跨事件研判，不合流。
- **6 类黑名单 + 上限复用：** `passesRecommendationGuardrail`（5.1 导出、5.2 已复用）承载 PRD §10 通用六类，研判同用；`TREND_BRIEFING_MAX_LENGTH=200` 字（码点）为 story-time 默认（PRD SM-C3 仅述「研判有上限」未给数；一段跨事件研判 200 字合理，可一行调整），fail-fast 违例→抛错→缺失态，对齐 5.1(40)/5.2(120) 先例。
- **`source` 用 ExplanationSource.Ai 不改 DigestSource：** `DigestSource` 仅 `Template`（无 Ai 变体）；研判是 AI 内容，复用已存在的 `ExplanationSource.Ai`（与 reason/deepread 一致），列保持 String，不为单一值扩枚举（避免 churn digest 模块）。
- **缺失态：** 日报页研判缺失渲染显式「AI 趋势研判生成中。」（muted），对齐 5.2「AI 深读生成中。」与既有「日报生成中。」模式；V1 prod 每个日报页均显示此态（honest degradation，待真实 provider 接入）。
- **延后（归 deferred-work.md 既有 pipeline 编排项）：** 真实 LLM provider 接入、retry 循环、worker 自动调度/cron、主题页研判（5.3b）、运营复核台研判筛选/重生（5.4）。

## Verification

**Commands:**
- `pnpm --filter @aguhot/core db:migrate -- --name add_trend_briefing` -- 迁移生成并应用成功（`trend_briefings` + `published_trend_briefings` + 索引创建，无 FK）。
- `pnpm typecheck` -- 全仓类型检查通过（含端口第三法、新 service、sibling 投影、日报页类型、verify-reason/deepread 内联 adapter 补齐）。
- `pnpm lint` -- 通过。
- `pnpm --filter @aguhot/worker verify:trendbriefing`（或 `tsx apps/worker/src/verify-trendbriefing.ts`） -- Stub 链路全绿：行写入、basedOnHotEventIds、投影非空、公开读查询 `getPublishedTrendBriefing` 装配、AD-5 append-only、self-heal 投影、adapter-undefined 不写库、六类黑名单/超长/空 fail-fast、边界 200 接受/201 拒绝、无当日事件→null。
- `pnpm --filter @aguhot/worker verify:reason` 与 `verify:deepread` -- 端口扩展无回归（内联 adapter 补 stub 后仍全绿）。

**Manual checks (if no CLI):**
- 确认 `apps/worker` 源码 grep 不到 `StubLlmAdapter` import（TEST-ONLY 隔离）。
- 确认 `package.json` 无新增 LLM SDK 依赖；`DigestSource` 枚举未改。
- 确认日报页研判段视觉权重 ≤ 事实条目，`AiLabel` 紧邻；缺失态正确渲染。

## Auto Run Result

Status: done

**实现摘要：** 落地 Story 5.3「日报页 AI 趋势研判」——在 5.1/5.2 的 `LLMAdapter` 端口上加第三个方法 `generateTrendBriefing`（epic-5-context :108「三者共用端口」）；新增 `TrendBriefing` coverageDate 键 append-only 真相表（source/modelId/promptVersion/createdAt + data-only `basedOnHotEventIds` Json，NFR-7 溯源，AD-5，**无 FK 到 hot_events**——日报模块不变量）+ `published_trend_briefings` 投影表（coverageDate @id）；digest 模块 `trend-briefing-service`（`adapter===undefined`→null 不写库；复用 `listPublishedHotEvents`+`filterByCoverageDay` 发现当日事件、取 title/summary grounding、top-12 bound；6 类黑名单 + 200 字码点 fail-fast）；sibling `refreshPublishedTrendBriefing`（镜像 `refreshPublishedDailyDigest`）+ `getPublishedTrendBriefing` 读查询；扩展 `daily-digest-queue` worker 为双 adapter 注入（V1 均 undefined→短路 honest degradation），研判挂日报 job（epic 字面）；日报页 `<DigestContent>` 内 `<dl>` 与 `<ol>` 间渲染研判段 + `AiLabel`，缺失态「AI 趋势研判生成中。」。V1 用 Stub 跑通，真实 provider 注入点留好但不接入，不新增 LLM SDK 依赖、不改 `DigestSource` 枚举。

**改动文件：**
- `packages/core/prisma/schema.prisma`（+ `TrendBriefing` + `PublishedTrendBriefing`，无 FK、无 HotEvent 反向关系，72 行新增、无无关 churn）
- `packages/core/prisma/migrations/20260712000002_add_trend_briefing/migration.sql`（两表 + 索引，无 FK）
- `packages/core/src/modules/explanation/types.ts`（`LLMAdapter.generateTrendBriefing` + `LlmTrendBriefingArgs/Result`）
- `packages/core/src/modules/explanation/stub-llm-adapter.ts`（`STUB_TREND_BRIEFING` + `generateTrendBriefing`）
- `packages/core/src/modules/digest/trend-briefing-service.ts`（生成链 + 校验，新文件）
- `packages/core/src/modules/digest/index.ts` / `packages/core/src/modules/explanation/index.ts` / `packages/core/src/index.ts`（barrel 导出）
- `packages/core/src/modules/publish-orchestrator/publish-service.ts`（sibling `refreshPublishedTrendBriefing` + `getPublishedTrendBriefing`）
- `packages/core/src/modules/publish-orchestrator/types.ts` / `index.ts`（`PublishedTrendBriefing` 契约 + barrel）
- `apps/worker/src/queues/daily-digest-queue.ts`（双 adapter handler，研判挂日报 job）
- `apps/worker/src/verify-trendbriefing.ts`（Stub 驱动 verify，25 断言，新文件）
- `apps/worker/src/verify-reason.ts` / `verify-deepread.ts`（端口加第三法 fallout：内联 LLMAdapter 补 `generateTrendBriefing: () => null`）
- `apps/worker/package.json`（`verify:trendbriefing` 脚本）
- `apps/web/app/(public)/daily/page.tsx`（`<DigestContent>` 内研判子区块 + 缺失态）

**Review 结果：** 4 层并行 review（blind-hunter / edge-case-hunter / verification-gap / intent-alignment）。无 intent_gap、无 bad_spec。应用 2 个 patch（verify-trendbriefing 补 `refreshPublishedTrendBriefing` 空真相行→deleteMany 清投影的 stale-clear 分支断言，对齐 sibling verify-digest #10 + 5.2 takedown 真相存活先例；合并 trend-briefing-service 重复 `import type`）。defer 4 项（worker 共享 try/catch 部分-成功上报、render-gating 解耦、loadEventContext N+1→batch、6 类黑名单 false-positive 第 3 消费者——均 post-V1 / 已登记同类）。reject 18 项（basedOnHotEventIds 全量=spec 定义、共享 try/catch AC 满足、无 CHECK/无上限=对齐既有 AI 表、traceId 未用=镜像 sibling、test-internal 重复、NaN/归一化/evidenceCount=0/并发 refresh=benign 或既定模式，等）。

**Follow-up review 建议：** false —— 最终 pass 的改动局部（verify +1 断言、service import 合并），无 API/数据模型/架构/行为变更；2 个 patch 全部 typecheck/verify 覆盖。

**Verification 执行：**
- `pnpm typecheck`（全 5 包）→ 绿
- `pnpm --filter @aguhot/core db:migrate -- --name add_trend_briefing` → 迁移生成并应用（`trend_briefings` + `published_trend_briefings` + 索引，无 FK）
- `pnpm --filter @aguhot/worker verify:trendbriefing` → **PASS 25/25**（行写入、basedOnHotEventIds、投影非空、公开读查询 `getPublishedTrendBriefing` 装配、AD-5 append-only、self-heal 投影、stale-clear deleteMany 分支、adapter-undefined 不写库、6 类黑名单/超长/空 fail-fast、边界 200 接受/201 拒绝、无当日事件→null）
- `pnpm --filter @aguhot/worker verify:reason` → **PASS 22/22**（端口扩展无回归）
- `pnpm --filter @aguhot/worker verify:deepread` → **PASS 26/26**（端口扩展无回归）
- `pnpm --filter @aguhot/worker verify:digest` → **PASS 26/26**（worker 双 adapter 无回归）
- grep 确认 `apps/worker` 运行时不 import `StubLlmAdapter`；`package.json` 无 LLM SDK 依赖；`DigestSource` 枚举未改

**Residual risks / artifacts：**
- V1 prod 因 worker 解析 `digestAdapter = undefined` + `llmAdapter = undefined`，AI 研判覆盖率为 0%（每个日报页显示「AI 趋势研判生成中。」honest degradation，待真实 provider 接入；epic AC 明示，对齐 5.1/5.2）。
- `verify:trendbriefing` / `verify:reason` / `verify:deepread` / `verify:digest` 需本地 PG（`aguhot_dev`）+ core `dist/` 重建后 worker 方见新导出。
- 本 story 迁移已应用到 `aguhot` 与 `aguhot_dev` 两库（`aguhot_dev` 此前落后于 5.3 迁移，已补应用）。
- `_bmad-output/implementation-artifacts/.review-diff-5-3.patch` 为本次 review 快照（随 story 提交，对齐 5.1/5.2 惯例）。
