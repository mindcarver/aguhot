---
title: '结构化日报生成与阅读 (2.4)'
type: 'feature'
created: '2026-07-11'
status: 'done'
baseline_revision: '57e020486f10e898f2dc365055acb70dcd9f8006'
final_revision: '455ded02dddb49525f836ab11fca3ba0f7252976'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-3-theme-page-continuity-tracking.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-1-market-reaction-signal-generation-and-display.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-8-hot-event-detail-and-evidence-timeline.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-aguhot-2026-07-09/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Epic 2 的「日报」入口在 Story 1.2 落地为 `/daily` **静态占位页**（`日报为结构性占位页…`），主图 nav「日报」指向死页面、违反闭环；epic-2-context 明列的三 Epic-2 BullMQ job 类目之一 **daily digest**（另两个为 2.1 market-signal、2.3 theme-backfill）尚未建：无 `DAILY_DIGEST ||--o{ HOT_EVENT` 写表、无 `published_daily_digest` 读模型、无 digest worker、无 digest core 模块、`/daily` 不读任何发布态读模型。FR10（用户查看一个交易日的结构化日报并跳转详情）完全未落地。

**Approach:** 在 `packages/core/src/modules/digest/` 新建日报子域，**镜像 2.1/2.3 的端到端形态**（ponytail：同一套端口/桩/服务/写表/读模型/页/降级，避免再造异形抽象）：`DigestAdapter` 端口（AD-7，日报结论知识源经端口接入，V1 无 LLM/SDK）+ `StubDigestAdapter`（确定性测试双桩，**仅 verify/e2e 用**）+ `generateDailyDigest`（按 `coverageDate` 选当日已发布事件→adapter 派生每条「简要结论」→校验非空+非投资建议→append 一行 `daily_digest` 写表；adapter 缺失/返回 null/空→返回 null、不写，诚实降级；当日无已发布事件→返回 null）。复用 `publish-orchestrator`（AD-3 公开读模型唯一拥有者）新增 **`refreshPublishedDailyDigest`**——日报聚合按 `coverageDate` 而非 `hotEventId` 键控，故它是 `refreshPublishedReadModel` 的**兄弟函数**（非新分支）：读最新 `daily_digest` 行→upsert `published_daily_digest`，无则 deleteMany。新增 `getPublishedDailyDigest`（按 coverageDate 读）+ `listPublishedDailyDigestCoverageDates`（distinct coverageDate desc，供 `/daily` 选最新日）。新增 `daily-digest` BullMQ worker（**镜像 2-1 `market-reaction-queue.ts`**：lazy Queue + `enqueueDailyDigest(traceId,coverageDate)` + `registerDailyDigestWorker`，adapter resolve undefined→诚实 `{generated:0,skipped}`，stub 绝不被 worker import）。Web 落地：替换 `/daily` 占位页为动态页（默认显示最新已生成日报、支持 `?date=YYYY-MM-DD` 选日；显覆盖日期+生成时间+`<AiLabel>`；每条事件为可点击链 `/events/{hotEventId}` 即 FR10；无日报→显当前覆盖范围+处理中状态、不空白即 AC3）。新增 `verify:digest`（worker，直调 stub）与 `@daily` e2e（独立 seed：产 ≥2 已发布共享同 coverageDate + 生成日报；验证日报页渲染、daily→detail 跳转、无日报降级、不回归）。不做 2.5 跨页返回路径上下文恢复（归 2.5）、不做 cron 自动编排/job 链、不接真实 LLM、不做日报编辑/版本对比/邮件推送——均记 defer。

## Boundaries & Constraints

**Always:**
- 公开站只读发布态读模型（AD-3）：`/daily` 页只经 `getPublishedDailyDigest`/`listPublishedDailyDigestCoverageDates`/`listPublishedHotEvents` 读 `published_daily_digest`（+ 既有 `published_hot_events` summary），绝不读 `daily_digest`/`hot_events`/`evidence_*`。`published_daily_digest` 由 `publish-orchestrator` 投影（epic-2-context「daily page reads only published_* generated/refreshed by publish-orchestrator」），**非** digest 模块直写。行存在=该 coverageDate 当前已发布日报（无 status 列、无 WHERE 可遗忘，沿用 1-6~2-3 读模型契约）。
- 写归属（AD-2 单一写拥有者）：`digest` 模块仅拥有 `daily_digest`（append-only 写表，一次生成一行，永不 update/delete 旧行）；`publish-orchestrator` 拥有 `published_daily_digest` 投影。digest 模块**绝不**写 `hot_events`/`published_*`/`evidence_*`/`market_reaction_*`/`event_association_*`/`event_theme_*`。日报的「事件成员身份 + 结论」归 digest 模块。
- 非建议性 + 诚实（AC2/NFR，沿用 1-8/2-1/2-2/2-3 `noInvestAdvice`）：每条 `DailyDigestEntry.conclusion` 必须非空、且**绝不**含买卖/目标价/持仓/增持减持/建议买/建议卖关键词；adapter 返回的结论命中关键词→`generateDailyDigest` 抛错（**不** silently 截断/改写）。日报标题/文案只描述「当日要点复盘」，无投资建议措辞。日报内容带统一 `<AiLabel>`（UX-DR8）。`verify:digest` 断言每条 conclusion 非空 + 无投资建议关键词。
- adapter 端口（AD-7）：日报结论知识源（LLM/摘要模型）仅经 `DigestAdapter` 接口进入；domain 不依赖第三方 SDK（V1 无 SDK）。`generateDailyDigest({prisma,traceId,coverageDate,adapter?})`——`adapter` 缺失/返回 null/返回 `[]`→返回 null、不写 set（诚实降级，非造假）。
- append-only（AD-5 风格）：`DailyDigest` 永不 update/delete，每次生成 append 一行；公开投影取该 coverageDate 最新一行（`createdAt` desc、`id` desc tiebreaker——UUIDv7 单调，沿用 1-8/2-1/2-3 修复）。多次生成追加多行版本（公开取最新）；V1 无自动触发（verify/seed 显式调 + worker 按 coverageDate 回填），cron/编排 defer。
- 日报成员关系诚实（epic-2-context）：当日无已发布事件→不生成日报（返回 null、不写空日报）；adapter 不可得→不生成；`/daily` 无任何已生成日报→显降级文案 + 当前覆盖范围（当日已发布事件数），**不**留空白页、**不**造假日报（AC3）。
- daily→detail 跳转明确且非死链（AC2/FR10）：日报每条事件为可点击链 `/events/{hotEventId}`；目标 id 已发布则 200，否则 `notFound()`（AD-8 不泄漏）。日报为时间点制品（versioned）——已生成日报内某事件随后被 takedown 时，该链诚实 404（AD-8），日报不自动重算（重算 append 新行自然剔除，staleness 窗口记 defer）。
- `daily-digest` worker 诚实（镜像 2-1/2-3）：worker resolve `adapter = undefined`（V1 无真实 LLM）→ 当日 eligible（已发布）事件 `generateDailyDigest` 返回 null → `{generated:0, considered, skipped}`，**不**造假结论。`StubDigestAdapter` 是 TEST-ONLY，`apps/worker` **绝不** import 它（与 2-1/2-2/2-3 stub 惯例一致）；真实 LLM 落地时只换 adapter 装配。
- `next build` 保持无 `DATABASE_URL`（1-6~2-3 build 不变量延续）：`/daily` `force-dynamic`，不改既有路由动态性；`(public)/layout.tsx`、`public-nav.tsx` 及静态公共页（`design`/`favorites`）仍不 import `@aguhot/core`（nav「日报」入口 1.2 已指向 `/daily`，仅需把占位页换动态）。
- token 安全：日报页用**真实解析** token（`bg-surface-raised`/`bg-surface-base`/`border-border-hairline`/`ink-*`），事件项复用既有 `<Link>` 卡片形态（1.7/2.3 event-card 同形）；日报页标题用编辑级衬线 `font-display`（UX 主题/section/日报标题惯例）；系统派生日报内容带统一 `<AiLabel>`（UX-DR8）。
- 不变性约定（沿用 1-4~2-3）：状态/种类用 `const … as const` + union（禁 TS `enum`，`erasableSyntaxOnly`）；`import type` 用于类型；相对导入带 `.js`；camelCase 字段 `@map("snake_case")`；每调带 `traceId`；时间 UTC、展示 ISO 8601/稳定格式；PK UUIDv7（`newTraceId()`）；entries 用 Prisma `Json` 列存 `DailyDigestEntry[]`（变量基数结构，display-only，不做规范化子表/事件目录表——ponytail，沿用 2.2/2.3 items Json 决策）。

