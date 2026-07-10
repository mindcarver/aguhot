# Deferred Work

Findings surfaced by review but belonging to future stories (out of Story 1-1's intent scope). Append-only — one entry per finding.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-public-shell-and-anonymous-home-entry.md`
  summary: `packages/config/src/env.ts` 的设计缺陷待消费者接入时再修
  evidence: 模块级 `cached` 单例不会随 `process.env` 变化失效（Next dev 热更新后返回陈旧 env）；`requireEnv(key)` 在任意其他 env 变量非法时也会抛出（跨 key 失败耦合）；`NODE_ENV` zod enum 未做大小写归一化（`PRODUCTION`/`prod`/`staging` 会抛）；`requireEnv("NODE_ENV")` 签名声明可抛但该 key 有 `.default` 实际永不抛。当前无任何消费者（worker/operator 属 Story 1.4+），正确修法取决于未来用法，过早修补有过度设计风险。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-public-shell-and-anonymous-home-entry.md`
  summary: `.npmrc` 全局 `ignore-scripts=true` 会在后续 story 抑制原生依赖 postinstall
  evidence: 该开关作为 `unrs-resolver`/`resolve@2` 的临时绕过被全局提交，但会同时禁用所有包的 postinstall/preinstall。Story 1.4 引入 Prisma 7.7（以及未来 esbuild/sharp）需要 postinstall 生成引擎/二进制，届时会被静默跳过导致运行时缺件。应在引入首个原生 postinstall 依赖时改为 `pnpm.onlyBuiltDependencies` 等白名单机制。
  resolution: 已于 Story 1.4 解决——删除 `.npmrc` 的 `ignore-scripts=true`，改用 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies: ["@prisma/client","prisma","@prisma/engines"]` 白名单：仅放行 Prisma 构建脚本恢复引擎下载，`unrs-resolver`/`resolve` 仍不在白名单故继续跳过（原绕过不变）。`pnpm install` 后 `prisma generate` 与 `prisma migrate dev` 均成功执行。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-public-shell-and-anonymous-home-entry.md`
  summary: e2e（AD-8 匿名首页不变量）未接入自动化验证门
  evidence: `apps/web/e2e/home.spec.ts` 是覆盖本 story 核心不变量（首页无登录墙）的唯一测试，但根 `package.json` 无 `test` 脚本、无 CI workflow、bmad-loop gate `commands = []`，故 `pnpm build/typecheck/lint` 全绿仍可能放行"首页被改成登录墙"的回归。e2e 仅在显式 `pnpm --filter web e2e` 时运行。应在平台 CI/自动化门就绪时接入。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-public-shell-and-anonymous-home-entry.md`
  summary: `(operator)/console` 是公开可达、可被 SEO 索引的占位路由
  evidence: `apps/web/app/(operator)/console/page.tsx` 渲染"运营复核台"占位文案，无 `robots` noindex、无 `(operator)` 组级 layout 以便后续加认证。当前无敏感内容（占位），但 Story 1.6 接入运营复核台前 `/console` 已是公开已知 URL。应在 Story 1.6 加认证/路由组门时一并处理。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-public-shell-and-anonymous-home-entry.md`
  summary: `dark:` 主题变体与 `suppressHydrationWarning` 为无效/未接线代码
  evidence: `apps/web` 页面使用 `dark:` Tailwind 变体且 `<html suppressHydrationWarning>`，但无 theme provider 在 `<html>` 上设置 `.dark` class，故 `dark:` 样式永不生效（死 CSS），`suppressHydrationWarning` 也无对应主题逻辑（模板残留，可能掩盖未来根元素水合错配）。design tokens / 排版 / 主题属 Story 1.3，应在其落地主题体系时清理。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-responsive-navigation-and-public-shell.md`
  summary: 公共壳层现在横跨两套暗色策略——首页保留既有 `dark:` 变体，1.2 新增的侧栏/抽屉/占位页为纯亮色；深色 OS 偏好下首页浅字叠白底不可读
  evidence: Story 1.2 的 Never 约束明确将 dark 清理与颜色 token 划归 1.3，故本 story 未触碰。`apps/web/app/globals.css` 仅有 `@import "tailwindcss"` 与空 `@theme`，Tailwind v4 默认 `dark:` 解析为 `@media (prefers-color-scheme: dark)`；根 `<html>`/`<body>` 无深色背景，故首页 `dark:text-neutral-300` 等在深色 OS 下渲染为浅字白底（不可读，1.1 即存在）。新增的 `public-nav.tsx` 侧栏/抽屉用 `bg-white`/`bg-neutral-50`、三张占位页不带 `dark:`，与首页保留的 `dark:` 变体并存。需在 1.3 落地主题系统（`@theme` token + `@custom-variant dark` 或主题 provider）时统一处理：移除首页 `dark:` 死代码或为其接入真正深色画布、并为壳层 chrome 接入 token。
  resolution: 已于 Story 1.3 解决——`@theme` 落地全部 DESIGN token、壳层 chrome 与各页面接入 token、首页/运营台 `dark:` 死代码与 `<html suppressHydrationWarning>` 一并移除（DESIGN V1 仅暖底亮色，未引入暗色分支）。深色 OS 下页面保持亮色，由 `e2e/design.spec.ts` 的 `colorScheme:"dark"` describe 钉住。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-visual-tokens-and-typography-foundation.md`
  summary: DESIGN `label` 字面（IBM Plex Sans）未加载，chip/标签暂用 `font-sans` + `uppercase tracking-wide text-xs` 近似
  evidence: Story 1.3 的 AC1 只命名「标题/正文/数字」三层，DESIGN.md `label`（IBM Plex Sans，过滤项/分组标签/栏位名）非三层之一；为避免无消费者的 Latin webfont 与额外 `--font-label` token（ponytail：不预埋无消费者 token），1.3 仅加载 IBM Plex Mono（数字层），chip 与标签用 sans + uppercase/tracking 近似 label 观感。`apps/web/components/chips.tsx` 当前未使用 Plex Sans。升级路径：当 1.7+ 真实过滤器/标签落地且 label 保真度需要时，加 `next/font/google` `IBM_Plex_Sans` + 一行 `--font-label` token，chip/标签 class 由 `font-sans` 换为 `font-label`。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-visual-tokens-and-typography-foundation.md`
  summary: `--color-focus-ring` token 已落地但无任何交互元素消费（导航链接/汉堡按钮无 focus-visible 焦点环）
  evidence: 1.3 在 `globals.css` `@theme` 落地 `--color-focus-ring`（DESIGN token），但 `apps/web/app/(public)/_components/public-nav.tsx` 的导航链接与汉堡按钮仅有 hover 态、无 `focus-visible:ring-focus-ring`/outline，焦点可见性与 1.2 一致未变（1.2 即无焦点环）。该 token 目前仅由 `/design` 色板可视化证明。焦点可见性属可达性范畴，消费该 token 归 Epic 3.5（语义与键盘可达性基线）统一处理，不在 1.3（纯 token foundation）范围内。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-visual-tokens-and-typography-foundation.md`
  summary: 市场反应 chip 的 `flat` 态文字对比度约 3.4:1，低于 WCAG AA（14px 非粗体需 4.5:1）
  evidence: `apps/web/components/chips.tsx` 的 `ReactionChip` flat 用 `text-market-flat`（#8E7759）叠 `bg-market-flat-soft`（#EFE7DA），对比度约 3.4:1；该取值逐字来自 DESIGN.md，属设计源对比度问题而非实现偏差。chip 带「平」文本标签（a11y 地板：色彩非唯一语义），且当前仅 `/design` 预览消费；待 1.7+ 真实市场反应 chip 落地、需 WCAG 校验时统一处理（必要时调整 market-flat token 或对 chip 文字加粗/放大）。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-evidence-source-ingest-and-archive.md`
  summary: `verify:ingest`（worker ingest 管道唯一行为验证）与 web e2e 均未接入任何 recurring 验证门；ingest 行为的回归无自动门拦截，且 source-ingest 无任何纯单测
  evidence: `apps/worker/src/verify-ingest.ts` 是覆盖 AC1/AC2/AC3 的唯一验证，但仅由显式 `pnpm --filter worker verify:ingest` 触发；全仓无 `.github/workflows`、无 turbo.json、根 `package.json` 的 `build/typecheck/lint` 均不调用它，bmad-loop gate `commands=[]`（与 spec-1-1 既有 "e2e 未接入自动化验证门" deferred 同根）。此外 `contentHash` 归一化契约、`RssAdapter` 解析、`ingestSources`（去重/隔离/缺字段）均无纯单测——仅依赖需 live PG+Redis 的集成脚本。`pnpm -r typecheck/lint/build` 全绿仍可放行去重/隔离/缺字段逻辑的回归。应在平台 CI/turbo 门就绪时把 `verify:ingest`（+ service container PG/Redis）与纯单测（fake prisma + adapter）一并接入。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-evidence-source-ingest-and-archive.md`
  summary: `source-ingest` 具体适配器 `RssAdapter` + `fast-xml-parser` 依赖置于 `packages/core`（领域），`ingest-service` 带 `defaultAdapterFactory` 硬导入之——AD-7 更纯读法是把具体适配器+第三方 SDK 放 worker 层
  evidence: spec Code Map 明确把 `rss-adapter.ts` 放 `packages/core/src/modules/source-ingest/`，`ingest-service.ts` 的 `defaultAdapterFactory`（line ~194）`new RssAdapter(...)`，故领域包直接依赖第三方 XML SDK。AD-7 端口（`SourceAdapter`）+ worker 装配（`workerAdapterFactory`）仍成立、切源只改适配器，故 spec 选此布局可辩护；但领域"零具体适配器/SDK 导入"的更纯读法要求把具体适配器移到 worker。现 `kind→adapter` 分支在 `defaultAdapterFactory`(domain)/`workerAdapterFactory`(worker)/`fixtureAdapterFactory`(verify) 三处重复。应在引入第二个 source kind/provider 时统一（合并三处 switch 为一处 registry，并定 core-vs-worker 放置）。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-evidence-source-ingest-and-archive.md`
  summary: `RssAdapter` 仅处理 RSS 2.0 文本 `<link>`；非文本/属性链接（Atom 风格 `<link href/>` 解析为对象）或 Atom feed 会触发 source 级失败（受控、非静默）
  evidence: `rss-adapter.ts` 用 `ignoreAttributes:false`+`textNodeName:"#text"`，`optionalString(item.link)` 签名 `(string|undefined)` 但 fast-xml-parser 对带属性元素返回对象，运行期 `value.trim()` 对象会抛 → 被 per-source try/catch 捕获记 `lastError`（不静默 corrupt）。fixture 为标准 RSS 2.0（文本 link），故 9/9 通过。真实非标 RSS 2.0 / Atom feed（`<feed>` 非 `<rss>`）未覆盖。外部源采购为 epic defer，应在真实源引入（1.5+）时加 feed-format 检测与非文本 link 容错。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-evidence-source-ingest-and-archive.md`
  summary: worker 运行时硬化不足——关闭处理非重入（双 SIGINT 触发 double-close）、无 `unhandledRejection` 处理、BullMQ `concurrency`/`stalledInterval`/`maxStalledCount` 用默认
  evidence: `apps/worker/src/index.ts` 的 shutdown 处理器无 `shuttingDown` 守卫，二次信号会并发二次调用 `worker.close()`/`closeRedis()`；无 `process.on('unhandledRejection'|'uncaughtException')`，BullMQ 运行时未捕获 rejection 可能使进程处于僵死态。`registerSourceIngestWorker` 的 Worker options 仅传 `connection`，并发/stalled 走 BullMQ 默认（V1 单源可接受）。应在 worker 成熟/上生产前补重入守卫、rejection 处理与显式并发/stalled 配置。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-candidate-hot-event-clustering.md`
  summary: cluster job 不由 ingest 完成自动触发——两 job（source-ingest / event-cluster）独立、幂等，但管道 chaining/cron 编排未落地
  evidence: `apps/worker/src/index.ts` 同时注册 `registerSourceIngestWorker` + `registerEventClusterWorker`，但两者无任何触发关系：ingest 归档 archived 记录后不自动入队 cluster job，cluster job 也不订阅 ingest 完成事件。当前需手动 `enqueueEventCluster`（verify-cluster 脚本与未来运营命令路径）才能跑聚类。这是有意为之的解耦（两 job 各自幂等、可独立重跑、失败互不阻塞），但生产管道需要编排（ingest → 定时/事件触发 cluster）。应在真实运营负载与编排需求出现时引入 repeat job（BullMQ `Queue.upsertJobScheduler`）或 ingest-completed 事件触发 cluster 入队，属 epic defer。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-candidate-hot-event-clustering.md`
  summary: 聚类相似度 O(N²) 两两比对 + 粗粒度 CJK 单字分词 + 静态停用词集 + 无界增长签名——recall/性能 ceiling 已登记，升级路径为真实分词/min-hash/embedding
  evidence: `packages/core/src/modules/event-assembly/clustering.ts` 的 `clusterRecords` 对每批未链接 archived 记录做 O(N²) 两两 overlap-coefficient 比对（`ponytail:` 注释已标明 ceiling 与升级路径：inverted-index 候选生成 / min-hash / LSH）。`tokenize` 对 CJK 做单字分词（`一-鿿` 各成一 token）减极小静态停用词集（`CJK_STOPWORDS`），无字典分词（无 jieba/hanlp），故复合标题（"央行降准"→央|行|降|准）无法区分词边界。`signatureOf` 的 token 并集随簇成员增长无界（大簇签名膨胀，未来 overlap 计算成本上升）。V1 ingest 体量（每 job 几条到几十条 archived）下全可接受；真实源规模化后应升级分词、候选生成、签名封顶（如取 top-K token 或带衰减权重）。属 epic defer（真实源采购 + 运营负载观察后定方案）。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-candidate-hot-event-clustering.md`
  summary: `verify:cluster`（worker 聚类管道唯一行为验证）与 `verify:cluster-logic`（core 纯聚类自检）均未接入任何 recurring 验证门
  evidence: `apps/worker/src/verify-cluster.ts` 是覆盖 AC1/AC2 的唯一端到端验证（需 live PG+Redis），`packages/core/src/modules/event-assembly/clustering.selfcheck.ts` 是纯聚类逻辑自检（无 infra），但两者仅由显式 `pnpm --filter worker verify:cluster` / `pnpm --filter core verify:cluster-logic` 触发；全仓无 `.github/workflows`、无 turbo.json、根 `package.json` 的 `build/typecheck/lint` 均不调用它们，bmad-loop gate `commands=[]`（与 spec-1-1/1-4 既有 "e2e/verify 未接入自动化验证门" deferred 同根）。`pnpm -r typecheck/lint/build` 全绿仍可放行聚类分组/增量合并/时间窗分隔逻辑的回归。应在平台 CI/turbo 门就绪时把两脚本（+ service container PG/Redis for verify:cluster）一并接入。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-candidate-hot-event-clustering.md`
  summary: 候选标题为朴素派生（簇内最新 publishedAt 记录的标题，非 AI）——真正标题/解释/摘要生成归 explain job（1.8）
  evidence: `packages/core/src/modules/event-assembly/cluster-events.ts` 的 `deriveTitle` 取簇内最新 publishedAt 记录的 title（null 则回退 summary 片段→占位"未命名候选"），纯字符串派生、无 LLM 调用、无 NFR3 AI 标识义务（派生非生成，见 Design Notes）。候选 `summary` 字段未填充（HotEvent schema 无 summary 列，解释/摘要归 1.8 ExplanationVersion）。incremental merge 时标题稳定（新建后不改，标题修订归 1.9 运营动作）。真正的事件级标题/解释/摘要生成是独立 explain job（epic worker job 划分 ingest/cluster/explain/publish/digest），属 1.8 详情页范围。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-public-hot-event-feed.md`
  summary: 一句话解释/摘要、分类筛选、市场反应排序理由、整卡进详情、骨架与流式全部 defer——读模型当前列集无对应数据列，待 1.8/Epic 2 数据源落地时接入
  evidence: `published_hot_events` 读模型为 1.6 最小投影（title/evidenceCount/latestEvidenceAt/publishedAt），无解释列、无 category、无 market reaction。epic 卡片字段「一句话解释」归 1.8 explain job → `ExplanationVersion`；「分类筛选维度」归 Epic 2.2（概念/行业关联）；「市场反应排序理由/ReactionChip」归 Epic 2.1（市场反应信号）；「整卡点击进详情」归 1.8 详情页。1.7 只呈现读模型实有字段（标题/来源数/更新时间/evidenceCount+recency 两信号排序理由 chip），伪造这些字段会违反 NFR「空态绝不渲染假数据」与 AD-3（为凑解释去读 evidence_records 摘要）。这不是 intent gap（无任何「应实现」的可辩护读法——数据不存在），而是与 1.6 defer 同型的数据依赖 defer。
  resolution: 已于 Story 1.7 登记为数据依赖 defer——随 1.8（解释/详情）/Epic 2.1（市场反应）/Epic 2.2（分类关联）落地时分别接入卡片字段与筛选维度。1.7 排序理由 chip 仅用 evidenceCount（多源）+ recency（近期）两信号。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-public-hot-event-feed.md`
  summary: `pnpm --filter web e2e`（home/navigation/design）现 request 期依赖 DATABASE_URL——首页 force-dynamic + import @aguhot/core 所致，属 1.7 有意演化
  evidence: `apps/web/app/(public)/page.tsx` 声明 `export const dynamic = "force-dynamic"` 并 `getPrisma()` + `listPublishedHotEvents` 读读模型（AD-3 公开读首次落地）。force-dynamic 路由在请求期求值，故 `goto("/")` 触发 getPrisma → 需 request 期 DATABASE_URL。1.6 build 不变量（`next build` 无 DATABASE_URL）仍成立（force-dynamic 不在 build 期求值），但运行期 e2e 现需 DB。这是 AD-3 公开读的必然结果，1.6 无法预见（彼时无公开 DB 读）。`(public)/layout.tsx` 及 /daily /topics /favorites /design 保持静态、不 import core，故仅 `/` 动态。home.spec.ts 文件头已注释说明该演化。dev/CI 环境本就跑 PG，无额外基础设施负担。
  resolution: 已于 Story 1.7 接受为有意演化——home.spec.ts 注释说明，dev/CI 跑 PG 即可。若未来需公开 e2e 在无 DB 环境跑（如 PR 预览无 service container），需为 home/navigation/design 引入「首页 force-dynamic 但 DB 缺失时优雅降级」或拆分 masthead-only 冒烟路径，属平台 CI 门就绪时的决策。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-public-hot-event-feed.md`
  summary: `listPublishedHotEvents` V1 全表读 + JS 日期窗口过滤，已发布集增长后有 scale ceiling——升级路径为 SQL `WHERE latest_evidence_at >= $1` + 索引
  evidence: `packages/core/src/modules/publish-orchestrator/publish-service.ts` 的 `listPublishedHotEvents` 做 `prisma.publishedHotEvent.findMany`（无 where、无 since 参数），返回全部已发布行（按 evidenceCount DESC + latestEvidenceAt DESC 排序），web 层 `filterByWindow` 在 JS 按窗口过滤。Design Notes 明示这是 V1 选择：规模极小（ingest 每批数条到数十条，已发布子集更少），一次查询同时区分「无已发布」空态 vs「窗口无结果」态。已发布集增长后（数千+行）全表读 + JS 过滤会成为瓶颈，需改 SQL `WHERE latest_evidence_at >= $1` + 给 `latest_evidence_at` 加索引、并将窗口计算下推到 core（但保留 totalExist 判断或两次查询以区分两空态）。ponytail：不预埋无消费者的 since 参数；待真实负载出现再改。
  resolution: 已于 Story 1.7 登记为 scale ceiling——待已发布集体量增长至全表读有可测延迟时，将窗口过滤下推为 SQL WHERE + 索引。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-public-hot-event-feed.md`
  summary: filter-pill「clear」态目前以「全部」pill 实现，未额外造可 dismiss chip——YAGNI；DESIGN 若需显式 clear 控件待真实多筛选维度落地时再评估
  evidence: `apps/web/app/(public)/_components/feed-filters.tsx` 的窗口 pill 组中，「全部」(window=all) 即清除控件（恒可见、当前窗口非 all 时点之恢复全部）。epic「活动筛选可视且可清除，不丢阅读上下文」由 URL 驱动原生满足。未造额外的「× 清除」chip（YAGNI：单维度筛选下「全部」pill 即是 clear 语义的最简形式）。DESIGN `filter-pill` 定义了 default/active/clear 三态，但 1.7 只用 default/active（clear 态以「全部」pill 实现）。多筛选维度（Epic 2.2 分类 + 日期同时活动）落地时，可能需要显式「清除全部」控件，届时再评估。
  resolution: 已于 Story 1.7 以「全部」pill 实现 clear 语义——多筛选维度落地时再评估是否需显式 dismiss chip。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-hot-event-detail-and-evidence-timeline.md`
  summary: 真实 LLM provider + `LLMAdapter` port 抽取未落地——V1 `generateExplanation` 为确定性派生（无第三方 SDK），预建 port 属「单一实现接口」反模式
  evidence: `packages/core/src/modules/explanation/explain-service.ts` 的 `generateExplanation` 从真实证据记录确定性派生三分区（summary/whyItMatters/uncertainties），`source="template"`，无外部 API key/SDK/网络调用。AD-7 要求外部 LLM 经 `LLMAdapter` 端口进入，但当前唯一实现是确定性派生（无第三方 SDK），按 ponytail「单一实现的接口」反模式不预建 port。真实 LLM（含 prompt 工程、provider 选型、重算/重试、成本控制）是独立大块且 V1 未决（架构把「具体云/数据源采购」列为 defer）。port 抽取待真实 external LLM 引入时按 AD「外部适配器端口在 worker 层」落地——彼时 AD-4「外部调用走异步 job」与 AD-7 才被真正触发。
  resolution: 已于 Story 1.8 登记为 defer——真实 LLM 引入时在 worker 层抽 `LLMAdapter` port，`ExplanationVersion.source` 翻 "ai"，公开 `<AiLabel>` 标识不变（epic「uniform, identical on public and operator」）。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-hot-event-detail-and-evidence-timeline.md`
  summary: 原文链接 HTTP 存活探测 / 归档快照未做——link_status 仅由 url 缺失推导，不做主动 dead-link 探测
  evidence: `packages/core/src/modules/publish-orchestrator/publish-service.ts` 的 `projectEvidenceTimeline` 把 `linkStatus` 从 evidence_records.url 推导：url 存在→"available"，url 缺失/空→"unavailable"（行保留不消失，AC2）。主动 HTTP 存活探测（HEAD/GET 探链接是否 200/404/超时）+ 归档快照（web archive 存储）是独立 concern——需异步 job + 归档存储 + 重试策略 + dead-link 写回 owner。当前 `evidence_records` 无 dead-link 列也无 owner 写，`published_hot_event_evidence.link_status` 仅由 publish-orchestrator 在投影时从 url 推导（不回写原始表）。ponytail：不在无探测 writer 时给 evidence_records 加 dead-link 列（无 owner 写即死列）。
  resolution: 已于 Story 1.8 登记为 defer——主动链接探测 + 归档快照独立 story，需 writer（异步 job）+ 归档存储 + link_status 升级为三态（available/unavailable/dead）时落地。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-hot-event-detail-and-evidence-timeline.md`
  summary: cluster→explain 自动编排 / cron 未落地——explain job 与 event-cluster job 一样独立、幂等、需手动/cron 触发
  evidence: `apps/worker/src/index.ts` 注册 source-ingest + event-cluster + explain 三个 worker，三者无任何触发关系：ingest 完成不自动入队 cluster，cluster 完成不自动入队 explain。当前需手动 `enqueueExplain`（或 verify/seed 直调 `generateExplanation`）。这是有意为之的解耦（沿用 1-5「两 job 独立、幂等、chaining/cron 未落地」）：三 job 各自幂等、可独立重跑、失败互不阻塞。生产管道需要编排（ingest → 定时/事件触发 cluster → 触发 explain）。
  resolution: 已于 Story 1.8 登记为 defer——真实运营负载与编排需求出现时引入 repeat job（BullMQ `Queue.upsertJobScheduler`）或 completed 事件链触发，属 epic defer。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-hot-event-detail-and-evidence-timeline.md`
  summary: 运营解释修订 / 版本差异 / 重发布 UI 归 1.9——本 story 只保证 ExplanationVersion 追加式 + 公开取最新
  evidence: `packages/core/src/modules/explanation/explain-service.ts` 的 `generateExplanation` 每次 append 一行（AD-5，永不 update/delete），`getLatestExplanation` 取 createdAt desc 首条；publish-orchestrator 投影取最新。但运营台「版本链消费」「人工修订（source="human"）」「版本差异 diff」「修订后重发布刷新读模型」均归 Story 1.9（已发布热点的文案与标签修正）。本 story 的 `ExplanationVersion.source` union 已含 "human" 值（为 1.9 预留的 provenance 值），但无运营写入路径。
  resolution: 已于 Story 1.8 登记为 1.9 范围——运营修订 UI + 版本链展示 + 修订触发读模型刷新在 Story 1.9 复用本闸门（review-workflow + publish-orchestrator）落地。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-hot-event-detail-and-evidence-timeline.md`
  summary: 详情页返回原语境（从日报/主题/搜索返回）归 2.5——本 story 仅提供回首页 `/` 的稳定返回链接
  evidence: `apps/web/app/(public)/events/[hotEventId]/page.tsx` 的返回链接固定指向 `<Link href="/">`（回首页）。epic「任何详情页必须返回其 originating consumption context」要求从日报/主题/搜索进入详情时返回原语境，但日报/主题/搜索页归 Epic 2（2.3/2.4），来源语境保留（referrer 感知 / return-to query param）归 2.5。本 story 只保证稳定可回首页（不丢阅读上下文的最小形态），具体语境保留待 Epic 2.5。
  resolution: 已于 Story 1.8 登记为 2.5 范围——Epic 2 日报/主题/搜索落地后，详情返回链按 originating context 动态化（referrer 或 return-to query param）。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-hot-event-detail-and-evidence-timeline.md`
  summary: `pnpm --filter web e2e`（home/navigation/design）现 request 期依赖 DATABASE_URL——首页 force-dynamic（1.7）+ 详情 force-dynamic（1.8）所致，属 1.7→1.8 有意演化
  evidence: Story 1.7 首页声明 `force-dynamic` + import `@aguhot/core` 读读模型（AD-3 公开读首次落地）；Story 1.8 详情路由 `(public)/events/[hotEventId]/page.tsx` 同样 `force-dynamic` + `getPrisma()` + `getPublishedHotEventDetail`。两个动态公开路由（`/` 与 `/events/[hotEventId]`）在请求期求值，故 `goto("/")` 或 `goto("/events/{id}")` 触发 getPrisma → 需 request 期 DATABASE_URL。1.6 build 不变量（`next build` 无 DATABASE_URL）仍成立（force-dynamic 不在 build 期求值，`pnpm --filter web build` 确认 `/` 与 `/events/[hotEventId]` 标记为 ƒ Dynamic），但运行期 e2e 现需 DB。`(public)/layout.tsx` 及 /daily /topics /favorites /design 保持静态（○ Static）、不 import core，故仅两个路由动态。dev/CI 环境本就跑 PG。
  resolution: 已于 Story 1.8 接受为有意演化（延续 1.7）——dev/CI 跑 PG 即可。若未来需公开 e2e 在无 DB 环境跑（如 PR 预览无 service container），需为 home/navigation/design 引入「DB 缺失时优雅降级」或拆分 masthead-only 冒烟路径，属平台 CI 门就绪时的决策。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-hot-event-detail-and-evidence-timeline.md`
  summary: 确定性 template 解释存在语义上限——无法生成需要领域知识/跨事件关联/市场含义推断的解释；真实 LLM 落地后语义质量跃升
  evidence: `packages/core/src/modules/explanation/explain-service.ts` 的 `derivePartitions` 是纯字符串派生：summary=标题+最新摘要，whyItMatters=来源数/覆盖跨度的客观陈述，uncertainties=数据缺口（缺摘要/缺 url/missing_fields）。它能保证「不造假、不投资建议、结构诚实」，但无法做：领域专家式的「为什么这件事对市场重要」判断、跨事件因果关联、政策含义推断、情绪/反应综合——这些需真实 LLM + 领域 prompt 工程。V1 template 解释是「诚实的下限」而非「高质量的上限」：读者能看到事实与数据缺口，但得不到专家级解读。
  resolution: 已于 Story 1.8 登记为 template 语义上限——真实 LLM 引入（见 LLM defer 项）后，`generateExplanation` 切换为 LLM 生成（source="ai"），template 作为 fallback/对照保留。LLM 生成的解释仍须挂 `<AiLabel>` + 经运营复核（AD-6 闸门不因 LLM 而旁路）。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-hot-event-detail-and-evidence-timeline.md`
  summary: AC3「公开页和后台复核页保持一致」目前仅组件级满足——运营复核页（1.6 console）不渲染任何解释/AiLabel，行为级一致性待 1.9
  evidence: step-04 intent-alignment 审计：`apps/web/app/(operator)/console/[eventId]/page.tsx` 无 `AiLabel`/`explanation` 引用（grep 确认），只渲染证据行 + 决策审计链 + 复核表单。AC3「该标识在公开页和后台复核页保持一致」在 1.8 由「公开详情页与运营台共用同一 `<AiLabel>` 组件（components/chips.tsx）」满足（组件级一致）；运营台当前无 AI 生成内容可标注，行为级一致性 vacuously 成立、待 1.9 运营解释展示后可观测。非 intent gap（spec Never 已显式把运营解释 UI 归 1.9，shared AiLabel 是 uniformity 机制）。
  resolution: 已于 Story 1.8 接受为 defer——AC3 行为级一致性随 Story 1.9 运营解释展示（复用 `<AiLabel>` + 读 ExplanationVersion）落地后可观测；组件级一致性已满足。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-hot-event-detail-and-evidence-timeline.md`
  summary: 详情页 `<AiLabel>` 对 `explanation.source` 盲目（仅 null 检查）——1.9 引入 source="human" 人工修订时需按 source 门控
  evidence: step-04 edge-case 审计：`apps/web/app/(public)/events/[hotEventId]/page.tsx` 的 `hasExplanation ? <AiLabel/> : null` 只检查 explanation 非 null，不区分 `source`。当前 source 恒为 "template"（V1）故正确；但 union 已含 "human"（1.9 预留），届时人工修订分区会错误挂 AI 标识。属 1.9 前瞻缺口（当前不可达）。
  resolution: 已于 Story 1.8 登记为 1.9 前瞻——Story 1.9 引入 source="human" 时把 `<AiLabel>` 门控改为 `source !== "human"`（或正向匹配 template|ai）。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-hot-event-detail-and-evidence-timeline.md`
  summary: `published_hot_event_evidence` 无 `UNIQUE(hot_event_id, position)` + `verify-publish` write-isolation 断言偏弱——两项 defense-in-depth/测试质量 defer
  evidence: step-04 edge-case + verification-gap 审计：(1) migration 的 `published_hot_event_evidence` 有 `@@index([hot_event_id])` 但无 `UNIQUE(hot_event_id, position)`——投影事务内 deleteMany+loop-create 正常路径无重复，部分失败重试/并发 refresh 理论上可产生重复 position（当前 decideReview 运营门控、非并发，低风险）。(2) `verify-publish.ts` 的 write-isolation 断言用 `evidence_records >= before`（非 `==`），illegal-setup 中途 seed 掩盖潜在破坏性写；AD-2 write-isolation 实际由模块边界保证，此断言仅 belt-and-suspenders 且当前失效。
  resolution: 已于 Story 1.8 登记为 defer——(1) 若引入 worker 触发并发 refresh 或观察到 position 冲突，加 `@@unique([hotEventId, position])`；(2) 重构 write-isolation 断言为「setup 后、操作前捕获 evidence_records id 集合，操作后断言集合不变」。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-hot-event-detail-and-evidence-timeline.md`
  summary: 详情页 `<title>` 为静态「热点事件详情」——每个事件详情页文档标题相同，未含事件标题（SEO/标签页可读性退化）
  evidence: step-04 adversarial 审计：`apps/web/app/(public)/events/[hotEventId]/page.tsx` 的 `metadata.title = "热点事件详情"`（静态），故每个详情页浏览器标签/历史显示同一通用标题。属 SEO/UX 退化（非正确性缺陷）。修复需 `generateMetadata` 读事件标题（额外一次读或 Next fetch 去重）。
  resolution: 已于 Story 1.8 登记为 SEO polish defer——后续用 `generateMetadata` 动态 `title: detail.title`。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-hot-event-detail-and-evidence-timeline.md`
  summary: `derivePartitions` 不截断 title/summary + `generateExplanation` 未守卫 `link.evidenceRecord` null——两项健壮性/防御性 defer（当前数据/约束下不可达）
  evidence: step-04 edge-case 审计：(1) `explain-service.ts` 的 `deriveSummary`/`deriveWhyItMatters` 直接拼接 title+summary 无长度上限（evidence summary 由采集归一化填入、实践有界，但无显式截断防护；超长输入→超大 ExplanationVersion 行 + 渲染膨胀）。(2) `event.evidence.map((link) => ({ id: link.evidenceRecord.id, ... }))` 假设 evidenceRecord 非 null——`HotEventEvidence.evidenceRecord` FK（onDelete 默认 Restrict）使 evidence_records 被引用时不可删→无孤儿→恒非 null，故当前不可达。
  resolution: 已于 Story 1.8 登记为健壮性/防御性 defer——(1) 若观察到超大摘要，在 `derivePartitions` 入口对 title/summary `slice(0, ~2000)`；(2) 若未来放宽 evidence_records 删除策略，map 前过滤 `link.evidenceRecord !== null`。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-9-published-event-copy-and-tag-corrections.md`
  summary: 按标签的 feed 筛选 / 分类维度归 Epic 2.2——1.9 标签是详情页展示属性，非筛选维度；listPublishedHotEvents / PublishedHotEventSummary 故意不带 tags
  evidence: Story 1.9 标签是运营自由文本展示属性（详情页渲染 TagChip），不向 `listPublishedHotEvents`/`PublishedHotEventSummary` 加 `tags`（不改 1.7 feed 契约）。epic 卡片「分类筛选维度」与 deferred-work 1.7 条目明示分类筛选归 Epic 2.2（概念/行业关联、派生分类、筛选器）。1.9 标签与 Epic 2.2 分类是不同概念（前者是事件展示属性，后者是 feed 筛选维度），可共存：标签投影到读模型、详情面展示；按标签筛选若需要是另一 concern，AC 不要求。
  resolution: 已于 Story 1.9 登记为 Epic 2.2 范围——按标签/分类筛选 + 标签作为筛选维度随 Epic 2.2 分类关联落地时评估。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-9-published-event-copy-and-tag-corrections.md`
  summary: 标签分类法 / 预定义标签集 / 标签级元数据表未引入——V1 取最小可辩护读法（自由文本运营标签）
  evidence: 无分类法在任何 planning 文档定义；引入分类法需先定义标签集（超范围、未决）。1.9 `HotEventRevision.tags` 是 `String[]` 自由文本（trim/去重/保序、大小写敏感），无分类法、无标签级元数据表、无预定义标签集。`normalizeTags` 仅做分隔符拆分/trim/去重。多输入标签 UI 也未做（用单文本框分隔符输入，spec 明示 V1 不做多输入）。
  resolution: 已于 Story 1.9 登记为 YAGNI defer——待真实运营负载需要分类法/预定义标签集/多输入 UI 时，先定义标签本体（分类法、同义词、层级），再引入对应元数据表与 UI。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-9-published-event-copy-and-tag-corrections.md`
  summary: 「丢弃 pending 修订」功能未做——追加式不可删；运营可再修订回 published 值使差异归零，或保持 pending 不重发布
  evidence: Story 1.9 `reviseHotEvent`/`saveExplanation` 各做变更检测后 append（AD-5 追加式，永不 update/delete）。运营若误修订产生 pending，无法「撤销」该修订——但追加式无损坏：运营可再修订回与 published 相同的值（差异归零、pending 消失），或保持 pending 不重发布（公开不受影响）。强制 discard 需引入「标记作废」语义或软删，超 V1 最小。
  resolution: 已于 Story 1.9 登记为 defer——待真实运营误操作频次出现时，评估「标记修订作废」（软删/标记）或「回滚到指定版本」语义。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-9-published-event-copy-and-tag-corrections.md`
  summary: 运营台鉴权 / `(operator)` 路由组门未做——沿用 1.6 占位 `/console` 公开可达
  evidence: Story 1.9 运营修订 UI（`/console/[eventId]` published 分支、`submitRevision`、republish）沿用 1.6 的 `/console` 公开可达占位（`(operator)/layout.tsx` 仅 noindex、无认证）。真实运营认证依赖 `user-profile` 模块（未建，后续 epic）。reviewer 字段为占位 `"operator"`。开发态 `/console` 公开可达（安全含义：任何人可修订/重发布）。
  resolution: 已于 Story 1.9 沿用 1.6 defer——真实认证随 user-profile 落地时接入 `(operator)` layout 门，reviewer 字段流经验证身份。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-9-published-event-copy-and-tag-corrections.md`
  summary: 从 `taken_down` / `rejected` 重发布归 1.10——1.9 仅加 `published→published` 重发布（修订后刷新）
  evidence: Story 1.9 转换图仅加 `{from:"published", outcome:"republish", to:"published", action:"publish"}`。`resolveTransition` 对 `taken_down+republish` / `rejected+republish` 抛 `IllegalTransitionError`（selfcheck 锁定）。合并/拆分/从下线或驳回重发布是 1.10 范围（epic cross-story 依赖明示 1.10 复用闸门）。
  resolution: 已于 Story 1.9 登记为 1.10 范围——`taken_down→published` / `rejected→candidate` 重发布随 Story 1.10 合并/拆分/下线重发布落地（届时扩展 LEGAL_TRANSITIONS + selfcheck）。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-9-published-event-copy-and-tag-corrections.md`
  summary: 真实 LLM 沿用 1.8 defer——1.9 `saveExplanation` 接收运营手输文本，非 LLM 生成；LLMAdapter port 仍不预建
  evidence: Story 1.9 `saveExplanation` 接收运营**手输**三分区（source 由 caller 传，V1 `"human"`），不调外部 LLM、不引入 openai/anthropic 依赖。`LLMAdapter` port 沿用 1.8 defer（当前唯一 explanation 实现是确定性派生 + 人工手输，无第三方 SDK，预建 port 属「单一实现接口」反模式）。真实 LLM 生成（source="ai"）+ port 抽取待真实 LLM 引入。
  resolution: 已于 Story 1.9 沿用 1.8 defer——真实 LLM 引入时在 worker 层抽 `LLMAdapter` port，`generateExplanation` 切换为 LLM 生成（source="ai"），公开 `<AiLabel>` 标识不变（template/ai 挂、human 不挂）。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-9-published-event-copy-and-tag-corrections.md`
  summary: 标题/标签修订与解释修订分两个 server action、各模块 append 各自原子、整体非跨模块事务
  evidence: Story 1.9 `submitRevision` 顺序调 `reviseHotEvent`（event-assembly 写 `hot_event_revisions`）+ `saveExplanation`（explanation 写 `explanation_versions`）——各模块写归属内、各自 append 原子，但两者非跨模块事务（web 层顺序调）。若标题 append 后解释 append 前崩溃，留部分修订——但追加式无损坏（运营重提交）。强制跨模块事务需重构模块函数接受 `tx` 或引入 core 编排器，超 V1 最小。
  resolution: 已于 Story 1.9 登记为非原子 defer——待真实跨模块一致性需求出现时，引入 core 层编排器（接受 `PrismaTransaction` 的 revise+save 复合命令）或 saga 补偿。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-10-published-event-merge-split-and-unpublish.md`
  summary: 拆分出的新事件落地为 candidate，不自动发布——auto-publish 为架构 spine 未决 defer
  evidence: Story 1.10 `splitHotEvent` 新建 candidate HotEvent（`publicationStatus: Candidate`），运营需经既有 1.6 复核队列 approve 后才公开。架构 spine AD「是否对低风险事件自动发布」明示「先保留 review-workflow 闸门，自动发布策略等真实运营负载后再下放」。拆分出的子集是新内容面向公开，必经闸门。若未来观察拆分子集普遍低风险，可引入「拆分自动 approve」自动发布策略。
  resolution: 已于 Story 1.10 登记为 auto-publish 未决——待真实运营负载观察后，评估拆分自动发布策略（spine defer）。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-10-published-event-merge-split-and-unpublish.md`
  summary: 合并后 target 标题/解释不由合并自动改——运营要改标题/解释走 1.9 修订表单 + republish
  evidence: Story 1.10 `mergeHotEvents` 只搬证据链 + 重算 target `cluster_signature`，**不**写 `hot_events.title`、**不**自动 append `HotEventRevision`、**不**改解释。合并后 target 标题仍是聚类派生基线（或 1.9 revision overlay），解释仍是最新 ExplanationVersion。运营若要在合并后同步改标题/解释，需在合并后走 1.9 修订表单（submitRevision）+ republish。自动同步标题/解释超 V1 最小（合并语义是证据重组，非内容重写）。
  resolution: 已于 Story 1.10 登记为 defer——待真实运营反馈「合并后总需手改标题」时，评估合并时自动派生新标题/解释或提示运营修订。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-10-published-event-merge-split-and-unpublish.md`
  summary: 合并/拆分跨模块非原子——mergeHotEvents/splitHotEvent（event-assembly）与 decideReview（review-workflow）非跨模块事务
  evidence: Story 1.10 `submitMerge` 顺序调 `mergeHotEvents`（搬证据）→ `decideReview(target, republish)`（刷新 target 读模型）→ `decideReview(source, takedown)`（删 source 读模型）；`submitSplit` 顺序调 `splitHotEvent`（建 candidate + 搬子集）→ `decideReview(source, republish)`（刷新 source 读模型）。各步各自原子，但整体非跨模块事务（web 层顺序调）。若 mergeHotEvents 成功后 decideReview(republish) 崩溃，证据已搬但 target 读模型仍显旧——但追加式 + 幂等链搬迁无损坏（运营重提 republish）。强制跨模块事务需重构模块函数接受 `tx` 或引入 core 编排器，超 V1 最小（沿用 1.9 非原子 defer 同型）。
  resolution: 已于 Story 1.10 登记为非原子 defer——待真实跨模块一致性需求出现时，引入 core 层编排器（接受 `PrismaTransaction` 的 merge+republish+takedown 复合命令）。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-10-published-event-merge-split-and-unpublish.md`
  summary: 运营台鉴权沿用 1.6 占位——/console 公开可达，任何人可合并/拆分/下线/重发布
  evidence: Story 1.10 运营 UI（合并/拆分表单、重发布按钮、submitMerge/submitSplit server action）沿用 1.6/1.9 的 `/console` 公开可达占位（`(operator)/layout.tsx` 仅 noindex、无认证）。真实运营认证依赖 `user-profile` 模块（未建，后续 epic）。reviewer 字段为占位 `"operator"`。开发态 `/console` 公开可达（安全含义：任何人可合并/拆分/下线/重发布已发布热点）。
  resolution: 已于 Story 1.10 沿用 1.6/1.9 defer——真实认证随 user-profile 落地时接入 `(operator)` layout 门，reviewer 字段流经验证身份。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-10-published-event-merge-split-and-unpublish.md`
  summary: 按标签的 feed 筛选 / 分类维度归 Epic 2.2——1.10 不做标签筛选
  evidence: Story 1.10 合并/拆分/重发布复用 1.9 标签投影（published_hot_events.tags），但标签仍是详情页展示属性、非 feed 筛选维度。epic 卡片「分类筛选维度」与 deferred-work 1.7/1.9 条目明示分类筛选归 Epic 2.2（概念/行业关联、派生分类、筛选器）。1.10 不向 `listPublishedHotEvents`/`PublishedHotEventSummary` 加 tags（不改 1.7 feed 契约）。
  resolution: 已于 Story 1.10 沿用 1.9 defer——按标签/分类筛选随 Epic 2.2 分类关联落地时评估。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-10-published-event-merge-split-and-unpublish.md`
  summary: 真实 LLM 沿用 1.8 defer——1.10 不接真实 LLM，LLMAdapter port 仍不预建
  evidence: Story 1.10 合并/拆分/重发布不涉及解释生成（解释沿用 1.8 `generateExplanation` 确定性派生 + 1.9 `saveExplanation` 运营手输）。`LLMAdapter` port 沿用 1.8/1.9 defer（当前唯一 explanation 实现是确定性派生 + 人工手输，无第三方 SDK，预建 port 属「单一实现接口」反模式）。真实 LLM 生成（source="ai"）+ port 抽取待真实 LLM 引入。
  resolution: 已于 Story 1.10 沿用 1.8 defer——真实 LLM 引入时在 worker 层抽 `LLMAdapter` port。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-market-reaction-signal-generation-and-display.md`
  summary: 真实行情 provider + SDK 接入未落地——V1 worker 运行时 adapter 解析为 none，prod 诚实降级；`MarketDataAdapter` 端口已建（epic-2-context 列为 fixed），concrete 实现是 defer 的真实 provider
  evidence: Story 2.1 的 `MarketDataAdapter` 端口（`packages/core/src/modules/market-reaction/adapter.ts`）已落地（epic-2-context 明确「all market-data sources enter exclusively through this port」为 fixed 架构决策），但 V1 无真实行情 provider（采购 defer）。worker 运行时 `apps/worker/src/queues/market-reaction-queue.ts` 把 adapter 解析为 `undefined`（`// ponytail: real provider wired when procured`）→ `generateMarketReaction` 返回 null → 不写 snapshot → prod 详情页显「市场反应数据暂不可用。」降级（AC3）。`StubMarketDataAdapter` 是确定性 fixture（priceVolumeChangePercent=3.42、sector={半导体,2.1}、limitUpCount=5），仅 verify/e2e 直调 `generateMarketReaction` 走通 happy path；fixture 市场数据上公开财经页会误导读者（违反 NFR「absence shown as absence, never fabricated completeness」），故 prod 不接线。真实 provider 落地时 worker 解析它、信号流入、`MarketReactionSnapshot.source` 由 "template" 翻为 provider id。
  resolution: 已于 Story 2.1 登记为 defer——真实行情 provider 采购后，在 worker 装配层解析 concrete `MarketDataAdapter`（`apps/worker/src/queues/market-reaction-queue.ts` 的 `adapter` 变量改从 provider 构造），`source` 翻为 provider id，详情页信号自动流入。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-market-reaction-signal-generation-and-display.md`
  summary: 日内轮询 cadence / cron 未落地——market-reaction worker V1 仅处理「已发布且无 snapshot」的初始生成，不轮询更新
  evidence: Story 2.1 的 `registerMarketReactionWorker` 查 `publicationStatus:"published"` 且 `marketReactionSnapshots:{none:{}}` 的事件（初始生成），不设 BullMQ repeat job / cron。`MarketReactionSnapshot` 表已是 append-only 时间序列（日内多次轮询追加多行、公开投影取最新），schema 结构未来无需改——但 worker 的「每 N 分钟/每交易日轮询已发布事件刷新 snapshot」cadence 未接。沿用 1-5/1-8「job 独立、幂等、chaining/cron 未落地」惯例。
  resolution: 已于 Story 2.1 登记为 defer——真实运营负载 + provider 落地后，引入 BullMQ `Queue.upsertJobScheduler` repeat job（如交易日收盘后刷新），worker 改为处理「已发布且最新 snapshot 早于 X」的事件。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-market-reaction-signal-generation-and-display.md`
  summary: cluster→explain→market 自动编排未落地——三 job 独立、幂等，market 不由 explain/publish 完成自动触发
  evidence: `apps/worker/src/index.ts` 注册 source-ingest + event-cluster + explain + market-reaction 四个 worker，四者无任何触发关系：ingest 完成不自动入队 cluster，cluster 完成不自动入队 explain，explain/publish 完成不自动入队 market-reaction。当前需手动 `enqueueMarketReaction`（或 verify/seed 直调 `generateMarketReaction`）。这是有意为之的解耦（沿用 1-5/1-8「job 独立、幂等、chaining/cron 未落地」）。生产管道需要编排（ingest→cluster→explain→approve→market）。
  resolution: 已于 Story 2.1 登记为 defer——真实运营负载与编排需求出现时引入 repeat job 或 completed 事件链触发，属 epic defer。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-market-reaction-signal-generation-and-display.md`
  summary: market-reaction 绕过 review 闸门直发未做——V1 市场反应必须经 publish-orchestrator 投影，不自动绕过 decideReview
  evidence: Story 2.1 的 `market-reaction` worker 只 append `market_reaction_snapshots`（AD-2 单一写拥有者），公开投影由 `publish-orchestrator` 的 `refreshPublishedReadModel(publish)` 完成（AD-3 唯一拥有者）。worker 在 append 后调 `refreshPublishedReadModel(publish)` 触发投影——但这不绕过 review 闸门（事件必须先经 decideReview(approve) 才能 published，worker 仅处理 published 事件）。架构 spine AD「是否对低风险事件自动发布」+ epic-2-context「whether market-reaction/theme updates can bypass the review gate for speed」明示此为 defer。
  resolution: 已于 Story 2.1 登记为 defer——若未来需市场反应「抢速度」绕过闸门（如重大行情秒级刷新），需先定义绕过策略与审计边界（epic spine 未决项）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-market-reaction-signal-generation-and-display.md`
  summary: sector 名 / 个股真实映射依赖 Epic 2.2 概念/行业/个股关联——V1 sector 名来自 StubMarketDataAdapter fixture，非真实板块/个股映射
  evidence: Story 2.1 的 `StubMarketDataAdapter.fetchSnapshot` 返回固定 sector={name:"半导体", changePercent:2.1}（fixture），`generateMarketReaction.deriveSignals` 把它格式化进 sectorLimitUp chip value。真实 sector 名 + 个股映射需要先有 2.2 的 concept/industry/stock 关联结果（event→sector/stock 映射），adapter 才能据之查对应板块行情。`MarketDataAdapter.fetchSnapshot({hotEventId})` 的 V1 签名假定 adapter 内部解析 event→ticker/sector，但真实解析逻辑依赖 2.2 关联表（deferred）。
  resolution: 已于 Story 2.1 登记为 Epic 2.2 依赖——2.2 concept/industry/stock 关联落地后，真实 provider adapter 据关联表查板块/个股行情，sector 名由真实映射驱动。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-market-reaction-signal-generation-and-display.md`
  summary: 扁平 2-dimension 列模型的扩展性上限——未来更多维度（如资金流向）需重构为 JSON signals 数组或子表
  evidence: Story 2.1 的 `MarketReactionSnapshot` 用扁平列（priceVolumeTone/Value + sectorLimitUpTone/Value + limitUpCount）映射 V1 AC 恰好两类信号。`deriveSignals` 返回恰好 `{priceVolume, sectorLimitUp, limitUpCount}`。加第 3 维度（如资金流向 northbound flow）需改 schema（加列）或重构为 JSON signals 数组/子表。V1 AC 只要求两类，扁平列最简、强类型、可查询、直映射 ReactionChip——但不为尚不存在的第 3 维度预建多态结构（ponytail）。
  resolution: 已于 Story 2.1 登记为扩展性上限——未来需第 3+ 维度时，重构为 JSON signals 数组或子表（schema migration + deriveSignals 扩展 + 详情页渲染扩展）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-market-reaction-signal-generation-and-display.md`
  summary: StubMarketDataAdapter 仅测试、非 prod 的诚实下限——fixture 市场数据上公开财经页会误导读者，故 prod 降级、stub 仅 verify/e2e
  evidence: Story 2.1 的 `StubMarketDataAdapter`（`packages/core/src/modules/market-reaction/stub-adapter.ts`）返回确定性 fixture（priceVolumeChangePercent=3.42 等固定值）。区别于 1.8 explain 的 template（从真实证据诚实派生、可在 prod 跑、公开页挂 AiLabel），市场反应 stub 是 fixture 百分比——把 fixture「+3.42%」上公开财经页会让读者误以为是真实行情反应（违反 NFR「absence shown as absence, never fabricated completeness」）。故 V1 worker 运行时 adapter 解析为 none、prod 诚实降级；stub 仅 verify/e2e 直调 `generateMarketReaction` 走通 happy path（证明管道正确）。stub 不被 `apps/worker` import（头注释标明 test-only）。
  resolution: 已于 Story 2.1 登记为诚实下限——真实 provider 落地前，prod 永远降级（AC3）；stub 永远仅测试，不上公开面。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-market-reaction-signal-generation-and-display.md`
  summary: market-reaction worker 为未测运行时——镜像 event-cluster/explain 的 BullMQ worker，无 Redis 集成测试、无 cron/chaining
  evidence: Story 2.1 的 `verify:market-reaction`（`apps/worker/src/verify-market-reaction.ts`）直调 `generateMarketReaction` + `refreshPublishedReadModel`（纯逻辑+DB append，无 Redis、无 BullMQ），不经过 `registerMarketReactionWorker` 的 Worker 内 `dynamic import("@aguhot/core")` 路径。worker 的 Redis 连接、Job 调度、per-event try/catch 隔离、shutdown 关闭均无集成测试覆盖（镜像 event-cluster/explain 同款未测运行时 defer）。`pnpm -r typecheck/lint` 全绿仍可放行 worker 运行时回归。
  resolution: 已于 Story 2.1 登记为未测运行时 defer——待平台 CI 门就绪 + service container Redis 接入时，为 worker 运行时加集成测试（enqueue → worker 处理 → 断言 DB snapshot/projection）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-concept-industry-and-stock-associations.md`
  summary: 真实关联知识源 / 映射库 / NER / LLM provider + SDK 接入未落地——V1 `StubAssociationAdapter` 仅 verify/e2e 用、不接 worker/prod
  evidence: Story 2.2 的 `AssociationAdapter` 端口（`packages/core/src/modules/theme-linking/adapter.ts`）已落地（AD-7），但 V1 无真实关联知识源（概念/行业/个股映射库、NER、LLM 抽取——采购 defer）。`StubAssociationAdapter`（`packages/core/src/modules/theme-linking/stub-adapter.ts`）返回确定性 fixture（concept=半导体、industry=芯片、stock=中芯国际，mappingBasis="knowledge_base:v1"），仅 verify/e2e 直调 `generateAssociations` 走通 happy path；fixture 关联上公开页而无真实映射依据会误导读者（违反 AC2「禁止随意映射」+ NFR「absence as absence」），故 prod 不接线。真实知识源落地时 worker/命令路径解析 concrete adapter、`EventAssociationSet.source` 由 "template" 翻为 provider id（如 "tushare:concept"）。
  resolution: 已于 Story 2.2 登记为 defer——真实关联知识源采购后，在命令/worker 装配层（或 publish→association 钩子）解析 concrete `AssociationAdapter`，`source` 翻为 provider id，详情关联自动流入。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-concept-industry-and-stock-associations.md`
  summary: 关联生成 worker / cron / publish→association 自动触发未做——epic 未列关联生成 BullMQ job 类目，`generateAssociations` 为纯逻辑+DB append，verify/seed 直调
  evidence: Story 2.2 的 `generateAssociations`（`packages/core/src/modules/theme-linking/association-service.ts`）是纯逻辑+DB append（无 BullMQ、无 SDK），verify/seed 直调（同 `generateExplanation`/`generateMarketReaction`/`clusterEvents`）。epic-2-context Technical Decisions 只列三个 Epic-2 BullMQ job 类目（market-signal aggregation 2-1 / daily digest 2-4 / theme backfill 2-3）——关联生成不在其列，故不建 worker（建无触发、无真实 adapter 的 worker 纯属仪式，ponytail）。V1 prod 无任何触发→无关联生成→诚实降级（AC3）。自动编排（publish→association 钩子、定时 cron、操作命令）defer。
  resolution: 已于 Story 2.2 登记为 defer——真实知识源 + 运营负载出现时，引入 publish→association 钩子、BullMQ repeat job 或运营命令触发 `generateAssociations` + `refreshPublishedReadModel(publish)`。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-concept-industry-and-stock-associations.md`
  summary: 运营 curated 关联修订 UI + 分类法（taxonomy）未做——AC2 禁止无映射依据的手填关联，运营关联需先有 taxonomy + 映射依据机制
  evidence: Story 2.2 AC2「关联结果必须基于明确映射依据 / 不允许完全手工随意填写后直接公开」。运营手填关联若无 taxonomy + 映射依据校验机制会违反 AC2（任意来源可产出无依据关联）。`AssociationItem.mappingBasis` 数据级强制（`generateAssociations` 校验每项非空、缺则抛错）已落地，但运营 UI（选择/编辑关联、绑定映射依据、分类法下拉）未建。需先定义 taxonomy（概念/行业/个股本体、同义词、层级），再引入运营 curated 关联写点（复用 1.9 追加式 + 映射依据字段）。
  resolution: 已于 Story 2.2 登记为 defer——待真实运营需要人工 curated 关联时，先定义 taxonomy + 映射依据机制，再建运营关联 UI（source="human:curated"，mappingBasis 强制）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-concept-industry-and-stock-associations.md`
  summary: 概念/行业/个股独立详情页未做——V1 关联项跳转去向仅为过滤 feed（`/?<kind>=<label>`）
  evidence: Story 2.2 AC1「每个关联项有明确跳转去向」+ epic「dead links are defects」。V1 无 concept/industry/stock 独立详情页（2.3 theme 页未建、stock 详情页不存在），唯一 V1 内部可行去向是过滤 feed 视图（epic 列举的「filtered view」）。故关联项链 `/?concept=半导体`，feed 真实 honor 该维度（JS 过滤）。概念/行业/个股独立聚合页（如 `/concept/半导体` 列出所有该概念事件）是 epic 未列的扩展，defer。
  resolution: 已于 Story 2.2 登记为 defer——待真实导航负载需要概念/行业/个股聚合页时，建独立路由（读 published_hot_event_associations JS 过滤或 SQL 索引），关联项链改为指向聚合页。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-concept-industry-and-stock-associations.md`
  summary: 多关联维度同时活动的「清除全部」控件未做——V1 单维度（concept/industry/stock 最多一个活动），沿用 1.7 filter-pill clear defer
  evidence: Story 2.2 `parseAssociationFilter` 只 honor 第一个出现的维度（V1 单维度）。`FeedFilters` 的活动关联 pill 各自带 clear（href 去该维度、保留 window），但无显式「清除全部」控件。多维度同时活动（concept + industry 同时过滤）+ 显式 dismiss chip 沿用 1.7 defer（「全部」pill 实现 clear 语义）；`parseAssociationFilter` 也只解析第一个维度。待真实多维度筛选需求出现时评估。
  resolution: 已于 Story 2.2 登记为 defer——多维度同时活动落地时，扩 `parseAssociationFilter` 解析多维度 + 加「清除全部」控件（或每维度独立 dismiss chip）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-concept-industry-and-stock-associations.md`
  summary: feed 关联过滤 JS 全表读 scale ceiling——`listPublishedAssociations` 返回全部行 + web 层内存 join，已发布集增长后有瓶颈
  evidence: Story 2.2 `listPublishedAssociations`（`packages/core/src/modules/publish-orchestrator/publish-service.ts`）做 `prisma.publishedHotEventAssociation.findMany`（无 where），返回全部已发布关联行（仅 hotEventId + items），web 层建 Map + JS 过滤（沿用 1.7 `filterByWindow` + `listPublishedHotEvents` 全表读模式）。V1 已发布集体量极小（每次关联过滤触发一次额外全表读 + 内存 join），规模可接受；已发布集增长后（数千+行）全表读 + 内存 join 会成为瓶颈，需改 SQL GIN 索引（Json items）或规范化子表 + WHERE 下推。ponytail：不预埋无消费者的 SQL 过滤参数。
  resolution: 已于 Story 2.2 登记为 scale ceiling——待已发布集体量增长至关联过滤有可测延迟时，将过滤下推为 SQL（Json GIN 索引或子表 + WHERE kind/label）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-concept-industry-and-stock-associations.md`
  summary: `items` Json 列的查询性上限——当前整体读、永不按单项 SQL 查询；未来按 concept/industry 聚合或索引需重构
  evidence: Story 2.2 `EventAssociationSet.items` / `PublishedHotEventAssociation.items` 是 Prisma `Json` 列存 `AssociationItem[]`。这些项是 display-only 编辑注解，整体读（详情分组渲染、feed 内存过滤），永不按单项做 SQL 查询。未来若需按 concept/industry 做 SQL 聚合（如「所有含 concept=半导体 的事件」服务端分页）、加 GIN 索引、或单项更新（运营修订单个关联项），需重构为规范化子表（`published_hot_event_association_items` 多行，带 kind/label/mappingBasis 列 + 索引）。沿用 `tags String[]` 的「display-only 集合用非规范化列」精神，但 items 有结构故用 Json。
  resolution: 已于 Story 2.2 登记为查询性上限——待真实需要按 concept/industry SQL 聚合或单项更新时，重构为子表（schema migration + 投影/读取扩展）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-concept-industry-and-stock-associations.md`
  summary: `StubAssociationAdapter` 仅测试、非 prod 的诚实下限——fixture 关联上公开页会误导读者，故 prod 降级、stub 仅 verify/e2e
  evidence: Story 2.2 的 `StubAssociationAdapter`（`packages/core/src/modules/theme-linking/stub-adapter.ts`）返回确定性 fixture（concept=半导体 等固定值）。fixture 关联上公开页而无真实映射依据会违反 AC2（「禁止随意映射」）+ NFR（「absence as absence」）。故 V1 无 worker + 无真实 adapter → prod 无关联生成 → 诚实降级（AC3）；stub 仅 verify/e2e 直调 `generateAssociations` 走通 happy path（证明管道正确）。`apps/worker` 不 import stub（头注释标明 test-only）。
  resolution: 已于 Story 2.2 登记为诚实下限——真实知识源落地前，prod 永远降级（AC3）；stub 永远仅测试，不上公开面。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-concept-industry-and-stock-associations.md`
  summary: 关联生成无 worker 的触发缺口——V1 prod 无任何触发关联生成的路径（无 worker/cron/钩子），关联只能由 verify/seed 手动生成
  evidence: Story 2.2 epic 未列关联生成 BullMQ job 类目，故不建 worker（区别于 2-1 market-reaction 有 worker）。V1 prod 无任何触发关联生成的路径：无 worker、无 cron、无 publish→association 钩子、无运营命令。`generateAssociations` 只能由 verify/seed 脚本直调。这意味着 prod 永远无关联投影（详情页永远显降级文案 AC3）——这是 V1 诚实下限（无真实知识源时降级是正确行为），但触发缺口是功能 defer（真实知识源落地后需触发机制才能让关联流入公开面）。
  resolution: 已于 Story 2.2 登记为触发缺口 defer——真实知识源落地时，必须同步引入触发（publish→association 钩子 / cron / 运营命令），否则 prod 关联永远不生成。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-concept-industry-and-stock-associations.md`
  summary: projectAssociations（及所有 published_* 投影）read→write 非原子——seed/verify 用 root prisma（非事务）路径下，并发 append 可投影到非最新 set
  evidence: Story 2-2 step-04 adversarial 审计：`projectAssociations`（`publish-service.ts`）先 `findFirst` 最新 `EventAssociationSet` 再 `upsert`/`deleteMany`，两步非原子。经 `decideReview` 调用时在事务内（原子）；但 verify/seed（`refreshPublishedReadModel` 直传 root prisma）与未来 worker 触发路径是两条 auto-commit 语句，若两次 `generateAssociations`+`refresh` 在读与写之间交错，可投影到非最新 set。此为所有 published_* 投影（projectExplanation/projectMarketReaction/projectEvidenceTimeline/projectAssociations）共有的设计性质（共享投影模式），非 2-2 引入，但 2-2 新增第 4 个同形投影放大了面。V1 无并发触发（无 worker/cron、decideReview 运营门控非并发）故不可达。
  resolution: 已于 Story 2.2 登记为并发 defer——待引入并发 worker 触发投影时，把 read+write 包进 `prisma.$transaction`（或 `SELECT ... FOR UPDATE`），覆盖所有 published_* 投影。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-concept-industry-and-stock-associations.md`
  summary: `normalizeItems` 静默丢弃未知 kind / 空白 label 项（无 observability）——仅 mappingBasis 缺失抛错，其他非法项 silent continue
  evidence: Story 2-2 step-04 审计：`association-service.ts` 的 `normalizeItems` 对缺 `mappingBasis` 项 fail-fast 抛错（AC2），但对未知 `kind`（不在 concept/industry/stock union）与空白 label 项 silent `continue` 丢弃（前者为前向兼容注释 justify）。这削弱「absence as absence, never fabricated completeness」——运营看到部分关联集无法得知有项被丢。V1 仅 stub（返回合法三项）故不可达；真实 provider 产出未知 kind / 异常 label 时静默丢失。
  resolution: 已于 Story 2.2 登记为 observability defer——真实 provider 引入时，把 silent-drop 改为 console.warn（带 traceId + 被丢项）或可配置 strict 模式（未知 kind 抛错）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-concept-industry-and-stock-associations.md`
  summary: 关联 label 在存储边界未 trim/归一化——feed 过滤为精确串匹配，大小写/Unicode/首尾空白不一致会静默零命中
  evidence: Story 2-2 step-04 edge-case 审计：`normalizeItems` 跳过 trim 后为空的 label，但存储的是 raw 未 trim 的 label；feed `parseAssociationFilter` 同样不 trim，匹配为精确 `===`。若 adapter 产出 `" 半导体"`（首尾空白）或大小写/Unicode 变体，存储与过滤两侧需完全一致才命中——URL 手输 trailing `%20` 或 NFC 差异会静默零命中（feed 空态）。stub 产出干净 label 故不可达；真实 provider label 质量不可控时存在风险。
  resolution: 已于 Story 2.2 登记为 label 归一化 defer——真实 provider 引入时，在 `normalizeItems` 入口对 label `trim()` + Unicode NFC 归一，过滤侧同步归一后再匹配。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-concept-industry-and-stock-associations.md`
  summary: 读侧（projectAssociations / getPublishedHotEventDetail）未运行时校验 `items` Json 为数组——corrupt DB Json 会导致详情页 500
  evidence: Story 2-2 step-04 edge-case 审计：`items` Prisma Json 列以 `as AssociationItem[]` 强转读回，未做 `Array.isArray` 校验。若 items 列被手工/外部写入非数组（对象/原始值/null），`projectAssociations` 会 upsert 非 Json 数组到 published 表、详情页 `items.filter(...)` 抛 TypeError → 500。DB 仅由 Prisma 类型化写入（AD-2 单一写拥有者），corrupt 场景不可达（defense-in-depth 缺口，非正确性 bug）。同类 concern 适用所有 Json/String[] 读（tags 等）。
  resolution: 已于 Story 2.2 登记为 defense-in-depth defer——若未来放宽 items 写拥有者或观察到 corrupt，在读侧加 `Array.isArray(items) ? items : []` 兜底。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-concept-industry-and-stock-associations.md`
  summary: AC2 provenance 为固定文案「系统映射」，与每项 `mappingBasis` 实际值解耦——多 provider 落地后需动态化
  evidence: Story 2-2 step-04 intent-alignment 审计：详情关联区块渲染固定 provenance「关联依据：系统映射」，而非每项实际 `mappingBasis`（如 stub 的 "knowledge_base:v1"、未来 "tushare:concept"）。spec Design Notes 显式选择 V1 单一来源下用固定文案（知识库=系统映射，准确）。但多 provider 落地后，固定文案无法反映某项来自哪个 provider——AC2「明确映射依据可观测」需动态化（按 source/basis 渲染 provenance，或挂 AiLabel 区分 AI 抽取 vs 知识库映射）。mappingBasis 当前 fetched 到 server component 但未渲染（server 组件不序列化未消费字段到 client，无泄露）。
  resolution: 已于 Story 2.2 登记为 multi-basis defer——多 provider 落地时，provenance 行改为按 `mappingBasis`/`source` 动态渲染（区分知识库映射 / AI 抽取 / 运营 curated）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-concept-industry-and-stock-associations.md`
  summary: `generateAssociations` 降级路径（adapter 缺失/返回 null/空）未带 traceId 日志——运营无法区分「无 adapter 接线」vs「adapter 返回空」
  evidence: Story 2-2 step-04 edge-case 审计：`generateAssociations` 在 adapter 缺失 / 返回 null / 返回空数组时返回 null、不写，但未 log traceId + 原因。这与既有 generators（`generateExplanation`/`generateMarketReaction`）一致（均不在降级路径 log），故为 codebase 一致行为而非 2-2 引入；但关联生成未来上 worker 触发后，无日志会让「prod 永远降级」难以排障（不知是 adapter 未接还是返回空）。
  resolution: 已于 Story 2.2 登记为 observability defer——关联生成上 worker/触发后，在降级路径加结构化日志（traceId + hotEventId + reason），同步考虑给既有 generators 补。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-concept-industry-and-stock-associations.md`
  summary: `EventAssociationSet` 无复合索引 `(hotEventId, createdAt DESC)`——投影取最新走 hotEventId 索引 + 排序，scale 后是 perf cliff
  evidence: Story 2-2 step-04 adversarial 审计：`EventAssociationSet` 有 `@@index([hotEventId])` + `@@index([createdAt])`（沿用 2-1 MarketReactionSnapshot 同形），但投影热路径 `findFirst({ where:{hotEventId}, orderBy:[{createdAt:"desc"},{id:"desc"}] })` 需 `(hotEventId, createdAt DESC, id DESC)` 才能索引服务；当前是 hotEventId 索引过滤 + 排序。每次 publish/republish 触发投影（最频繁的写路径操作）。V1 体量极小故无延迟；与 2-1 同款 scale ceiling。
  resolution: 已于 Story 2.2 登记为 perf defer——待 EventAssociationSet 体量增长致投影有可测延迟时，加复合索引 `@@index([hotEventId, createdAt(sort: Desc), id(sort: Desc)])`（同步评估 2-1 MarketReactionSnapshot + 2-3 EventThemeSet）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-theme-page-continuity-tracking.md`
  summary: 真实主题知识源 / 映射库 / NER / LLM provider + SDK 接入未落地——V1 `StubThemeAdapter` 仅 verify/e2e 用、不接 worker/prod
  evidence: Story 2.3 的 `ThemeAdapter` 端口（`packages/core/src/modules/theme-linking/theme-adapter.ts`）已落地（AD-7），但 V1 无真实主题知识源（主题映射库、NER、LLM 抽取——采购 defer）。`StubThemeAdapter`（`packages/core/src/modules/theme-linking/stub-theme-adapter.ts`）返回确定性 fixture（slug=chip-supply-chain / label=芯片供应链，mappingBasis="knowledge_base:v1"），仅 verify/e2e 直调 `generateThemes` 走通 happy path；fixture 主题上公开页而无真实映射依据会误导读者（违反 AC2「禁止随意映射」+ NFR「absence as absence」），故 prod 不接线。theme-backfill worker 运行时 adapter 解析为 `undefined`（`// ponytail: real provider wired when procured`）→ `generateThemes` 返回 null → prod 诚实降级（AC3）。真实知识源落地时 worker 解析它、`EventThemeSet.source` 由 "template" 翻为 provider id。
  resolution: 已于 Story 2.3 登记为 defer——真实主题知识源采购后，在 worker 装配层解析 concrete `ThemeAdapter`（`apps/worker/src/queues/theme-backfill-queue.ts` 的 `adapter` 变量改从 provider 构造），`source` 翻为 provider id，详情主题 section + /topics 页主题自动流入。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-theme-page-continuity-tracking.md`
  summary: theme-backfill worker cron / 自动编排 / publish→theme 自动触发 / job 链式未落地——worker V1 仅占位（adapter 缺失→skip），触发/cron defer
  evidence: Story 2.3 的 `registerThemeBackfillWorker`（`apps/worker/src/queues/theme-backfill-queue.ts`）查询 `publicationStatus:"published"` 且 `eventThemeSets:{none:{}}` 的事件，但 V1 运行时 adapter 解析为 `undefined` → 整批 skip → `{generated:0, skipped}`。worker 无 BullMQ repeat job / cron / job 链式触发（沿用 1-5/1-8/2-1「job 独立、幂等、chaining/cron 未落地」）。`enqueueThemeBackfill` 存在但无调用方（无 publish→theme 钩子、无定时 cron、无运营命令）。这意味着 prod 永远无主题生成（除非手动 enqueue 或 verify/seed 直调）——V1 诚实下限（无真实知识源时降级是正确行为），但触发缺口是功能 defer。
  resolution: 已于 Story 2.3 登记为 defer——真实知识源 + 运营负载出现时，引入 publish→theme 钩子、BullMQ repeat job（`Queue.upsertJobScheduler`）或运营命令触发 `enqueueThemeBackfill`。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-theme-page-continuity-tracking.md`
  summary: 主题成员移除 / 版本化 / 回滚未做——V1 主题成员只追加（append-only set 取最新），移除语义/成员版本化 defer
  evidence: Story 2.3 `EventThemeSet` 是 append-only（AD-5，每次 `generateThemes` append 一行、永不 update/delete），公开投影取最新行。无「移除某事件的某主题成员」语义（运营修订主题成员身份归未来 taxonomy 治理）。成员版本化（记录哪个成员何时加入/移除主题）defer。V1 主题成员身份 = 最新 set 的 items。
  resolution: 已于 Story 2.3 登记为 defer——待真实运营需要成员移除/版本化时，先定义 taxonomy + 成员生命周期语义，再扩 `EventThemeSet` 或引入成员变更记录。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-theme-page-continuity-tracking.md`
  summary: 主题合并 / 拆分 / 重命名 / taxonomy 治理未做——V1 slug/label 存 per-event Json，无独立 Theme 目录表
  evidence: Story 2.3 选 per-event append-only `items Json` set（镜像 2.2 关联）而非规范化 `Theme` 目录表 + 成员表（spec Design Notes 显式辩护）。`/topics` 目录由 memberships 反推 distinct（JS dedup by slug），无独立 Theme 目录可合并/拆分/重命名。两个同义 slug（如 "chip-supply" vs "chip-supply-chain"）无合并机制；slug 改名无重定向。taxonomy 治理（主题本体、同义词、层级）defer。
  resolution: 已于 Story 2.3 登记为 taxonomy 治理 defer——待真实运营需要主题合并/拆分/重命名/同义词时，引入规范化 Theme 目录表 + 成员表（schema migration + 投影/读取扩展 + 运营 taxonomy UI）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-theme-page-continuity-tracking.md`
  summary: 运营 curated 主题修订 UI + taxonomy 未做——AC2 禁止无映射依据的手填主题，运营主题需先有 taxonomy + 映射依据机制
  evidence: Story 2.3 AC2「主题成员身份必须基于明确映射依据」。运营手填主题若无 taxonomy + 映射依据校验会违反 AC2。`ThemeRef.mappingBasis` 数据级强制（`generateThemes` 校验每项非空、缺则抛错）已落地，但运营 UI（选择/编辑主题成员、绑定映射依据、taxonomy 下拉）未建。需先定义 taxonomy（主题本体、同义词、层级），再引入运营 curated 主题写点。
  resolution: 已于 Story 2.3 登记为 defer——待真实运营需要人工 curated 主题时，先定义 taxonomy + 映射依据机制，再建运营主题 UI（source="human:curated"，mappingBasis 强制）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-theme-page-continuity-tracking.md`
  summary: 跨页返回路径上下文恢复（scroll 位 / filter 态 / 阅读上下文）归 2.5——本 story 仅做基本导航（详情→主题链、主题→详情链、主题页「← 返回」链 + 浏览器原生 back，深度一层）
  evidence: Story 2.3 `/topics/[slug]` 提供「← 返回主题目录」链回 `/topics`，详情主题 section 链 `/topics/{slug}`，主题页成员链 `/events/{id}`。但从详情进入主题页再返回详情时，filter 态 + scroll 位不恢复（浏览器原生 back 回退到主题页顶部，非原 scroll 位）。完整 UX-DR12（返回恢复 filter 态 + scroll 位）是 2.5 闭环 capstone 职责，2.3 提供主题页/跳转 surface 但不独占返回契约。epic-2-context 明示「Story 2.3 depends on Story 2.5's return-path contract」。
  resolution: 已于 Story 2.3 登记为 2.5 范围——Epic 2.5 跨首页/主题/日报/详情统一返回契约（referrer 或 return-to query param + scroll/filter 恢复）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-theme-page-continuity-tracking.md`
  summary: 主题页排序 toggle / 分页未做——V1 固定 latestEvidenceAt 升序（连续性时间序列），无降序/分页
  evidence: Story 2.3 `/topics/[slug]` 固定按 `latestEvidenceAt` 升序（earliest→latest，epic「continuity reads as a sequence」）。首页 feed 按 hotness（evidenceCount/latestEvidenceAt desc）——两者目的不同故排序策略分离。主题页无降序 toggle、无分页（V1 单主题成员数极小）。降序/排序 toggle / 分页 defer。
  resolution: 已于 Story 2.3 登记为 defer——待真实主题成员数增长至单页过长时，加排序 toggle（升/降）+ 分页（或无限滚动）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-theme-page-continuity-tracking.md`
  summary: 主题目录 `/topics` distinct 全表读 scale ceiling——`listPublishedThemeMemberships` 返回全部行 + web 层内存 dedup，已发布集增长后有瓶颈
  evidence: Story 2.3 `listPublishedThemeMemberships`（`publish-service.ts`）做 `prisma.publishedHotEventTheme.findMany`（无 where），返回全部已发布主题成员行（仅 hotEventId + items），web 层 `/topics` 页 JS dedup by slug 推导 distinct 主题集（沿用 2.2 `listPublishedAssociations` + 1.7 `filterByWindow` 全表读模式）。V1 已发布集体量极小；增长后（数千+行）全表读 + 内存 dedup 会成瓶颈，需改 SQL distinct（Json items 展开 + DISTINCT slug）或规范化 Theme 目录表 + WHERE 下推。
  resolution: 已于 Story 2.3 登记为 scale ceiling——待已发布集体量增长至 /topics 目录有可测延迟时，将 distinct 下推为 SQL（或引入 Theme 目录表 + 索引）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-theme-page-continuity-tracking.md`
  summary: `items` Json 列的查询性上限（同 2.2 关联）——当前整体读、永不按单项 SQL 查询；未来按 slug 聚合或索引需重构
  evidence: Story 2.3 `EventThemeSet.items` / `PublishedHotEventTheme.items` 是 Prisma `Json` 列存 `ThemeRef[]`。整体读（详情主题 section 渲染、/topics 目录内存 dedup、/topics/[slug] 内存过滤），永不按单项做 SQL 查询。未来若需按 slug 做 SQL 聚合或单项更新，需重构为规范化子表。沿用 2.2 关联 items Json 决策。
  resolution: 已于 Story 2.3 登记为查询性上限——待真实需要按 slug SQL 聚合或单项更新时，重构为子表（schema migration + 投影/读取扩展）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-theme-page-continuity-tracking.md`
  summary: `StubThemeAdapter` 仅测试、非 prod 的诚实下限——fixture 主题上公开页会误导读者，故 prod 降级、stub 仅 verify/e2e
  evidence: Story 2.3 的 `StubThemeAdapter`（`packages/core/src/modules/theme-linking/stub-theme-adapter.ts`）返回确定性 fixture（chip-supply-chain / 芯片供应链 固定值）。fixture 主题上公开页而无真实映射依据会违反 AC2 + NFR。故 V1 theme-backfill worker 运行时 adapter 解析为 none、prod 诚实降级；stub 仅 verify/e2e 直调 `generateThemes` 走通 happy path。`apps/worker` 不 import stub。
  resolution: 已于 Story 2.3 登记为诚实下限——真实知识源落地前，prod 永远降级（AC3）；stub 永远仅测试，不上公开面。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-theme-page-continuity-tracking.md`
  summary: theme-backfill worker 为未测运行时——镜像 market-reaction/explain 的 BullMQ worker，无 Redis 集成测试、无 cron/chaining
  evidence: Story 2.3 的 `verify:themes`（`apps/worker/src/verify-themes.ts`）直调 `generateThemes` + `refreshPublishedReadModel`（纯逻辑+DB append，无 Redis、无 BullMQ），不经过 `registerThemeBackfillWorker` 的 Worker 内 `dynamic import("@aguhot/core")` 路径。worker 的 Redis 连接、Job 调度、per-event try/catch 隔离、shutdown 关闭均无集成测试覆盖（镜像 market-reaction/explain/event-cluster 同款未测运行时 defer）。
  resolution: 已于 Story 2.3 登记为未测运行时 defer——待平台 CI 门就绪 + service container Redis 接入时，为 worker 运行时加集成测试（enqueue → worker 处理 → 断言 DB set/projection）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-theme-page-continuity-tracking.md`
  summary: 历史相似事件相似度判断未做——主题成员关系是显式映射（adapter 产出），非相似度推理；相似度推理 defer
  evidence: Story 2.3 主题成员身份由 `ThemeAdapter` 显式产出（映射库/NER/LLM），非从事件文本/证据做相似度推理。epic「absence as absence, never fabricated」+「Theme continuity must be honest: when evidence is insufficient to relate an event to a theme ... shows nothing rather than fabricating "similar history."」——「similar history」相似度推理是独立 concern（需相似度模型/embedding），非主题成员关系。相似度判断 defer。
  resolution: 已于 Story 2.3 登记为相似度推理 defer——待真实需要「历史相似事件」推荐时，引入相似度模型（embedding/相似度计算）作为独立 concern，与主题成员关系分离。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-theme-page-continuity-tracking.md`
  summary: 主题实时推送（WebSocket/SSE）未做——V1 靠读模型刷新 + 主动轮询，主题实时推送 epic defer
  evidence: Story 2.3 `/topics` 目录与 `/topics/[slug]` 页是 force-dynamic 请求期读读模型，无 WebSocket/SSE 实时推送。主题成员更新（新事件加入主题）需用户刷新页面才可见。epic-2-context + 架构 spine 把 WebSocket/SSE 实时推送列为 defer（V1 靠读模型刷新 + 主动轮询）。
  resolution: 已于 Story 2.3 登记为 epic defer——WebSocket/SSE 实时推送随 epic 整体 defer，待实时性需求出现时引入。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-theme-page-continuity-tracking.md`
  summary: projectThemes（及所有 published_* 投影）read→write 非原子——seed/verify 用 root prisma（非事务）路径下，并发 append 可投影到非最新 set（同 2.2 关联同型 defer）
  evidence: Story 2.3 `projectThemes`（`publish-service.ts`）先 `findFirst` 最新 `EventThemeSet` 再 `upsert`/`deleteMany`，两步非原子。经 `decideReview` 调用时在事务内（原子）；但 verify/seed（`refreshPublishedReadModel` 直传 root prisma）与未来 theme-backfill worker 触发路径是两条 auto-commit 语句，若两次 `generateThemes`+`refresh` 在读与写之间交错，可投影到非最新 set。此为所有 published_* 投影（projectExplanation/projectMarketReaction/projectEvidenceTimeline/projectAssociations/projectThemes）共有的设计性质（共享投影模式），非 2.3 引入。V1 无并发触发（theme-backfill worker adapter 缺失→skip、decideReview 运营门控非并发）故不可达。
  resolution: 已于 Story 2.3 登记为并发 defer（同 2.2）——待引入并发 worker 触发投影时，把 read+write 包进 `prisma.$transaction`（或 `SELECT ... FOR UPDATE`），覆盖所有 published_* 投影。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-theme-page-continuity-tracking.md`
  summary: `EventThemeSet` 无复合索引 `(hotEventId, createdAt DESC)`——投影取最新走 hotEventId 索引 + 排序，scale 后是 perf cliff（同 2.1/2.2 同型 defer）
  evidence: Story 2.3 `EventThemeSet` 有 `@@index([hotEventId])` + `@@index([createdAt])`（沿用 2.1 MarketReactionSnapshot + 2.2 EventAssociationSet 同形），但投影热路径 `findFirst({ where:{hotEventId}, orderBy:[{createdAt:"desc"},{id:"desc"}] })` 需 `(hotEventId, createdAt DESC, id DESC)` 才能索引服务。每次 publish/republish 触发投影。V1 体量极小故无延迟。
  resolution: 已于 Story 2.3 登记为 perf defer——待 EventThemeSet 体量增长致投影有可测延迟时，加复合索引（同步评估 2.1 MarketReactionSnapshot + 2.2 EventAssociationSet）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-theme-page-continuity-tracking.md`
  summary: theme-backfill 的 eligible 查询 `eventThemeSets:{none:{}}` 使已有 set 的事件永不回填——adapter 升级（v2 映射库）后旧事件不会被重新派生；已有 set 但投影缺失的事件也无修复路径
  evidence: Story 2.3 step-04 adversarial + edge-case 审计：`registerThemeBackfillWorker` 的 eligible 过滤为 `publicationStatus:"published"` 且 `eventThemeSets:{none:{}}`（镜像 2.1 market-reaction 的 `snapshots:{none:{}}`）。一旦某事件有任意 `EventThemeSet`（含降级空集），`none:{}` 永远排除它——即使未来 adapter 升级产出更好/更多主题成员，worker 也不重处理。另：投影缺失（refresh 失败）但 set 已存在的事件，同样因 `none:{}` 不被 worker 修复，永久停留降级态。V1 worker adapter 缺失→skip 故不可达；真实 adapter + 触发落地后这是真实回填缺口。
  resolution: 已于 Story 2.3 登记为回填 defer——真实 adapter 落地并需要重派生时，引入「按 adapter 版本/source 判定 set 是否过期」的 eligible 查询，或独立的投影修复路径（set 存在但投影缺失→重投影），区别于「首次生成」的 `none:{}` 过滤。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-theme-page-continuity-tracking.md`
  summary: `normalizeThemeItems` 按 slug dedup 时静默丢弃同 slug 项的 label/mappingBasis——无 observability（同 2.2 关联 dedup observability defer）
  evidence: Story 2.3 step-04 edge-case 审计：`normalizeThemeItems`（`theme-service.ts`）按 slug dedup、保序，第二个同 slug 项的 label/mappingBasis 差异被静默丢弃（无日志/计数）。沿用 2.2 关联 normalizeItems 的静默 dedup 行为。V1 stub 每事件返回单一 slug 故不可达；真实 adapter 若对一事件返回同 slug 的多项（含不一致 label/basis），丢弃无任何记录——AC2 provenance 可观测性缺口（运营不知有冲突被吞）。
  resolution: 已于 Story 2.3 登记为 observability defer（同 2.2）——dedup 丢弃同 slug 冲突项时加结构化日志/计数（traceId + slug + 被丢弃项），与既有 generators 降级路径日志一并补。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-theme-page-continuity-tracking.md`
  summary: 主题页 `/topics/[slug]` 成员行仅显 title + latestEvidenceAt + 来源数，未显 source name / 原始链接——完整 traceability 经成员链「一跳」到详情页才有
  evidence: Story 2.3 step-04 intent-alignment 审计：epic-2-context「Public content surfaced via daily/theme paths must retain evidence source, source name, time, and original link; traceability propagates into every Epic 2 surface」。主题页成员行渲染 title + `latestEvidenceAt` + 来源数（evidenceCount），但不显 source name 与原始链接——完整证据 traceability 经成员链 `/events/{id}` 跳到详情页（证据时间线）才有。审计判定「navigational-index 读法下合规」（主题页是导航索引、traceability 一跳可达），但「每条主题路径自带 source name/link」的字面读法未满足。
  resolution: 已于 Story 2.3 登记为 traceability 丰富化 defer——待真实主题页需要就地核验来源时，在成员行加 source name + 原始链接（读 `published_hot_event_evidence` 首条/代表性来源），避免读者必须跳详情才能溯源。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-daily-digest-generation-and-reading.md`
  summary: 真实日报 LLM 摘要 provider + SDK 接入未落地——V1 `StubDigestAdapter` 仅 verify/e2e 用、不接 worker/prod
  evidence: Story 2.4 的 `DigestAdapter` 端口（`packages/core/src/modules/digest/digest-adapter.ts`）已落地（AD-7），但 V1 无真实日报 LLM/摘要 provider（采购 defer）。`StubDigestAdapter`（`packages/core/src/modules/digest/stub-digest-adapter.ts`）返回确定性 fixture conclusion（`STUB_DIGEST_CONCLUSION = "当日重点事件，证据链已归档。"`），仅 verify/e2e 直调 `generateDailyDigest` 走通 happy path；fixture 结论上公开日报页而无真实生成依据会误导读者（违反 NFR「absence as absence, never fabricated completeness」），故 prod 不接线。daily-digest worker 运行时 adapter 解析为 `undefined`（`// ponytail: real provider wired when procured`）→ `generateDailyDigest` 返回 null → prod 诚实降级（AC3）。真实 provider 落地时 worker 解析它、`DailyDigest.source` 由 "template" 翻为 provider id。
  resolution: 已于 Story 2.4 登记为 defer——真实日报 LLM/摘要 provider 采购后，在 worker 装配层解析 concrete `DigestAdapter`（`apps/worker/src/queues/daily-digest-queue.ts` 的 `adapter` 变量改从 provider 构造），`source` 翻为 provider id，/daily 页日报自动流入。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-daily-digest-generation-and-reading.md`
  summary: daily-digest worker cron / 自动编排 / publish→digest 自动触发 / 「每日定点」/ job 链式未落地——worker V1 仅占位（adapter 缺失→skip），触发/cron defer
  evidence: Story 2.4 的 `registerDailyDigestWorker`（`apps/worker/src/queues/daily-digest-queue.ts`）解析 `coverageDate = new Date(data.coverageDate)`（从 job data），但 V1 运行时 adapter 解析为 `undefined` → `{generated:0, considered:1, skipped:1}`。worker 无 BullMQ repeat job / cron / job 链式触发（沿用 1-5/1-8/2-1/2-3「job 独立、幂等、chaining/cron 未落地」）。`enqueueDailyDigest` 存在但无调用方（无 publish→digest 钩子、无定时 cron、无「每日定点自动跑」、无运营命令）。这意味着 prod 永远无日报生成（除非手动 enqueue 或 verify/seed 直调）——V1 诚实下限（无真实 LLM 时降级是正确行为），但触发缺口是功能 defer。
  resolution: 已于 Story 2.4 登记为 defer——真实 LLM + 运营负载出现时，引入 publish→digest 钩子、BullMQ repeat job（`Queue.upsertJobScheduler`，如交易日收盘后触发）、或运营命令触发 `enqueueDailyDigest`。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-daily-digest-generation-and-reading.md`
  summary: 日报编辑 / 版本对比 / 回滚 / 多版本展示未做——V1 日报只追加（append-only set 取最新），编辑 UI / 版本 diff defer
  evidence: Story 2.4 `DailyDigest` 是 append-only（AD-5，每次 `generateDailyDigest` append 一行、永不 update/delete），公开投影取最新行。无「编辑日报文案」「版本差异 diff」「回滚到上一版」「展示多版本」UI（运营修订日报文案归未来日报治理）。V1 日报内容 = 最新 set 的 entries。
  resolution: 已于 Story 2.4 登记为 defer——待真实运营需要人工修订日报/版本对比/回滚时，先定义日报编辑语义（谁可编、编辑哪些字段、版本链展示），再扩 `DailyDigest` 或引入日报修订记录。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-daily-digest-generation-and-reading.md`
  summary: 日报邮件推送 / 订阅 / Webhook 未做——V1 日报仅 Web 页阅读
  evidence: Story 2.4 `/daily` 是 Web 页（请求期读 published_daily_digests）。无邮件推送日报、无订阅机制、无 Webhook 通知。epic「日报」核心是 Web 页阅读 + daily→detail 跳转，推送/订阅属独立 concern（依赖 user-profile 模块 + 通知系统，均未建）。defer。
  resolution: 已于 Story 2.4 登记为推送/订阅 defer——待 user-profile + 通知系统落地后，引入日报邮件推送 / 订阅 / Webhook（作为独立 concern，不改 /daily Web 页）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-daily-digest-generation-and-reading.md`
  summary: 跨页返回路径上下文恢复（scroll 位 / filter 态 / 阅读上下文）归 2.5——本 story 仅做基本导航（daily→detail 链 + 日报页「← 返回首页」链 + 浏览器原生 back，深度一层）
  evidence: Story 2.4 `/daily` 提供「← 返回首页」链回 `/`，日报每条事件链 `/events/{hotEventId}`（daily→detail）。但从日报进入详情再返回时，filter 态 + scroll 位不恢复（浏览器原生 back 回退到日报页顶部，非原 scroll 位）。完整 UX-DR12（返回恢复 filter 态 + scroll 位）是 2.5 闭环 capstone 职责，2.4 提供日报页/跳转 surface 但不独占返回契约。epic-2-context 明示「Story 2.4 depends on Story 2.5's return-path contract」。
  resolution: 已于 Story 2.4 登记为 2.5 范围——Epic 2.5 跨首页/主题/日报/详情统一返回契约（referrer 或 return-to query param + scroll/filter 恢复）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-daily-digest-generation-and-reading.md`
  summary: 日报内事件分页 / sort toggle 未做——V1 单页全量按证据数降序，分页/sort defer
  evidence: Story 2.4 `/daily` 固定按 evidenceCount DESC（entries 在生成时已排序）+ hotEventId DESC tiebreaker。首页 feed 按 hotness（evidenceCount/latestEvidenceAt desc）——两者目的不同故排序策略分离。日报页无降序 toggle、无分页（V1 单日事件数极小）。降序/排序 toggle / 分页 defer。
  resolution: 已于 Story 2.4 登记为 defer——待真实单日事件数增长至单页过长时，加排序 toggle（证据数/时间）+ 分页（或无限滚动）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-daily-digest-generation-and-reading.md`
  summary: 日报生成进度 WebSocket/SSE 实时推送未做——V1 靠读模型刷新 + 主动刷新，实时推送 epic defer
  evidence: Story 2.4 `/daily` 是 force-dynamic 请求期读读模型，无 WebSocket/SSE 实时推送。日报生成进度（adapter 运行中、即将完成）需用户刷新页面才可见。epic-2-context + 架构 spine 把 WebSocket/SSE 实时推送列为 defer（V1 靠读模型刷新 + 主动轮询）。
  resolution: 已于 Story 2.4 登记为 epic defer——WebSocket/SSE 实时推送随 epic 整体 defer，待实时性需求出现时引入。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-daily-digest-generation-and-reading.md`
  summary: 日报内事件被 takedown 后日报 staleness 自动重算未做——日报为 versioned 制品，链诚实 404；重算（append 新行剔除已 takedown 事件）由下次 generateDailyDigest 触发
  evidence: Story 2.4 `daily_digests`/`published_daily_digests` 无 FK 到 hot_events——日报不「拥有」事件，hotEventId 是 data-only 外键式链接。这意味着事件 takedown 不级联清日报（日报是 versioned 时间点制品）。日报已含事件 X 且 X 随后被 `decideReview(takedown)` 时，日报读模型不自动重算（versioned 制品），链 `/events/{X}` 诚实 404（AD-8 不泄漏）。重算（append 新行、自然剔除已 takedown 事件）由下次 `generateDailyDigest` 触发（V1 显式调/cron defer）。staleness 自动检测/重算 defer。
  resolution: 已于 Story 2.4 登记为 staleness 重算 defer——待真实运营需要日报自动反映 takedown 时，引入 staleness 检测（定期比对日报成员 vs 当前已发布集）+ 自动重算触发（或定时 cron 重生成日报）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-daily-digest-generation-and-reading.md`
  summary: 日报 `published_daily_digests` 全表读 scale ceiling——`listPublishedDailyDigestCoverageDates` 返回全部行 + web 层取首个，已发布集增长后有瓶颈
  evidence: Story 2.4 `listPublishedDailyDigestCoverageDates`（`publish-service.ts`）做 `prisma.publishedDailyDigest.findMany`（无 where），返回全部已发布日报行（仅 coverageDate），web 层 `/daily` 页取首个（最新 coverageDate）作为默认视图。V1 已发布日报体量极小（每天最多一行）；增长后（数千+天）全表读会成瓶颈，需改 SQL `ORDER BY coverage_date DESC LIMIT 1`（/daily 默认视图）或分页（历史日报浏览）。
  resolution: 已于 Story 2.4 登记为 scale ceiling——待已发布日报体量增长至全表读有可测延迟时，将默认视图查询改为 `findMany({ orderBy: { coverageDate: "desc" }, take: 1 })` 或加分页。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-daily-digest-generation-and-reading.md`
  summary: `items` Json 列的查询性上限（同 2.2/2.3）——当前整体读、永不按单项 SQL 查询；未来按事件/日期聚合或索引需重构
  evidence: Story 2.4 `DailyDigest.items` / `PublishedDailyDigest.items` 是 Prisma `Json` 列存 `DailyDigestEntry[]`。整体读（/daily 页渲染所有 entries），永不按单项做 SQL 查询。未来若需按 hotEventId 做 SQL 聚合（如「该事件出现在哪些日报中」）或单项更新，需重构为规范化子表。沿用 2.2/2.3 items Json 决策。
  resolution: 已于 Story 2.4 登记为查询性上限——待真实需要按 hotEventId SQL 聚合或单项更新时，重构为子表（schema migration + 投影/读取扩展）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-daily-digest-generation-and-reading.md`
  summary: daily-digest worker 为未测运行时——镜像 theme-backfill/market-reaction 的 BullMQ worker，无 Redis 集成测试、无 cron/chaining
  evidence: Story 2.4 的 `verify:digest`（`apps/worker/src/verify-digest.ts`）直调 `generateDailyDigest` + `refreshPublishedDailyDigest`（纯逻辑+DB append，无 Redis、无 BullMQ），不经过 `registerDailyDigestWorker` 的 Worker 内 `dynamic import("@aguhot/core")` 路径。worker 的 Redis 连接、Job 调度、coverageDate 解析、shutdown 关闭均无集成测试覆盖（镜像 theme-backfill/market-reaction/explain 同款未测运行时 defer）。
  resolution: 已于 Story 2.4 登记为未测运行时 defer——待平台 CI 门就绪 + service container Redis 接入时，为 worker 运行时加集成测试（enqueue → worker 处理 → 断言 DB digest/projection）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-daily-digest-generation-and-reading.md`
  summary: 历史相似日报相似度判断未做——日报是按日的聚合，非跨日相似度推理；相似度推理 defer
  evidence: Story 2.4 日报按 coverageDate 聚合当日已发布事件，非从历史日报做相似度推理。epic「absence as absence, never fabricated」——「历史相似日报」相似度判断是独立 concern（需相似度模型/embedding），非日报生成。相似度判断 defer（沿用 2.3 主题相似度 defer 同型）。
  resolution: 已于 Story 2.4 登记为相似度推理 defer——待真实需要「历史相似日报」推荐时，引入相似度模型（embedding/相似度计算）作为独立 concern，与日报生成分离。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-daily-digest-generation-and-reading.md`
  summary: 「当日事件归属」用 `latestEvidenceAt` UTC 日而非真实交易历——V1 无交易历模块/SDK，真实交易历（盘中/盘后、节假日、时区）落地后替换
  evidence: Story 2.4 `generateDailyDigest` 的 eligible 过滤用 `latestEvidenceAt` 的 UTC 日作为 coverage 归属（JS 过滤 `listPublishedHotEvents` 输出）。epic-2-context 强调「trading-day scoping」对日报关键，但 V1 无交易历模块/SDK（采购 defer，与 MarketDataAdapter provider 同期 defer）。`latestEvidenceAt` 表达「该事件最近活跃于何日」——比 `publishedAt`（首次发布时间）更贴合「当日热点复盘」语义。V1 用 UTC 日作为 ceiling，真实交易历（含盘中/盘后、节假日、时区）落地后替换。
  resolution: 已于 Story 2.4 登记为交易历 ceiling defer——真实交易历模块落地后（与 MarketDataAdapter provider 同期），把 `filterByCoverageDay` 的 UTC 日归因替换为交易历 scoping（交易日开收盘、节假日、时区）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-daily-digest-generation-and-reading.md`
  summary: coverageDate 未规范化到 UTC 日起点 + worker 输入未校验——非午夜 coverageDate 会破坏 PK 等值读；worker `new Date(data.coverageDate)` 对畸形串静默成 Invalid Date
  evidence: Story 2.4 `coverage_date` 是 `DateTime`（毫秒精度），`getPublishedDailyDigest`/`refreshPublishedDailyDigest` 均用 PK 等值 `where:{coverageDate}`。`/daily` 页 `parseCoverageDate` 把 `?date=YYYY-MM-DD` 解析为 UTC 午夜，worker `enqueueDailyDigest` 用 `coverageDate.toISOString()` 序列化、worker 用 `new Date(data.coverageDate)` 反序列化（保留原 instant）。若调用方传入非午夜 coverageDate（如运营传 `new Date()` 14:32），写入行的 instant 非午夜，页面的午夜解析在该日 `?date=` 命不中→降级；且 worker 对畸形 coverageDate 串反序列化得 Invalid Date，Prisma 查询期才抛（仅 worker try/catch 捕获，无 operator 可读上下文）。V1 无 enqueue 调用方（worker 运行时 defer）、verify/seed 均用 `Date.UTC(...)` 午夜日期，故纯 latent。
  resolution: 已于 Story 2.4 登记为 latent defer——待 worker/cron/运营 enqueue 落地时，在 `generateDailyDigest` 入口把 coverageDate 规范化到 UTC 日起点（截断时分秒），并在 worker 对 `data.coverageDate` 做格式校验（`/^\d{4}-\d{2}-\d{2}$/` + `Date.parse` 有效性），畸形则显式抛带上下文的错误。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-daily-digest-generation-and-reading.md`
  summary: `ADVICE_KEYWORDS` 同义词不全——缺 加仓/减仓/建仓/清仓/止损/止盈/荐股 等；V1 stub 不触发，真实 LLM 落地后建议词可能漏检
  evidence: Story 2.4 `digest-service.ts` 的 `ADVICE_KEYWORDS`（`noInvestAdvice`）列 买入/卖出/目标价/持仓/增持/减持/建议买/建议卖，缺常见同义词（加仓/减仓/建仓/清仓/止损/止盈/荐股/抄底/逃顶）。V1 `StubDigestAdapter` 返回固定安全 conclusion，永不触发检查；真实 LLM provider 落地后，结论含「加仓」「止损」等会漏过 NFR 检查流入公开 /daily 页。检查列表跨 4 文件镜像（digest-service + verify-digest + verify-themes + verify-associations），加词需同步。
  resolution: 已于 Story 2.4 登记为 LLM 策略 defer——待真实日报 LLM provider 落地、有真实结论语料后，统一建议词策略（扩同义词清单或改用分类器），并把 4 文件的镜像清单收敛为单一来源（避免漂移）。