**Block If:**
- 本地 PG `aguhot_dev` 不可达（迁移应用、`verify:digest` 或 `@daily` e2e seed 连接失败）→ HALT，不得跳过集成/e2e 验证。
- 新增模型/模块致 `pnpm -r typecheck`/`lint` 回归 → HALT。
- `pnpm --filter web build`（无 `DATABASE_URL`）失败 → HALT。

**Never:**
- 不接真实 LLM / 摘要模型 / 知识库（无 API key/SDK/网络调用；V1 `StubDigestAdapter` 纯确定性 fixture，**且仅 verify/e2e 用、不在 worker/prod 接线**——fixture 结论上公开页而无真实生成依据会误导读者，违反 NFR「absence as absence」）。具体 LLM provider 采购 defer。
- 不做 worker cron / 自动编排 / publish→digest 自动触发 / job 链式 / 「每日定点自动跑」（沿用 2-1/2-3「workers 独立、解耦、不自动链」不变量；worker 文件 + 注册是本 story 交付物，运行时由 verify 直调 core 验证逻辑、worker 运行时实测 defer）。`daily-digest` worker 在 prod 仅占位（adapter 缺失→skip），真实触发/cron defer。
- 不做日报编辑 / 版本对比 / 回滚 / 多版本展示（V1 日报只追加，append-only set 取最新；编辑 UI、版本 diff defer）。不做日报邮件推送 / 订阅 / Webhook（defer）。
- 不做 2.5 跨页返回路径上下文恢复（scroll 位 / filter 态 / 阅读上下文，UX-DR12 完整恢复归 2.5；本 story 仅做基本导航：daily→detail 链 + 日报页「← 返回首页」链 + 浏览器原生 back，深度上限一层）。不做日报内事件「展开全文」/ 分页 / 排序 toggle（V1 单页全量按证据数降序，分页/sort defer）。
- 不做 WebSocket/SSE 日报生成进度实时推送（V1 靠读模型刷新 + 主动刷新，epic defer）。不做「历史相似日报」相似度判断（defer）。
- 不做日报事件规范化目录表 / 日报成员规范化子表（沿用 2.2/2.3 items Json 决策：事件成员身份 hotEventId+title+conclusion 存 per-日报 Json，不为尚不存在的 SQL 单日报查询预建表——ponytail）。
- 不在公开日报读 `daily_digest`/`hot_events` 绕过读模型；不让既有公共页（`design`/`favorites`）新 import `@aguhot/core`；不改 1-6~2-3 既有 verify/seed/spec 断言（console/feed/detail/revision/merge-split/market-reaction/associations/themes seed/spec 零改动保持绿；新表无 FK 到 hot_events→既有 reset 不需扩，仅在新增 verify/seed 内置清表）；不改 `listPublishedHotEvents`/`listPublishedAssociations`/`listPublishedThemeMemberships` 签名（日报当日事件过滤在 digest 服务层 JS，沿用 1-7/2.2/2.3 window/association JS 过滤模式）；不改 `(public)/layout.tsx`/`public-nav.tsx`（「日报」入口已指向 `/daily`，仅需把占位页换动态）。
- 不渲染投资建议措辞（无买卖/目标价/持仓，NFR）；不新增 `LLMAdapter`/`ThemeAdapter`/`MarketDataAdapter`/`AssociationAdapter` 之外的新端口别名；不改 `packages/config/src/env.ts`（V1 无 LLM env，adapter defer）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 当日有已发布事件+adapter 可得→生成+投影（AC1/AC2） | 某 coverageDate 有 ≥1 已发布事件、`adapter` 返回非空 `DigestConclusion[]`（每项 hotEventId 命中 eligible + conclusion 非空无建议词），`generateDailyDigest` | append 一行 `daily_digest`（items 含 eligible 全集、每项 hotEventId/title/conclusion/latestEvidenceAt/evidenceCount、`source="template"`、`traceId`）；随后 `refreshPublishedDailyDigest` upsert `published_daily_digest`；`getPublishedDailyDigest` 返回非 null（entries） | 无错误预期 |
| 日报页渲染最新日报 + daily→detail 跳转（AC2/FR10） | 已生成日报（coverageDate=D）、`GET /daily`（无 date 参） | `/daily` 200、编辑级衬线标题显「日报」+ 覆盖日期 D + 生成时间（稳定格式）+ `<AiLabel>`、entries 按证据数降序呈现、每条为可点击链 `/events/{hotEventId}`；点链到达详情页 200 | 无错误预期 |
| 选日查看（AC2） | 已生成多日日报、`GET /daily?date=YYYY-MM-DD` | 渲染该 date 的日报（若存在）；date 非法/格式错→忽略参、回退最新 | 无错误预期 |
| 日报未生成→降级不空白（AC3） | 该 coverageDate 无 `published_daily_digest`（未生成/adapter 不可得）但当日有已发布事件，`GET /daily?date=D` 或 `GET /daily`（无任何日报） | 显降级文案「该覆盖日期的日报尚未生成。」+「当前覆盖范围：{D} 已发布 {N} 条热点事件，日报生成中。」；**不**留空白、**不**造假日报 | 无错误预期 |
| 当日无任何已发布事件→不生成（NFR 不造假） | coverageDate 的 eligible（已发布 + latestEvidenceAt UTC 日 = D）为空，`generateDailyDigest` | 返回 null、**不** append 任何 `daily_digest` 行（无事件→不生成空日报） | 无错误预期 |
| adapter 缺失/空→不写（NFR 不造假） | `generateDailyDigest({adapter:undefined})` / adapter 返回 null / 返回 `[]` | 返回 null、**不** append 任何 `daily_digest` 行（无数据→不生成→降级） | 无错误预期 |
| 缺结论/含投资建议词→拒写（AC2 强制） | adapter 返回项 conclusion 空 或 命中建议关键词 / hotEventId 非 eligible | `generateDailyDigest` 抛错（不 silently 截断/改写）、不 append | 显式错误（非法 adapter 输出） |
| append-only + 投影取最新（AD-5） | 同 coverageDate 已有 ≥1 行，再次 `generateDailyDigest` | append 新行（旧行不 update/delete）；`refresh` 后 `published_daily_digest.generatedAt` = 最新行 `createdAt`、items = 最新行 items | 无错误预期 |
| daily-digest worker 诚实（镜像 2-1/2-3） | worker 运行、adapter resolve undefined（V1 prod） | eligible（当日已发布）事件 `generateDailyDigest` 返回 null → `{generated:0, considered, skipped}`、不 append、不投影 | 无错误预期 |
| 已生成日报内事件被 takedown→链诚实 404 | 日报已含事件 X、X 随后被 `decideReview(takedown)` | 日报读模型不自动重算（versioned 制品）；`/events/{X}` 返回 404（AD-8 不泄漏）；重算 append 新行剔除 X | 无错误预期 |
| 未发布/未知 id 不泄漏（AD-8） | daily→detail 链目标 id 未发布/未知，`GET /events/{id}` | `getPublishedHotEventDetail` 返回 null→`notFound()`（404） | 404 |
| 运行时无 DB | 请求期 `DATABASE_URL` 缺失/PG 不可达 | `getPrisma()` 显式抛错；`next build`（无 DB）仍成功 | 显式错误 |

</intent-contract>

## Code Map

- `packages/core/prisma/schema.prisma` -- MODIFY：新增 2 模型。`DailyDigest`（id UUIDv7 PK, coverageDate `DateTime` `@map("coverage_date")`, items `Json`（存 `DailyDigestEntry[]`）, source String, traceId String?, createdAt；`@@index([coverageDate])` `@@index([createdAt])` `@@map("daily_digests")`；**无 FK 到 hot_events**——日报成员 hotEventId 为 data-only 外键式链接，沿用 epic「cross-page navigation is not a module」决策）。`PublishedDailyDigest`（coverageDate `DateTime` PK `@map("coverage_date")`, items `Json`, source `@map("source")`, generatedAt `@map("generated_at")`, traceId String?, updatedAt `@updatedAt` `@@map("published_daily_digests")`）。不新增 HotEvent 反向导航（日报非 hotEvent 拥有的子聚合）
- `packages/core/prisma/migrations/<ts>_daily_digest_read_models/migration.sql` -- NEW：`pnpm --filter core db:migrate -- --name daily_digest_read_models` 生成（2 张新表 + 索引；无 FK）
- `packages/core/src/modules/digest/types.ts` -- NEW：`DailyDigestEntry`（{hotEventId: string; title: string; conclusion: string; latestEvidenceAt: string(ISO); evidenceCount: number}——非空结论+事件身份）、`DigestConclusion`（adapter 返回单元 {hotEventId: string; conclusion: string}）、`DigestSource`（template const，未来 llm/provider id）、`DigestAdapter`（端口 interface `fetchConclusions({coverageDate, hotEventIds}): Promise<DigestConclusion[] | null>`，镜像 `ThemeAdapter`/`AssociationAdapter`）、`GenerateDailyDigestOptions`({prisma,traceId,coverageDate:Date,adapter?})、`GenerateDailyDigestResult`、`GetLatestDigestOptions`、`DigestRecord`。`PrismaClient` 从 `../../../generated/client.js` 导入；`PublishedHotEventSummary` 从 `../../publish-orchestrator/types.js` 导入（eligible 选取用）
- `packages/core/src/modules/digest/digest-adapter.ts` -- NEW：`DigestAdapter` 端口 interface（镜像 `theme-adapter.ts` 注释风格：domain 依赖端口、concrete adapter 在 worker/assembly 层解析、provider swap 不动 domain；V1 无 SDK）。类型从 `./types.js` 导入，`export type { DigestAdapter } from "./types.js"`
- `packages/core/src/modules/digest/stub-digest-adapter.ts` -- NEW：`StubDigestAdapter implements DigestAdapter`——确定性 fixture（`fetchConclusions` 对每个传入 hotEventId 返回固定非空 conclusion，如「当日重点事件，证据链已归档。」，无投资建议词）。导出 `STUB_DIGEST_CONCLUSION = "当日重点事件，证据链已归档。"` 供 seed/spec 断言复用。**仅 verify/e2e 消费**，头注释标明「TEST-ONLY: not wired in worker/prod; real LLM summarizer/provider deferred」
- `packages/core/src/modules/digest/digest-service.ts` -- NEW：`generateDailyDigest({prisma,traceId,coverageDate,adapter?})`。步骤：(1) 经 `listPublishedHotEvents({prisma,traceId})` 读全量 published summary，JS 过滤 `latestEvidenceAt` UTC 日 = coverageDate UTC 日→`eligible: PublishedHotEventSummary[]`（当日已发布事件，沿用 1-7/2.2/2.3 JS 过滤模式，不改 `listPublishedHotEvents` 签名）；(2) eligible 空→返回 null（无事件→不生成）；(3) adapter 缺失→null；`fetchConclusions({coverageDate, hotEventIds: eligible.map(id)})` 返回 null/`[]`→null、不写；(4) 校验：每项 conclusion 非空、hotEventId ∈ eligible、`noInvestAdvice(conclusion)`（命中买入/卖出/目标价/持仓/增持/减持/建议买/建议卖→抛错，AC2 fail-fast）；(5) 组装 `DailyDigestEntry[]`（按 evidenceCount desc 排序，稳定；title/latestEvidenceAt/evidenceCount 取自 eligible summary，conclusion 取自 adapter）；(6) append 一行 `daily_digest`，items=Json，source="template"，每次 append、永不 update/delete。`getLatestDigest({prisma,traceId,coverageDate})`（同 coverageDate 取 createdAt desc、id desc 首条，无则 null）。`noInvestAdvice` 为纯函数（同输入→同输出）。镜像 `theme-service.ts`/`association-service.ts` 结构
- `packages/core/src/modules/digest/index.ts` -- NEW：桶导出 `generateDailyDigest`/`getLatestDigest`/`StubDigestAdapter`/`STUB_DIGEST_CONCLUSION` + const `DigestSource` + 类型 `DailyDigestEntry`/`DigestConclusion`/`DigestAdapter`/option/result（沿用 barrel 的 `as FooType` 别名惯例）
- `packages/core/src/index.ts` -- MODIFY：桶追加 digest 组（`generateDailyDigest`/`getLatestDigest`/`StubDigestAdapter`/const+类型）+ 从 publish-orchestrator 追加导出 `refreshPublishedDailyDigest`/`getPublishedDailyDigest`/`listPublishedDailyDigestCoverageDates`/`PublishedDailyDigest`/`DailyDigestEntry`/`DigestCoverageDateRow`
- `packages/core/src/modules/publish-orchestrator/publish-service.ts` -- MODIFY：新增 `refreshPublishedDailyDigest({prisma,traceId,coverageDate})`（**兄弟函数**，非 `refreshPublishedReadModel` 分支——日报聚合按 coverageDate 键控非 hotEventId：读最新 `DailyDigest`（coverageDate 匹配、createdAt desc id desc）→有则 upsert `published_daily_digest`（items Json）、无则 deleteMany，镜像 `projectThemes` 的 read→upsert/deleteMany 形态但独立函数）。新增 `getPublishedDailyDigest({prisma,traceId,coverageDate})`（`publishedDailyDigest.findUnique({where:{coverageDate}})`，无则 null）。新增 `listPublishedDailyDigestCoverageDates({prisma,traceId})`（`publishedDailyDigest.findMany({select:{coverageDate:true}, orderBy:{coverageDate:"desc"}})`，返回 distinct coverageDate desc 数组，供 `/daily` 选最新日）。既有 `refreshPublishedReadModel`/`getPublishedHotEventDetail`/其他 list **零改动**——日报非 hotEvent 投影
- `packages/core/src/modules/publish-orchestrator/types.ts` -- MODIFY：加 `DailyDigestEntry`（{hotEventId,title,conclusion,latestEvidenceAt,generatedAt}——展示态；或从 digest 模块 re-export，沿用 2-3 `ThemeRef` 双定义惯例：publish-orchestrator 自持展示副本、digest 模块持写入副本）、`PublishedDailyDigest`（{coverageDate: Date; entries: DailyDigestEntry[]; source: string; generatedAt: Date}）、`DigestCoverageDateRow`（{coverageDate: Date}）、`RefreshPublishedDailyDigestOptions`({prisma,traceId,coverageDate})、`GetPublishedDailyDigestOptions`({prisma,traceId,coverageDate})、`ListPublishedDailyDigestCoverageDatesOptions`({prisma,traceId})
- `packages/core/src/modules/publish-orchestrator/index.ts` -- MODIFY：桶追加导出 `refreshPublishedDailyDigest`/`getPublishedDailyDigest`/`listPublishedDailyDigestCoverageDates` + 类型 `PublishedDailyDigest`/`DailyDigestEntry`/`DigestCoverageDateRow`
- `apps/worker/src/queues/daily-digest-queue.ts` -- NEW：**镜像 `market-reaction-queue.ts`/`theme-backfill-queue.ts`**。`export const DAILY_DIGEST_QUEUE_NAME = "daily-digest"`、`DAILY_DIGEST_JOB_NAME = "daily-digest"`、`DailyDigestJobData { traceId: string; coverageDate: string }`（ISO YYYY-MM-DD，序列化安全）；lazy `Queue` 单例 `getDailyDigestQueue()`；`enqueueDailyDigest(traceId, coverageDate)`（removeOnComplete 100 / removeOnFail 500）；`registerDailyDigestWorker()`：dynamic `import("@aguhot/core")` 取 `getPrisma`/`generateDailyDigest`/`refreshPublishedDailyDigest`，解析 `coverageDate = new Date(data.coverageDate)`，eligible 计数 = 当日已发布事件数（同 digest 服务过滤逻辑或直接调 `generateDailyDigest({adapter:undefined})`→null→skip），result!==null 则 `refreshPublishedDailyDigest({coverageDate})`、`generated++`，per-job try/catch，return `{generated, considered}`。**绝不 import `StubDigestAdapter`**（头注释标 V1 adapter 缺失→generated:0 的诚实下限）
- `apps/worker/src/index.ts` -- MODIFY：import `registerDailyDigestWorker`、`const dailyDigestWorker = registerDailyDigestWorker()`、并入 `Promise.all([…, dailyDigestWorker.close()])` 优雅关闭；头注释「五 worker」改为「六 worker」并保留「独立、解耦、不自动链」不变量表述；console.log 串追加 `+ daily-digest`
- `apps/worker/src/verify-digest.ts` -- NEW：镜像 `verify-themes.ts`（resetEnvCache→requireEnv DATABASE_URL→getPrisma→resetState 清表序：顶部追加 `publishedDailyDigest.deleteMany`+`dailyDigest.deleteMany`，再接既有 16 表；新表无 FK→独立清）。seed source+records→clusterEvents→`generateExplanation`→`decideReview(approve)` 产 ≥2 已发布事件（latestEvidenceAt 落当日 UTC）→`generateDailyDigest({coverageDate: todayUTC, adapter:new StubDigestAdapter()})`→`refreshPublishedDailyDigest({coverageDate: todayUTC})`；断言：set append（items ≥1 项、每项 hotEventId/title/conclusion 非空、conclusion=STUB_DIGEST_CONCLUSION、`source=template`、traceId）、`getPublishedDailyDigest` 非 null（entries）、`listPublishedDailyDigestCoverageDates` 含该日、append-only（二次 generate append 第二行、旧行不动、refresh 后投影 generatedAt=最新、items=最新）、当日无已发布事件→返回 null 不写（用独立 clean 子流程：另取一日/过滤为空验证）、adapter 缺失/返回 null/`[]`→返回 null 不写、缺 conclusion/含建议词项→抛错（AC2）、NFR 无投资建议关键词、`refreshPublishedDailyDigest` 无 set 时 deleteMany no-op；打印 PASS。无需 Redis（直调 core）
- `apps/worker/src/verify-publish.ts` / `verify-market-reaction.ts` / `verify-associations.ts` / `verify-themes.ts` -- MODIFY（最小，沿用 2-1/2-2/2-3 惯例）：优先不动；新表无 FK 到 hot_events→既有 `hotEvent.deleteMany` 不受影响，预期不需扩 resetState；仅当 typecheck/runtime 因新表报错才在各自 resetState 清表序顶部追加 `publishedDailyDigest.deleteMany` + `dailyDigest.deleteMany`（独立、无 FK 序约束）
- `apps/worker/package.json` -- MODIFY：加 `verify:digest`（`tsx src/verify-digest.ts`）
- `apps/web/app/(public)/daily/page.tsx` -- MODIFY（替换 1.2 静态占位）：改为 `force-dynamic`、`import { getPrisma, getPublishedDailyDigest, listPublishedDailyDigestCoverageDates, listPublishedHotEvents, newTraceId } from "@aguhot/core"`、`export const dynamic = "force-dynamic"`。`PageProps { searchParams: Promise<{ date?: string }> }`（Next 16 async）；`await searchParams` 取 date（非法/格式错→忽略）。解析 targetCoverageDate：合法 date 参→该日；否则 `listPublishedDailyDigestCoverageDates` 取首个（最新）或无则 undefined。调 `getPublishedDailyDigest({coverageDate})`：非 null→渲染编辑级衬线标题「日报」+ 覆盖日期（稳定格式）+ 生成时间（generatedAt 稳定格式）+ `<AiLabel/>`、entries 按 evidenceCount desc `<ol>`、每条为 `<Link href={\`/events/${hotEventId}\`}>` 显 title + conclusion + meta（latestEvidenceAt/evidenceCount）；null→降级文案「该覆盖日期的日报尚未生成。」+「当前覆盖范围：{date 或 今日} 已发布 {N} 条热点事件，日报生成中。」（N 由 `listPublishedHotEvents` JS 过滤该日 latestEvidenceAt 计数）。顶部「← 返回首页」链 `/`。`max-w-3xl px-6 py-12`，真实 token，无投资建议措辞
- `apps/web/e2e/seed-daily.ts` -- NEW：镜像 `seed-themes.ts`（resetEnvCache→requireEnv DATABASE_URL→getPrisma→清表 FK 序[顶部含新 2 表]→建 source+N records→clusterEvents→generateExplanation→`decideReview(approve)` 产 **≥2 已发布**事件（latestEvidenceAt 落当日 UTC）→计算 `coverageDate = 当日 UTC YYYY-MM-DD`→`generateDailyDigest({coverageDate, adapter:new StubDigestAdapter()})`（append set）→`refreshPublishedDailyDigest({coverageDate})`（投影）；另产场景见 seedDailyEmpty）；导出 `{ coverageDate, digestEntryIds: string[], digestTitles: string[], generatedAt }` 供 spec。`seedDailyEmpty()`（独立、末位 clean DB）：产 ≥1 已发布事件当日但**不**调 generateDailyDigest→验证降级；导出 `{ emptyCoverageDate, emptyEventCount }`。直接运行守卫（`import.meta.url === \`file://${process.argv[1]}\``）
- `apps/web/e2e/daily.spec.ts` -- NEW（describe 标题含 `@daily`，`test.describe.configure({mode:"serial"})` + beforeAll `seedDailyDigest()` 捕获 id）：断言 `GET /daily` 200、覆盖日期（`coverageDate`）可见、生成时间可见、`<AiLabel>` 可见、≥2 entries 按证据数序可见、每条为可点击链 `/events/{id}`（FR10）；点某条链→`/events/{id}` 200（daily→detail 闭环）；`GET /daily?date={coverageDate}` 200 渲染该日；`GET /daily?date=bogus` 200 回退最新不崩；末位 `seedDailyEmpty()` 后 `GET /daily` 200 显降级文案「日报尚未生成」+「已发布 N 条」不空白（AC3）；既有 detail/feed/themes 不回归
- `apps/web/package.json` -- MODIFY：加 `e2e:daily`（`playwright test --grep @daily`，spec beforeAll 自 seed）与 `seed:daily`（`tsx e2e/seed-daily.ts`）；**改 `e2e` 的 `--grep-invert` 追加 `@daily`**；既有 `e2e:console`/`e2e:feed`/`e2e:detail`/`e2e:market-reaction`/`e2e:associations`/`e2e:themes` 等不动
- `_bmad-output/implementation-artifacts/deferred-work.md` -- MODIFY：追加 2-4 defer（真实 LLM 摘要 provider+SDK、worker cron/自动编排/「每日定点」触发/job 链式、日报编辑/版本对比/回滚/多版本展示、日报邮件推送/订阅/Webhook、跨页返回路径 scroll/filter 上下文恢复归 2.5、日报内事件分页/sort toggle、日报生成进度 SSE/WS 实时推送、takedown 后日报 staleness 自动重算、日报 `published_daily_digest` 全表读 scale ceiling、Json items 列查询性上限、stub 仅测试非 prod 的诚实下限、worker 运行时未实测、历史相似日报相似度判断、当日事件归属用 latestEvidenceAt UTC 日而非真实交易历的 ceiling）

## Tasks & Acceptance

**Execution:**
- `packages/core/prisma/schema.prisma` + `migrations/<ts>_daily_digest_read_models` -- 加 2 模型（DailyDigest append-only + published_daily_digest 读模型，items Json，无 FK 到 hot_events）+ 迁移 -- AD-2 写归属 + AD-3 公开日报读模型落表（coverageDate 键控）
- `packages/core/src/modules/digest/{types.ts,digest-adapter.ts,stub-digest-adapter.ts,digest-service.ts,index.ts}` + `src/index.ts` 桶 -- `DigestAdapter` 端口 + `StubDigestAdapter`（测试双桩）+ `generateDailyDigest`/`getLatestDigest`（当日 eligible 选取+强制 conclusion 非空/无建议词+append-only）+ 类型 + 桶 -- digest 子域核心（verify/seed 直调 + worker 回填调）
- `packages/core/src/modules/publish-orchestrator/{publish-service.ts,types.ts,index.ts}` + `src/index.ts` 桶 -- 新 `refreshPublishedDailyDigest`（兄弟函数，coverageDate 键控投影）+ `getPublishedDailyDigest` 读 + `listPublishedDailyDigestCoverageDates` 查询 + `PublishedDailyDigest`/`DailyDigestEntry` 类型/桶 -- AD-3 公开日报读模型唯一拥有者投影 + 日报页数据源（既有 hotEvent 投影零改动）
- `apps/worker/src/queues/daily-digest-queue.ts` + `index.ts` 注册/关闭 -- `daily-digest` BullMQ worker（镜像 2-1/2-3：lazy Queue + enqueue(traceId,coverageDate) + register，adapter undefined→诚实 skip，stub 不 import） -- epic 列明 job 类目落地（第三 Epic-2 job）
- `apps/worker/src/verify-digest.ts` + `package.json:verify:digest` + `verify-publish/market-reaction/associations/themes`（仅必要时扩 reset，预期不需——新表无 FK） -- 确定性自检脚本（eligible 选取/items/conclusion 强制/append-only/投影取最新/当日无事件不写/adapter 缺失不写/缺字段或建议词抛错/listCoverageDates/NFR 无建议词） -- AC1/AC2/AC3 数据级验证；既有 verify 零回归
- `apps/web/app/(public)/daily/page.tsx` -- 替换 1.2 静态占位为动态日报页（最新日报 + ?date 选日 + 覆盖日期/生成时间/AiLabel + daily→detail 链 + 降级显覆盖范围不空白） -- AC2/AC3/FR10 surface（nav「日报」非死链）
- `apps/web/e2e/{seed-daily.ts,daily.spec.ts}` + `package.json:e2e:daily/seed:daily` + `e2e` grep-invert 加 @daily -- 独立 seed（≥2 已发布共享当日 + 生成日报；+ empty 场景）+ @daily e2e（日报渲染/daily→detail 跳转/?date 选日/降级不空白/不回归） -- AC1/AC2/AC3 surface-anchored 验证；既有 seed/spec 零改动
- `_bmad-output/implementation-artifacts/deferred-work.md` -- 追加 2-4 defer 项（LLM provider/SDK/worker-cron/编辑版本对比/邮件订阅/返回路径归 2.5/分页 sort/SSE/staleness 重算/scale ceiling/Json 查询性/stub 诚实下限/worker 运行时未测/相似度/交易历 ceiling） -- 诚实登记

**Acceptance Criteria:**
- Given 本地 PG 可达且 2-4 迁移已应用，When 经 clusterEvents→generateExplanation→decideReview(approve) 发布 ≥2 候选（latestEvidenceAt 落当日 UTC）后 `generateDailyDigest({coverageDate: 当日UTC, adapter:new StubDigestAdapter()})`→`refreshPublishedDailyDigest({coverageDate: 当日UTC})`，Then `daily_digest` append 一行（items 含 ≥1 项、每项 hotEventId/title/conclusion 非空、conclusion 无投资建议词、`source="template"`），And `published_daily_digest` 投影该最新行，And `getPublishedDailyDigest` 返回非 null 且仅 `SELECT published_*`（不触及 daily_digest/hot_events/evidence_*/associations/themes）。
- Given ≥1 已发布事件当日 + 已生成日报，When 匿名访问 `/daily`，Then 200、编辑级衬线标题显「日报」+ 覆盖日期 + 生成时间 + `<AiLabel>`，And entries 按证据数降序呈现，And 每条为可点击链 `/events/{hotEventId}`（FR10），And 点链到达 `/events/{id}` 200（非死链），And 无投资建议措辞。
- Given 已生成多日日报，When 访问 `/daily?date=YYYY-MM-DD`（合法），Then 渲染该 date 的日报；And `?date=bogus` 时 200 回退最新日报不崩。
- Given 该 coverageDate 无 `published_daily_digest`（未生成/adapter 不可得）但当日有已发布事件，When 访问 `/daily?date=D`（或无任何日报时 `/daily`），Then 显降级文案「该覆盖日期的日报尚未生成。」+「当前覆盖范围：{D} 已发布 {N} 条热点事件，日报生成中。」，And 不空白、不造假日报（AC3）。
- Given coverageDate 当日无任何已发布事件，When `generateDailyDigest`，Then 返回 null、不 append 任何 set 行（无事件→不生成空日报）。
- Given adapter 返回项 conclusion 空 或 命中投资建议关键词 或 hotEventId 非 eligible，When `generateDailyDigest`，Then 抛错、不 append（AC2 强制，不 silently 截断/改写）。
- Given `generateDailyDigest({adapter:undefined})` 或 adapter 返回 null/`[]`，When 调用，Then 返回 null、不 append 任何 set 行（无数据→不造假）。
- Given `DailyDigest` 已有 ≥1 行同 coverageDate，When 再次 `generateDailyDigest`，Then append 新行（旧行不 update/delete），And `refresh` 后投影 `generatedAt` = 最新行 `createdAt`、items = 最新行 items。
- Given `daily-digest` worker 运行且 adapter resolve 为 undefined（V1 prod 形态），When 处理当日 eligible（已发布）事件，Then `{generated:0, considered, skipped}`、不 append、不投影（诚实降级，镜像 2-1/2-3）。
- Given 日报已含事件 X 且 X 随后被 `decideReview(takedown)`，When 访问 `/events/{X}`，Then 404（AD-8 不泄漏，日报为 versioned 制品不自动重算，staleness 记 defer）。
- Given `/daily` 路由 force-dynamic 且 import `@aguhot/core`，When 执行 `pnpm --filter web build`（无 `DATABASE_URL`），Then 构建成功，And `pnpm -r typecheck`/`pnpm -r lint` 通过，And `pnpm --filter worker verify:digest` 打印 PASS（eligible 选取/items/conclusion 强制/append-only/投影取最新/当日无事件不写/adapter 缺失不写/缺字段或建议词抛错/listCoverageDates/NFR 无建议词），And `pnpm --filter worker verify:publish`/`verify:market-reaction`/`verify:associations`/`verify:themes` 不回归。
- When 执行 `pnpm --filter web e2e:daily`（`@daily`），Then `/daily` 200 且覆盖日期+生成时间+entries 链可见、daily→detail 点击闭环、`/daily?date=` 选日、降级态显覆盖范围不空白；And `pnpm --filter web e2e`（home/navigation/design）/`e2e:console`/`e2e:feed`/`e2e:detail`/`e2e:market-reaction`/`e2e:associations`/`e2e:themes` 不回归。

## Spec Change Log

<!-- 空，直至首次 bad_spec 回路。 -->

## Review Triage Log

### 2026-07-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (medium 3, low 1)
- defer: 2: (low 2)
- reject: 18
- addressed_findings:
  - `[medium]` `[patch]` `listPublishedDailyDigestCoverageDates` 的 DESC 排序是 `/daily` 默认视图（取 `[0]` 为最新日报）的 load-bearing 行为，但 `verify:digest` 仅断言 membership（单日 seed 无法观察顺序）——降序回归会使 `/daily` 默认展示最旧日报而测试静默绿。新增 verify 断言：投影第二个更晚的 coverageDate 后断言 `[0]` 为该更晚日期，锁住 DESC 契约（26/26）。
  - `[medium]` `[patch]` 日报 entries 在生成时按 `evidenceCount DESC` 排序、`/daily` 渲染信任该序，但 `@daily` e2e 仅断言每个标题可见、不断言 DOM 序——排序回归（最弱信号置顶）会静默绿。新增 bounding-box DOM 序断言（`digestEntryIds[0]` 链 y 坐标 < `[1]`），锁住「最强信号优先」渲染契约。
  - `[medium]` `[patch]` AC「日报内事件被 takedown 后 `/events/{X}` 诚实 404 + 日报读模型不自动重算（versioned 制品）」机制齐全（无 FK、`getPublishedHotEventDetail` null→notFound）但无测试走过该序列。新增 2 条 verify 断言：`decideReview(takedown)` 成员事件后 `getPublishedHotEventDetail` 返回 null（daily→detail 链 404）且 `getPublishedDailyDigest` entries 不变（versioned 不重算）。
  - `[low]` `[patch]` deferred-work 中「StubDigestAdapter 仅测试、非 prod 诚实下限」条目与「真实 LLM provider defer」条目内容重复（均陈述 stub 仅测试 + prod 降级 + provider defer）。移除冗余条目，保留更具可操作性的 provider defer 条目。
  - 2 项 defer 已追加至 deferred-work：(1) coverageDate 未规范化到 UTC 日起点 + worker 输入未校验（非午夜 coverageDate 破坏 PK 等值读、畸形串静默成 Invalid Date；V1 无 enqueue 调用方故 latent，待 worker/cron 落地时规范化+校验）；(2) `ADVICE_KEYWORDS` 同义词不全（缺 加仓/减仓/止损/止盈/荐股 等；V1 stub 不触发，真实 LLM 落地后漏检，且 4 文件镜像清单需收敛）。
  - 18 项 reject 静默丢弃：跨 run/跨 spec DB 残留（既有 verify/seed 不读日报表、新 verify/seed 自清，残留无害）；读查询 traceId 未用（镜像既有 publish-orchestrator 读惯例，2-3 已 reject 同款）；AiLabel `.bg-accent-warm` 选择器（detail.spec/revision.spec 故意用此既定惯例，非脆弱）；`DailyDigestEntry` 双定义（spec 显式选择、镜像 2-3 `ThemeRef`）；`ADVICE_KEYWORDS` 跨文件镜像（自包含 verify 惯例）；worker 硬编码 `considered:1`（V1-deferred 运行时、不可观测，修复需重复过滤逻辑）；empty-adapter null 分支测试（trivial JS 子句变体，`[]` 已覆盖 outcome）；`DigestSource` 双导出命名（cosmetic、barrel 既定模式）；多日 `?date=` e2e（verify 级 DESC 测试 + 既有单日/bogus e2e 已覆盖）；降级「今日」计数语义（prod 正确、AC3 非空白已验证）；impossible-state 边界（entries 空/坏 Json/坏 ISO/latestEvidenceAt 非日期/重复 key——写时校验 + Prisma 类型 + UUIDv7 构造已防）；DB-down 页 500（matrix 显式 error、镜像所有公开页）；`?date=2024-02-30` rollover（pedantic 低后果输入边界）；adapter 部分结论（adapter curates「重点」事件、omission by design）；`adapter.fetchConclusions` 抛错（正确上抛、worker 隔离）；否定建议「不建议买入」误判（flagging 受益——日报根本不应讨论买卖）。
- verification_note: 复核期发现 `daily_digest_read_models` 迁移在实现期**未被应用到 `aguhot_dev`**（实现报告称已应用，但 `prisma migrate status` 显示 pending）——`verify:digest` 因此首跑即 TableDoesNotExist。迁移文件本身正确；执行 `prisma migrate deploy` + `prisma generate` 应用后 `verify:digest` 复跑 26/26 全绿。属实现/验证保真度问题（非 spec 缺陷），已就地修复。
## Design Notes

**为何日报聚合用 `refreshPublishedDailyDigest` 兄弟函数（coverageDate 键控）而非并入 `refreshPublishedReadModel`（hotEventId 键控）的新分支：** `refreshPublishedReadModel({prisma,traceId,hotEventId,action})` 的契约是**单 hotEvent 发布态投影**（publish/takedown/none→投影/清该事件的六张 published_hot_event_* 表）。日报是**按 coverageDate 聚合多事件**的独立聚合体（epic 数据模型 `DAILY_DIGEST ||--o{ HOT_EVENT`——一个日报聚合多事件，非一个事件拥有日报），其生命周期不绑定任一单 hotEvent：一个事件 takedown 不应触发整个日报重算（versioned 制品），日报生成是对「当日已发布事件集合」的一次快照。把 coverageDate 键控的投影塞进 hotEventId 键控的 `refreshPublishedReadModel` 会混淆两种聚合契约（参数要么 hotEventId 要么 coverageDate、action 语义不适用日报）。故新增**兄弟函数** `refreshPublishedDailyDigest({prisma,traceId,coverageDate})`——同一模块（publish-orchestrator，AD-3 公开读模型唯一拥有者）职责、不同聚合键、独立函数。这仍忠实满足 epic「daily page reads only published_* generated/refreshed by publish-orchestrator」（owner 是模块而非单函数），只是投影入口按聚合类型分离（ponytail：不为虚幻的「统一 refresh」抽象 overload 既有契约，但也不为日报另起模块——一处模块、两个入口）。

**为何日报成员用 per-日报 append-only `items Json` set（镜像 2.2/2.3 关联/主题）而非规范化 `DigestEntry` 成员表 + `daily_digest_events` join，尽管 epic 数据模型写 `DAILY_DIGEST ||--o{ HOT_EVENT`（一对多）：** 与 2.2/2.3 同理——`DAILY_DIGEST ||--o{ HOT_EVENT` 是概念基数模型（「一个日报含多事件」），**不**规定落表形态。日报查询是「给定 coverageDate → 取该日 entries」（单点读，`published_daily_digest.findUnique({where:{coverageDate}})`），**非** SQL `WHERE digest_id=` 跨日报 join；事件身份（hotEventId/title/conclusion）存 per-日报 Json 足以寻址（hotEventId 是到 `/events/{id}` 的外键式链接）+ 显示。故选最简同形：1 张 append-only 写表（`daily_digest`，items `DailyDigestEntry[]`）+ 1 张 published 读模型（`published_daily_digest`），与 2.1/2.2/2.3 端到端同形（写表/投影），避免再造一套异形 DigestEntry 成员表抽象。epic 的一对多概念被忠实满足（entries 数组在），只是不预建规范化成员表。`daily_digest`/`published_daily_digest` **无 FK 到 hot_events**——日报不「拥有」事件，hotEventId 是 data-only 外键式链接（epic「cross-page navigation is not a module ... foreign-key-style links between them (DAILY_DIGEST → HOT_EVENT)」）；这意味着事件 takedown 不级联清日报（日报是 versioned 时间点制品，链诚实 404 见 AD-8，staleness 重算 defer）。

**为何 `daily-digest` worker 建（镜像 2.1/2.3，区别于 2.2 关联无 worker）：** epic-2-context Technical Decisions 明列三 Epic-2 BullMQ job 类目：market signal aggregation（2-1）、**daily digest（2-4）**、theme backfill（2-3）。daily-digest 在列 → 建 worker（镜像 `market-reaction-queue.ts`/`theme-backfill-queue.ts`：lazy Queue + enqueue + register + eligible/coverageDate + try/catch + refresh 投影 + trace_id）。2.2 关联不在列 → 不建 worker。V1 worker resolve adapter=undefined（无真实 LLM）→ `generateDailyDigest` 返回 null → `{generated:0,skipped}`，prod 诚实降级（与 2-1/2-3 worker 跑但 adapter none→skip 同形）；`StubDigestAdapter` 仅 verify/e2e 直调走通 happy path，**apps/worker 绝不 import**（沿用 stub 惯例）。建一个 epic 明列 job 类目的 worker 占位非仪式——LLM provider 落地时只换 adapter 装配、domain/投影/页零改动；触发（cron/编排/「每日定点」/job 链）defer（沿用「workers 独立、解耦、不自动链」不变量，头注释改「六 worker」）。

**为何 `/daily` 默认显示最新日报 + `?date=` 选日而非 `/daily/[date]` 动态路由：** AC2/AC3 要求「打开日报页→见覆盖日期+生成时间+daily→detail」「未生成→显覆盖范围/处理中不空白」。`/daily`（无参）需落到「最新已生成日报」——这要求先知哪些日有日报（`listPublishedDailyDigestCoverageDates`），再 `getPublishedDailyDigest(最新日)`。选 `?date=` query 参而非 `/daily/[date]` 动态路由：query 参复用 feed-filters 的 `?window=` 模式（1.7/2.2 已落地）、单一页面文件处理「最新 + 选日 + 降级」三分支、避免新增动态段 + 第二个 page 文件（ponytail：最少文件）。`?date=` 非法/格式错→忽略参、回退最新（不崩）。day-to-day 前后翻页导航 defer（归 2.5 返回路径 + 日报分页 defer）。

**为何「当日事件归属」用 `latestEvidenceAt` UTC 日而非真实交易历：** epic-2-context 强调「trading-day scoping」对日报关键，但 V1 无交易历模块/SDK（采购 defer，与 MarketDataAdapter provider 同期 defer）。`PublishedHotEventSummary` 带 `latestEvidenceAt`（事件最近证据时间，publish 时重算）与 `publishedAt`（首次发布时间）。`latestEvidenceAt` 表达「该事件最近活跃于何日」——更贴合「当日热点复盘」语义（一个早就发布但今日有新证据的事件仍属今日），而 `publishedAt` 只记首次发布。故 V1 用 `latestEvidenceAt` 的 UTC 日作为 coverage 归属（elaborated in digest 服务 JS 过滤），记为 ceiling：真实交易历（含盘中/盘后、节假日、时区）落地后替换（defer）。verify/seed 通过控制 evidence record 时间戳使 latestEvidenceAt 落「当日 UTC」保证确定性。

**为何日报内事件被 takedown 后日报不自动重算（versioned 制品 + 诚实 404）：** 日报是「某一刻当日热点的快照」（append-only、versioned、traceable，epic「not an in-place overwrite」）。事件 X 在日报生成后被 takedown，自动重算所有含 X 的历史日报会破坏 versioned 语义（历史制品应忠实反映生成时状态）。链 `/events/{X}` 诚实 404（AD-8 不泄漏未发布）即可——读者见 404 知「该事件已下线」，不造假。重算（append 新行、自然剔除已 takedown 事件）由下次 generateDailyDigest 触发（V1 显式调/cron defer）。staleness 自动检测/重算 defer（记 deferred-work）。

## Verification

**Commands:**
- `pnpm --filter core db:migrate -- --name daily_digest_read_models` -- expected: 迁移应用、2 新表生成（随后 prisma generate 产出新模型类型）
- `pnpm -r typecheck` -- expected: 全 workspace 通过（含 digest 子域 + publish-orchestrator 日报投影/读 + worker daily-digest queue + web 日报页）
- `pnpm -r lint` -- expected: 无错误
- `pnpm --filter worker verify:digest` -- expected: 集成脚本打印 PASS（eligible 选取/items/conclusion 强制/append-only/投影取最新/当日无事件不写/adapter 缺失不写/缺字段或建议词抛错/listCoverageDates/NFR 无建议词）；仅需 live PG、无 Redis
- `pnpm --filter worker verify:publish` / `verify:market-reaction` / `verify:associations` / `verify:themes` -- expected: 不回归（新表无 FK 到 hot_events→既有 hotEvent.deleteMany 不受影响，预期不需扩 resetState；仅当报错才扩）
- `pnpm --filter web build` -- expected: 无 `DATABASE_URL` 下构建成功（日报页 force-dynamic 不在 build 求值；静态公共页 design/favorites 不 import core）
- `pnpm --filter web e2e:daily` -- expected: seed 后 `@daily` 通过（日报渲染 + 覆盖日期/生成时间/AiLabel + daily→detail 链闭环 + ?date 选日 + 降级显覆盖范围不空白）
- `pnpm --filter web e2e` / `e2e:console` / `e2e:feed` / `e2e:detail` / `e2e:market-reaction` / `e2e:associations` / `e2e:themes` -- expected: 不回归

**Manual checks (if no CLI):**
- 已生成日报 `/daily` 显覆盖日期+生成时间+AiLabel+entries 链 `/events/{id}`；点链到达详情页；`/daily?date=YYYY-MM-DD` 选日；`?date=bogus` 回退最新；无日报显「尚未生成 + 已发布 N 条」降级不空白；日报内事件 takedown 后 `/events/{id}` 404；既有详情六分区/证据时间线/市场反应/关联/主题不回归；无投资建议措辞；日报匿名可达无登录墙。
