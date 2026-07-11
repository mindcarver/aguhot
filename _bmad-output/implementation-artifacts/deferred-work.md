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

- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-cross-surface-context-return-loop.md`
  summary: nav 级跨列表上下文（home↔daily↔topics 间切换）恢复未做——UX-DR12 的「返回」语义特指「进入详情后返回原消费上下文」，main-nav 切换是全局导航非阅读返回
  evidence: Story 2.5 `<ListContextMemory/>` 的捕获监听只在目标为 `/events/` 时写 returnContext，nav 链（首页/日报/主题/收藏）间的跳转不捕获/不恢复。读者经主图 nav 从 `/?window=7d` 切到 `/daily` 再切回 `/?window=7d` 时，filter 态靠 URL原生保留（nav 链不带 `?window=` 故丢失），scroll 不恢复。epic-2-context 明示「nav 为全局导航，非阅读上下文返回」——UX-DR12 不要求 nav 级恢复。主图 nav 切换的 filter+scroll 上下文恢复属独立 concern（需让 nav 链带当前 filter 或引入 nav-level context provider）。
  resolution: 已于 Story 2.5 登记为 nav 级跨列表上下文 defer——待真实读者反馈「nav 切换丢 filter 态」时，让 nav 链 honor 当前活动 filter（如 `/daily?date=` ↔ `/?window=` 互带）或引入 nav-level context restoration。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-cross-surface-context-return-loop.md`
  summary: 详情→关联 pill 前向跳转的 `?window=` 保留未做——详情「关联」pill 链 `/?concept=X` 丢当前 window filter（已知 context-leak）
  evidence: Story 2.5 只恢复「列表→详情→列表」返回路径的 query+scroll；详情「关联」section 的 FilterPill 链 `/?concept=半导体`（Story 2.2）不带当前 `?window=`，点入后 feed 的 window filter 丢失（从 7 日变全部）。这是前向探索跳转（详情→feed 过滤视图），非 UX-DR12 返回路径。2.2 落地时已知此 context-leak，defer 到统一处理。
  resolution: 已于 Story 2.5 登记为前向 pill context-leak defer——待真实读者反馈「关联 pill 丢 window」时，让详情 FilterPill 链 honor 当前 URL 的 window（或引入 feed-filter 合并而非覆盖语义）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-cross-surface-context-return-loop.md`
  summary: 多级返回栈 / 面包屑 / 前进（forward）恢复未做——UX-DR12 深度上限一层，超过一层的返回历史 defer
  evidence: Story 2.5 `RETURN_CONTEXT_KEY` 只存最近一跳的「列表→详情」上下文（单 slot，新值覆盖旧值）。读者若列表A→详情A→主题页→详情B→列表B 多层跳转，BackLink 只恢复到最近的来源（详情B 的 BackLink 回列表B，非递归回退到列表A）。面包屑（显示「首页 > 主题 > 详情」路径）+ 前进恢复（返回后点浏览器「前进」恢复详情态）均未做。UX-DR12 明示「navigation depth is capped at one level」——一层上限是 V1 设计选择，多层栈是 V2+ 扩展。
  resolution: 已于 Story 2.5 登记为多层栈 defer——待真实读者反馈「想回到两层前的列表」时，引入返回栈（数组 sessionStorage）+ 面包屑 UI（需先定义信息架构层级）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-cross-surface-context-return-loop.md`
  summary: 跨会话 scroll 持久化（localStorage）未做——V1 sessionStorage 会话级足矣，跨会话 scroll 恢复 defer
  evidence: Story 2.5 用 `sessionStorage` 存 returnContext + scroll（会话级，关闭标签页即失）。读者若隔天回访同一列表页想恢复昨日的 scroll 位，sessionStorage 已清。localStorage 可跨会话持久，但 V1 无此需求（阅读上下文是即时会话语义，非长期书签）。跨会话 scroll 持久化 + 隐私/清理策略 defer。
  resolution: 已于 Story 2.5 登记为跨会话 defer——待真实读者反馈「想恢复上次阅读位置」时，评估 localStorage 持久化（含过期/容量/隐私清理策略）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-cross-surface-context-return-loop.md`
  summary: epic-3 `/search` 路由落地后需扩 `isValidListReturn` allowlist——当前 allowlist 含 `/`、`/daily`、`/topics/`，不含 `/search`
  evidence: Story 2.5 `isValidListReturn` 的 pathname allowlist 为 `/` + `/daily` 精确、`/topics/` 前缀。`/search` 路由未落地（epic-3 搜索入口），故 allowlist 暂不含 `/search`。待 epic-3 `/search` 落地后，从搜索结果进详情再返回时，BackLink 会因 `/search` 非 allowlist 而回退 `/`（搜索上下文丢失）。需在 epic-3 落地时扩 allowlist。
  resolution: 已于 Story 2.5 登记为 epic-3 扩 allowlist defer——`/search` 路由落地时，把 `/search`（或 `/search` 前缀）加入 `LIST_PATH_EXACT`/`LIST_PATH_PREFIXES`，使搜索→详情→搜索返回路径恢复 filter+scroll。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-cross-surface-context-return-loop.md`
  summary: scroll 恢复假设 `window` 为滚动容器——若 `(public)/layout.tsx` 改为内层 overflow 容器，需适配 scrollTo 目标
  evidence: Story 2.5 `<ListContextMemory/>` 的 scroll 捕获用 `window.scrollY`、恢复用 `window.scrollTo({top, behavior:"instant"})`，假设 `<html>/<body>` 是滚动容器（document scroll）。当前 `(public)/layout.tsx` 是 `min-h-screen` 的 document flow（无内层 overflow 容器），故正确。若未来 layout 改为内层 overflow 容器（如 sticky nav + 内层 `overflow-y-auto` 主内容区），scrollY 需改为读该容器的 scrollTop、scrollTo 需针对该容器。
  resolution: 已于 Story 2.5 登记为 layout-适配 defer——若 layout 改为内层 overflow 容器，把 `window.scrollY`/`window.scrollTo` 改为该容器的 scrollTop/scrollTo（需先确定滚动容器的稳定选择器或 ref）。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-cross-surface-context-return-loop.md`
  summary: sessionStorage 禁用环境（隐私模式/cookies-blocked）的无恢复降级已实现，但无可观测埋点——运营无法区分「正常返回」vs「降级无恢复」
  evidence: Story 2.5 所有 sessionStorage 读写包 try/catch 静默 no-op（隐私模式降级）。读者在隐私模式下进详情再返回时，BackLink 回退 `/`、scroll 不恢复——页面正常渲染但功能静默降级。无埋点/log 让运营无法区分「读者主动放弃」vs「存储被禁用导致无恢复」。这是 observability 缺口，非功能缺陷（降级行为正确）。
  resolution: 已于 Story 2.5 登记为 observability defer——待真实生产观测需要时，在 sessionStorage 写失败时加结构化日志/埋点（区分「存储禁用」降级路径），与既有 generators 降级日志一并补。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-cross-surface-context-return-loop.md`
  summary: 捕获监听对带 `target=_blank` / `download` / 修饰键点击的语义边界——cmd/ctrl 新开标签页、`target=_blank` 新标签页、`download` 下载均非「离开当前列表」导航，原列表页保留→无返回需恢复
  evidence: Story 2.5 `<ListContextMemory/>` 的 click handler 已显式 skip `metaKey/ctrlKey/shiftKey/altKey` + `button !== 0`（修饰键点击不捕获，因原列表页保留→无返回需恢复）。review 追加修复：handler 在解析 anchor 后、写 returnContext 前新增 `if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;`——`target="_blank"` 新标签页打开与 `download` 属性下载均不导航原标签页，故原列表页保留、无返回需恢复（与修饰键 skip 同语义）。detail 页外链（证据原文链接）已有 `target="_blank"` 但 href 非 `/events/` 故原本就不触发；feed/theme/daily 卡链目前无 `target="_blank"`/`download`。该 skip 是 defense-in-depth（未来若详情链加 `target="_blank"`/`download`，handler 不再误写 returnContext）。
  resolution: 已于 Story 2.5 review 修复——handler 在 capture boundary 对 `anchor.target === "_blank"` 或 `anchor.hasAttribute("download")` 直接 skip（return），与既有修饰键 skip 同语义边界。无残留 defer。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-cross-surface-context-return-loop.md`
  summary: 浏览器原生 back/forward（history/bfcache）的 scroll 恢复未做——当前设计仅经显式 BackLink 点击恢复，浏览器 back 经原生 history 恢复 URL（filter 态）但不恢复 scroll
  evidence: Story 2.5 的 scroll 恢复一次性 `RESTORE_MARKER` 由 BackLink onClick 写入——即只有点击「← 返回」链（客户端导航）才触发 scroll 恢复。读者若用浏览器 back 按钮（history traversal / bfcache restore）从详情返回列表，filter 态（URL query）经原生 history 恢复（`?window=`/`?date=` 在 history entry 里），但 scroll 不恢复（无 marker——marker 仅由 BackLink 点击写；且 bfcache restore 可能不重新触发 React effect）。这是 UX-DR12「returning from detail to a list」的另一种返回方式（浏览器 back）下的 scroll 缺口；spec 的 AC 与机制显式聚焦 BackLink 点击路径（该路径已测全绿）。浏览器 back 的 scroll 恢复是独立、更难的 concern（Next App Router + scroll restoration 交互复杂）。
  resolution: 已于 Story 2.5 review 登记为 defer——待真实读者反馈「浏览器 back 不恢复 scroll」或 UX-DR12 扩展到 back 按钮路径时，评估加 `pageshow`（`event.persisted`）/ `history.scrollRestoration` 机制，或在 BackLink 之外让浏览器 back 也写 restoreMarker。V1 显式返回链已覆盖 UX-DR12 的测试返回路径。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-hot-event-and-theme-search.md`
  summary: 搜索引擎升级（Postgres FTS/tsvector + GIN、ILIKE SQL 下推、或专用搜索引擎）defer——V1 用 JS 内存子串匹配（沿用 1.7/2.2/2.3 in-memory filter 既定模式），真实查询负载出现前不引入 FTS
  evidence: Story 3.1 `searchPublished`（`packages/core/src/modules/search-read/search-service.ts`）并发取三个 filter-free sibling list fn（listPublishedHotEvents + listPublishedHotEventExplanations + listPublishedThemeMemberships），在 JS 内存做大小写不敏感子串匹配（`toLowerCase().includes()`）。epic-3-context 明示「Search engine choice is intentionally deferred: V1 may use PostgreSQL full-text capabilities and only adopt a dedicated search stack once real query load appears」。当前 `schema.prisma` 与全部 migration 零 FTS 痕迹；Postgres FTS 对中文需 zhparser/pg_jieba 扩展（默认 Postgres 无中文分词）；ILIKE 下推需改既有 filter-free fn 签名或新建 SQL 查询 fn。V1 published 体量极小（每次搜索三次全表读 + JS join），规模可接受。升级路径明确：把 `searchPublished` 内部换成 FTS/ILIKE，调用面（签名/返回类型）不变，页面与 e2e 无感。
  resolution: 已于 Story 3.1 登记为搜索引擎升级 defer——待真实查询负载出现（已发布集体量增长致搜索有可测延迟）时，把 `searchPublished` 内部换为 Postgres FTS（tsvector + GIN + zhparser/jieba 中文分词扩展 + 一个新 prisma migration）或 ILIKE SQL 下推或专用搜索引擎（Meilisearch/Algolia 等），调用面保持不变。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-hot-event-and-theme-search.md`
  summary: 搜索分页 / 高亮 / 搜索建议 / 搜索历史 defer——V1 一次返回全部分组命中、无高亮、无建议、无历史
  evidence: Story 3.1 `/search` 一次渲染全部分组命中（events + themes），无分页（V1 命中数极小）、无关键词高亮、无搜索建议（输入时下拉）、无搜索历史。epic-3-context 未列这些为 V1 AC。分页需引入结果计数上限 + 分页 UI；高亮需在 EventCard/FilterPill 内 dangerouslySet 或拆词渲染（不改组件本体的约束下不可行）；建议/历史需客户端状态或 user-profile 模块（3.2/3.3 own）。
  resolution: 已于 Story 3.1 登记为搜索 UX 丰富化 defer——待真实搜索负载反馈时，引入分页（结果上限 + 翻页）、关键词高亮（需 EventCard/FilterPill 扩展或包装）、搜索建议（客户端/服务端建议 API）、搜索历史（user-profile 关联）。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-hot-event-and-theme-search.md`
  summary: 搜索语料扩展（tags / whyItMatters / uncertainties / 证据 summary）defer——FR12 点名「标题、解释摘要、主题名称」三样；扩展语料到其他字段 defer
  evidence: Story 3.1 `searchPublished` 仅匹配三语料：(a) `published_hot_events.title`、(b) `published_hot_event_explanations.summary`（经新增 sibling `listPublishedHotEventExplanations`）、(c) `published_hot_event_themes.items[].label`（经 `listPublishedThemeMemberships`）。FR12 字面点名这三样。扩展到 `tags` / `whyItMatters` / `uncertainties` / 证据 `summary`（`published_hot_event_evidence.summary`）需 search-read 内加读 + 加匹配分支，且语料权重/分层需重新设计（tags 可能比 summary 更强或更弱）。epic-3-context 未列扩展为 V1。
  resolution: 已于 Story 3.1 登记为语料扩展 defer——待真实搜索反馈「想搜标签/为什么重要/证据原文」时，扩 `searchPublished` 读取范围 + 加匹配分支 + 重新设计语料权重分层。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-hot-event-and-theme-search.md`
  summary: 拼音 / 模糊匹配 defer——V1 仅做大小写不敏感精确子串匹配，中文无分词、无拼音、无编辑距离模糊
  evidence: Story 3.1 `searchPublished` 用 `haystack.toLowerCase().includes(q.toLowerCase())`。拉丁 toLowerCase 归一、中文子串字符级命中（无需分词）。但「xinpian」搜「芯片」（拼音）、「芯朋」搜「芯片」（编辑距离/模糊）不支持。拼音需引入 pinyin 转换库（pinyin-pro 等）+ 双向索引；模糊需编辑距离/相似度计算（成本高）。V1 无此需求。
  resolution: 已于 Story 3.1 登记为拼音/模糊 defer——待真实搜索反馈「想用拼音搜中文」或「想容错拼写」时，引入拼音转换 + 索引或模糊匹配（编辑距离/embedding 相似度）。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-hot-event-and-theme-search.md`
  summary: 全局 header 内联搜索框样式增强 / SearchBox 自动补全 defer——V1 搜索框在 NavList 内（原生 form），无 header 内联框、无自动补全
  evidence: Story 3.1 `SearchBox` 渲染在 `NavList` 顶部（桌面 aside + 移动抽屉），为原生 HTML form GET 提交。移动 header `h-16` 空间紧（汉堡+logo 占满），未在 header 内联搜索框（需重构 header 布局，回归面大）。SearchBox 无自动补全（输入时下拉建议）——需客户端状态 + 建议 API。V1 原生 form 足覆盖 AC3（键盘 Enter + 触控提交）。
  resolution: 已于 Story 3.1 登记为 header 内联框/自动补全 defer——待真实读者反馈「想在 header 直接搜」或「想要搜索建议下拉」时，评估 header 内联搜索框（重构 header 布局）+ 自动补全（客户端/服务端建议 API）。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-hot-event-and-theme-search.md`
  summary: 搜索→详情→返回的显式「返回搜索结果」入口与 bfcache 不可恢复兜底 defer（3.4 own）——3.1 仅扩 allowlist 使既有 BackLink 恢复搜索 URL，3.4 再补显式入口与不可恢复边案
  evidence: Story 3.1 把 `/search` 加入 `isValidListReturn` 的 `LIST_PATH_EXACT` allowlist（与 `/`、`/daily` 并列），使既有 `<BackLink/>` 经客户端导航从详情返回时恢复搜索 URL（query 保留）。但浏览器 back 经 bfcache 不可恢复时（`RESTORE_MARKER` 未写、bfcache restore 不重新触发 effect），scroll 可能丢；且 3.1 无独立「← 返回搜索结果」显式入口（语义复用「← 返回首页」BackLink，其文案在搜索来源下不变）。epic-3-context 明示「Story 3.4 ... search → detail → search return-path contract ... explicit back-to-search-results entry」归 3.4。
  resolution: 已于 Story 3.1 登记为 3.4 own——Story 3.4 补显式「返回搜索结果」入口（文案/图标区分搜索来源）+ bfcache 不可恢复边案（`pageshow`/`history.scrollRestoration` 机制），并加专属 e2e 断言。


- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-hot-event-and-theme-search.md`
  summary: 重复 `?q=` 查询参数（Next 16 `searchParams` 交付数组）未被守护——`/search?q=a&q=b` 时 `q` 为 `string[]`，当前 `parseSearchQuery(raw: string)` 不处理数组
  evidence: 全仓公共路由（home `?window=`、topics、daily `?date=`、search `?q=`）均用 `searchParams: Promise<{ x?: string }>` 模式，运行时 Next.js 对重复键交付 `string[]`。search 的 `parseSearchQuery` 类型为 `string`，若收到数组会落到非预期分支（trim 失败或空 query 态）。这是 project-wide 模式问题，非 search 独有。
  resolution: 在 search（或全仓公共路由）的 query 解析处统一 `Array.isArray(raw) ? raw[0] : raw` 归一。因波及所有公共路由，不在 3.1 单点修（避免不一致），留作 cross-cutting 统一处理。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-hot-event-and-theme-search.md`
  summary: 搜索匹配未做 Unicode NFC 归一化 / ZWJ-ZWNJ 剥离——粘贴自外部的组合字符序列（如 `e` + U+0301 vs 预组合 `é`）或含零宽连接符的 query 可能不命中预组合存储文本
  evidence: `search-service.ts` 的 `matchEvent`/`matchTheme` 仅做 `toLowerCase().includes()`，无 `normalize("NFC")`。AI 生成的 summary 通常为 NFC，但用户粘贴的带组合符 query 可能不命中，返回误导性无结果反馈。edge case，V1 影响面小。
  resolution: 在 `qLower` 计算前对 query 与 haystack 做 `NFC` 归一（+ 可选剥离 ZWJ/ZWNJ/U+FEFF）。低优先，按真实不命中报告再引入。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-hot-event-and-theme-search.md`
  summary: 主题 slug 规范性未校验——case-fold 后相同或含 URL 歧义字符（`/`、`%2F`）的 slug 会在聚合时分别成键却指向同一主题
  evidence: `search-service.ts` 主题聚合以 `item.slug` 为键，未校验 `/^[a-z0-9-]+$/`。V1 slug 来自 StubThemeAdapter（确定性、规范），但未来真实主题源可能引入大小写/歧义 slug。当前 FilterPill 用 `encodeURIComponent`，但 `/topics/[slug]` 路由匹配可能只命中其一。
  resolution: 在主题聚合处加 slug 规范性校验（跳过非法 slug），或归一化 slug。低优先，待真实主题源落地。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-hot-event-and-theme-search.md`
  summary: `list-context-memory.tsx`（2.5 基建）捕获的 `RETURN_CONTEXT` href 无长度上限——超长 `?q=` 会被原样写入 sessionStorage 并由 BackLink 渲染为超长 href
  evidence: 3.1 把 `/search` 加入返回 allowlist 后，搜索→详情跳转的 `RETURN_CONTEXT` 含完整 `?q=`。`writeReturnContext` 无长度 cap；恶意/超长 query 会写入 sessionStorage 并渲染为超长 href（sessionStorage 配额 ~5MB 容忍，但 URL 栏/导航笨重）。2.5 基建行为，非 3.1 引入，search 使其可被触发。
  resolution: 在 `writeReturnContext`/`writeScroll` 加 href 长度 cap（如 > 2048 则不写或截断 query 部分）。属 2.5 基建增强，低优先。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-hot-event-and-theme-search.md`
  summary: sessionStorage scroll-key 无淘汰——读者频繁换不同搜索词会为每个 `?q=` 变体积累一条 scroll 槽
  evidence: `list-context-memory.tsx` 的 `scrollKey(href)` 以完整 href（含 `?q=`）为键，每个不同搜索词一条 sessionStorage 条目，无 LRU/容量上限。极端使用可逼近 sessionStorage 配额（超限被 try/catch 静默禁用恢复）。2.5 基建行为，会话级（关 tab 清），3.1 搜索使其更易累积。
  resolution: 给 sessionStorage scroll 槽加 LRU 淘汰或上限。属 2.5 基建增强，低优先。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-hot-event-and-theme-search.md`
  summary: `/search` 页 `metadata.title` 固定为「搜索」——多个搜索标签页不可区分
  evidence: `search/page.tsx` 用静态 `export const metadata = { title: "搜索" }`，不反映 `?q=`。读者开 `?q=芯片` 与 `?q=稀土` 两个标签页均显示「搜索」，无法区分（query 在 URL 但不在标题）。
  resolution: 改用 `generateMetadata({ searchParams })` 返回 `搜索：{q}`（q 非空时）。nice-to-have，低优先。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-hot-event-and-theme-search.md`
  summary: AD-3 读作用域不变式（`listPublishedHotEventExplanations` 只读 `published_*`、不读 `explanation_versions`/`hot_events`/`evidence_*`）当前不可机器验证
  evidence: 仓内无 `packages/core`/web 组件单测 runner，无 prisma query spy / schema 级守卫测试。AD-3 读作用域仅存于 docstring + 模块注释。takedown 测试与「只读 published_*」一致，但不能证明读作用域（一个也读 `explanation_versions` 的实现仍能通过现有测试，只要 published 行存在）。
  resolution: 引入 `packages/core` 单测 runner（vitest）+ prisma query spy，或架构层 lint 规则守卫 publish-orchestrator 的读作用域。跨 story 基建投入，低优先。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-delayed-login-follow-action.md`
  summary: 真实凭证 auth（密码 / OAuth / magic-link / 邮箱验证）+ identity provider 选型未落地——V1 会话为纯 HMAC 签名 cookie（无凭证），登录动作 = 建账号 + 设 cookie
  evidence: Story 3.2 的 `user_accounts` 表只有 id + 时间戳，无密码哈希 / OAuth subject / email 列。会话 = `aguhot:session=accountId.hmac`（Node `crypto.createHmac` + `timingSafeEqual`，零依赖）。登录动作（`startSessionAndFollow`）= 建 `UserAccount` 行 + 设签名 cookie + 写 follow，无任何凭证校验。升级路径：真实 auth 落地时 `UserAccount` 加 credential 列，`createSession`/`readSession` 替换为凭证校验，follow 域逻辑与 FollowButton 调用面不变。deferred 到后续 epic。
  resolution: 已于 Story 3.2 登记为真实凭证 auth defer——待真实 identity provider（next-auth/Auth.js/lucia 或自建）选型落地时，替换 session helper + 加 credential 列，follow 调用面无感。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-delayed-login-follow-action.md`
  summary: `/favorites` 列表 / 管理 / 空态 / 离线标注（3.3 own）——3.2 仅保 `/favorites` 匿名可达占位 + 微调文案
  evidence: Story 3.2 的 `/favorites/page.tsx` 仍为结构性占位（静态服务端组件，不读 session / 不读 follow），仅微调文案反映「收藏能力已就绪，列表将在后续开放」。follow 列表 UI（读 `listFollows` + 渲染卡片 + 离线/下线标注 + 管理/取消）归 Story 3.3。3.2 不建列表，3.3 own。
  resolution: 已于 Story 3.2 登记为 3.3 own——Story 3.3 落地 `/favorites` 列表 UI（读 `listFollows` + 渲染 + 离线标注 + 管理）。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-delayed-login-follow-action.md`
  summary: follow target 存在性校验（下线事件 follow 行的离线展示）defer——3.2 不读 published 校验 follow 目标存在
  evidence: Story 3.2 的 `follow_targets` 行按 id 字符串引用 published_hot_events.id / theme slug，**不**外键约束、**不**校验存在性。下线事件的 follow 行仍在（`refreshPublishedReadModel(takedown)` 删 published_* 不影响 follow_targets）。3.2 的 follow 读/写不校验目标是否存在（AC 不要求）。3.3 watchlist 列表需读 published_* 比对，标注「离线」状态（NFR2：watchlist 须明确标注离线 item，绝不伪装为 live）。
  resolution: 已于 Story 3.2 登记为 3.3 范围——Story 3.3 watchlist 读 `listFollows` + 比对 published_* 存在性，标注离线。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-delayed-login-follow-action.md`
  summary: 账号资料 / 偏好 / 账号删除 / 多设备账号合并 defer——V1 账号为纯 id，无资料/偏好/删除/合并
  evidence: Story 3.2 的 `UserAccount` 表只有 id + createdAt + updatedAt，无资料列（昵称/头像）、无偏好列、无软删/硬删、无设备/会话列表。多设备登录同一账号 = 同一 cookie 值（cookie 可跨设备复制，无设备绑定）。账号合并（两个 UserAccount 合一）无机制。真实账号体系随凭证 auth（见上 defer）落地时一并设计。
  resolution: 已于 Story 3.2 登记为账号体系 defer——待真实 auth 落地时，加资料/偏好列 + 账号删除流程 + 多设备会话管理 + 账号合并机制。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-delayed-login-follow-action.md`
  summary: 关注数量展示 / 通知 / 推送 defer——V1 无关注计数、无通知/推送
  evidence: Story 3.2 不渲染关注数量（`listFollows` 返回行但不计数展示）、无通知/推送基建（无 WebSocket/SSE/邮件通知）。关注事件的更新通知（事件有新证据时提醒关注者）是独立 concern，需通知基建（worker 触发 + 通知渠道 adapter）。epic-3-context 未列通知为 V1。
  resolution: 已于 Story 3.2 登记为通知 defer——待通知基建（WebSocket/SSE/邮件/push）落地时，加关注事件更新通知 + 关注计数展示。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-delayed-login-follow-action.md`
  summary: 会话旋转 / 续期 / 吊销 + SESSION_SECRET 轮换策略 defer——V1 会话为固定 90 天 HMAC cookie，无旋转/续期/吊销，SECRET 轮换需全员重登
  evidence: Story 3.2 的 `createSession` 设固定 90 天 maxAge cookie，无续期（每次请求不刷新）、无旋转、无服务端吊销列表（cookie 是无状态的，无法单点失效除非改 SECRET）。`SESSION_SECRET` 轮换 = 所有现有 cookie 立即失效（签名不再匹配 → 全员降级匿名 → 需重登）。真实 session 治理（服务端 session store、旋转、吊销）随凭证 auth 落地。
  resolution: 已于 Story 3.2 登记为 session 治理 defer——待真实 auth + 服务端 session store 落地时，加会话旋转/续期/吊销 + SECRET 轮换兼容窗口（双 SECRET 重叠期）。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-delayed-login-follow-action.md`
  summary: CSRF 显式 token defer——3.2 依赖 Next server action 内置 Origin 校验，无显式 CSRF token
  evidence: Story 3.2 的 `toggleFollow` / `startSessionAndFollow` 是 Next server actions（`"use server"`），Next 16 对 server action POST 自带 Origin 校验（拒绝跨站 forged POST）。3.2 依赖该内置校验，不引入显式 CSRF token（double-submit / SameSite=Strict 已由 cookie SameSite=Lax 部分覆盖）。显式 CSRF token（更严格 / 兼容性更好）defer。
  resolution: 已于 Story 3.2 登记为 CSRF defer——待安全审计要求或凭证 auth 落地时，加显式 CSRF token（double-submit cookie 或同步 token pattern）。当前 SameSite=Lax + Next Origin 校验是足够的地板。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-delayed-login-follow-action.md`
  summary: toggleFollow 读-后-写并发竞态 defer——同一用户跨 tab/双击并发 toggle 可能 A 跟随 B 取消致状态翻转两次
  evidence: `toggleFollow` (`apps/web/app/(public)/_actions/follow-actions.ts`) 先 `isFollowing` 读后条件 `followTarget`/`unfollowTarget` 写，无事务/锁。客户端 `pending` flag 防同按钮双击，但跨 tab 或直接并发 POST 两个 toggle 可交错（A 读 false→follow，B 读 true→unfollow），最终态偏离用户单次点击意图。`followTarget` 的 `@@unique` + `findFirst` 幂等保证不重复行，但不防 toggle 翻转竞态。V1 单用户单 tab 体量下不可达；与 1.9 「非原子跨步 defer」同型。
  resolution: 已于 Story 3.2 登记为并发 defer——待真实并发 toggle 负载（多 tab / 自动化客户端）出现时，用 `prisma.$transaction` + serializable 隔离或 SELECT...FOR UPDATE 包住 isFollowing+follow/unfollow。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-delayed-login-follow-action.md`
  summary: startSessionAndFollow 三步非原子 defer——createAccount+createSession 成功但 followTarget 抛错时留下孤儿账号+已设 cookie 但零收藏
  evidence: `startSessionAndFollow` 顺序 `createAccount` → `createSession`（设 cookie）→ `followTarget`，三步无 `prisma.$transaction`。若 followTarget 抛错（DB 写失败），账号已建 + cookie 已设但无 follow 行——用户点「登录并收藏」只得到登录未得到收藏。仅在中途 DB 错误（loud failure 场景）下发生，可恢复（再次收藏）。V1 不阻断。
  resolution: 已于 Story 3.2 登记为原子性 defer——待真实账号清理/一致性需求出现时，三步包事务或在 followTarget 失败时 `clearSession()` + 标记账号待清理。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-delayed-login-follow-action.md`
  summary: readSession 不校验账号存在性 defer——HMAC 合法但 user_accounts 行已删的 cookie 仍被视为有效会话
  evidence: `apps/web/lib/session.ts` 的 `readSession()` 仅校验 HMAC 签名，不查 `user_accounts` 行是否存在（`tryGetAccount` 已实现但未接入）。V1 无账号删除流程（defer），故不可达。未来账号删除/清理落地后，已删账号的 cookie 仍验签通过 → 用户看似已登录但收藏全失（FK cascade 删了 follow_targets），页面渲染 following=false 无重新认证提示。
  resolution: 已于 Story 3.2 登记为 defense-in-depth defer——待账号删除/吊销流程落地时，在 readSession 后调 `tryGetAccount`，null 则视为匿名（并清 cookie）。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-delayed-login-follow-action.md`
  summary: createSession secure 标志读裸 process.env.NODE_ENV defer——误配 prod（NODE_ENV 非 "production"）时 cookie 无 Secure 可被中间人嗅探
  evidence: `apps/web/lib/session.ts` 的 `createSession` 用 `secure: process.env.NODE_ENV === "production"` 直接读裸 env，未走 `@aguhot/config` 校验过的 env schema（schema 默认 NODE_ENV=development）。Next 自身可靠地设 NODE_ENV，实际风险低，但与「配置经 env schema 注入」约定不一致。
  resolution: 已于 Story 3.2 登记为硬化 defer——读校验过的 env（或显式非生产 flag），并默认 Secure:true。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-delayed-login-follow-action.md`
  summary: theme slug 无字符集约束 defer——assertValidFollowRef 仅校验非空+长度，未限字符集（控制符/`/`/`..`/换行可通过）
  evidence: `follow-service.ts` 的 theme 分支只校验空 + ≤128，无 slug 字符集白名单。V1 slug 来自运营管线/已发布主题（非公开输入），非信任边界；`revalidatePath` 用 `encodeURIComponent` 中和注入。若未来 slug 变用户定义则成攻击面。
  resolution: 已于 Story 3.2 登记为 defer——待 slug 变用户定义或观察到滥用时，加 slug regex（如 `/^[a-z0-9-]+$/i`）。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-delayed-login-follow-action.md`
  summary: feed follow 状态读无缓存预算 defer——每个登录访客每次 `/` 导航（含 filter searchParams 变更）都跑一次 listFollowedTargetIds
  evidence: `apps/web/app/(public)/page.tsx` 登录态下对每次请求跑 `listFollowedTargetIds`（批量取该用户 hot_event follow id 集合），与既有重 published 读同路径，无缓存。`revalidatePath("/")` 重跑整页含此读。V1 体量可接受。
  resolution: 已于 Story 3.2 登记为 scale defer——待 feed 流量增长时，引入 follow 状态读缓存 + 按 follow 写事件失效。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-delayed-login-follow-action.md`
  summary: 跨 tab/跨设备 follow 态实时同步 defer——FollowButton useState 在 revalidatePath 后已同步同账号 prop，但跨 tab/跨设备的远端状态变更不实时推送
  evidence: patch 已修同一挂载内 props 变更同步（React 19 渲染期 state 调整模式）。但另一 tab/设备改变了同一 item 的 follow 态，当前 tab 的已挂载 FollowButton 不会主动刷新（需导航/revalidate）。V1 单用户单 tab 假设。
  resolution: 已于 Story 3.2 登记为实时性 defer——待多设备/实时同步需求出现时，引入 BroadcastChannel / SWR 轮询 / WebSocket 推送。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-delayed-login-follow-action.md`
  summary: dialog role=alert 作用域 defer——error state 在 dialog 关闭后其 `<p role="alert">` 仍留 DOM，SR 可能播报过期错误
  evidence: `follow-button.tsx` 的错误 `<p role="alert">`（含 dialog 内 + patch 新增的外部）在 error state 非空时即渲染，不随 dialog open/close 切换。dialog 关闭后若 error 未清，SR 仍可能播报。
  resolution: 已于 Story 3.2 登记为 a11y defer——dialog 关闭时（onClose）清 error state，或仅在 dialog open 时渲染内部 alert。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-delayed-login-follow-action.md`
  summary: showModal 旧浏览器特性检测 defer——`<dialog>.showModal()` 在无该 API 的旧引擎上调用抛 TypeError
  evidence: `follow-button.tsx` 用 `dialogRef.current?.showModal()`，`?.` 仅防 ref null，不防方法缺失。无 HTMLDialogElement.showModal 的旧浏览器（已罕见）会抛 TypeError 而非降级。Next 16/React 19 目标浏览器普遍支持 `<dialog>`。
  resolution: 已于 Story 3.2 登记为兼容性 defer——待需支持旧引擎时加特性检测 + fallback（如 alert/自定义模态）。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-delayed-login-follow-action.md`
  summary: migration updated_at 无 DEFAULT defer——直接 SQL INSERT（非 Prisma）不供 updated_at 时违反 NOT NULL
  evidence: `20260711030000_add_user_profile_follow/migration.sql` 的 `user_accounts.updated_at` 是 NOT NULL 无 DEFAULT（Prisma `@updatedAt` 在 app 层设值）。raw SQL insert（运维脚本/数据迁移）会失败；与同表 `created_at DEFAULT CURRENT_TIMESTAMP` 不一致。
  resolution: 已于 Story 3.2 登记为 schema 一致性 defer——若引入非 Prisma 写路径，给 updated_at 加 `DEFAULT CURRENT_TIMESTAMP`（或 `ON UPDATE` 触发器）。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-delayed-login-follow-action.md`
  summary: seed-follow 直接运行检测跨平台 defer——`import.meta.url === \`file://${process.argv[1]}\`` 在 Windows/符号链接 tsx 下可能失效
  evidence: `apps/web/e2e/seed-follow.ts` 的直接运行守卫用 `import.meta.url` 与 `process.argv[1]` 字符串比较，Windows 路径分隔符/符号链接 tsx runner 下可能不匹配（沿用既有 seed 脚本先例）。仓库其他 seed 同模式，故一致但同脆弱。
  resolution: 已于 Story 3.2 登记为健壮性 defer——待跨平台运行需求时，换 `pathToFileURL` 归一比较。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-delayed-login-follow-action.md`
  summary: defer 项未从代码注释回链 defer——session.ts/follow-service.ts 等注释说「真实 auth defer」但无 deferred-work 锚点
  evidence: 代码注释多处提「deferred to a later epic」，但未指回 `deferred-work.md` 具体条目，读者须 grep + 猜匹配。不影响行为。
  resolution: 已于 Story 3.2 登记为可追溯性 defer——后续在 defer 相关注释加 source_spec/条目锚点。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-delayed-login-follow-action.md`
  summary: AC2 跨会话 returning-user 一致性未 e2e 驱动 defer——cross-page e2e 在同一 fresh context 内重登录后导航，未断言「上一会话 cookie 的 returning 用户」跨独立页面加载的一致性
  evidence: `follow.spec.ts` 的 AC2 跨页测试在 serial fresh context 内重新走登录流程后导航 feed/theme 证 SSR 读一致，但未驱动「带上一会话 cookie 直接访问」的 returning 用户路径。底层不变量（listFollowedTargetIds 与 isFollowing 读同一持久行）已被覆盖，仅 returning-user 字面路径未单独驱动。
  resolution: 已于 Story 3.2 登记为测试完整性 defer——待需要时加 returning-user cookie 注入的跨页一致性用例。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-delayed-login-follow-action.md`
  summary: Story 3.2 验证 opt-in 未入聚合/CI 门 defer——`e2e:follow` 与 `verify:follow-logic`/`verify:follow-ref` 仅手动触发，默认 `pnpm --filter web e2e` 经 --grep-invert 排除 @follow
  evidence: 根 `package.json` 无 verify 聚合脚本、无 `.github/workflows`、无 turbo.json，bmad-loop gate `commands=[]`。`pnpm --filter web e2e` 默认 `--grep-invert "...|@follow"` 故不跑 @follow；`pnpm --filter core verify:follow-logic` / `pnpm --filter web verify:follow-ref` 须显式调。与 spec-1-1/1-4/2-x 既有「e2e/verify 未接入自动化门」defer 同根。
  resolution: 已于 Story 3.2 登记为 CI defer——待平台 CI/turbo 门就绪时，把 e2e:follow + verify:follow-logic + verify:follow-ref（+ PG/Redis service container）一并接入。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-delayed-login-follow-action.md`
  summary: toggleFollow 无 session 守卫未被执行测试 defer——`if (session === null) throw` 仅代码阅读覆盖，下游 session.accountId null-deref 兜底
  evidence: `follow-actions.ts` 的 `toggleFollow` 无 session 抛 domain error 的守卫，无任何测试执行（e2e 总先登录；selfcheck 不触 Next runtime）。但下游 `session.accountId` 解引用会 null-deref 成 500 而非静默匿名写，故最坏只是错误码更差，非静默数据写。矩阵行 9 经纯层不变量（assertValidFollowRef arity）间接覆盖。
  resolution: 已于 Story 3.2 登记为测试 defer——待加 server action 直发匿名 POST 的可驱动测试（需稳定 action_id）时覆盖。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-delayed-login-follow-action.md`
  summary: /favorites 文案未 e2e 断言 defer——body copy 从占位改为「已可在详情/主题页收藏」，但 e2e 仅断言 200 + H1「收藏」
  evidence: `follow.spec.ts` 的 `/favorites` 匿名测试仅断言 HTTP 200 + H1 heading，不断言 body 文案。文案回退/损坏不会被捕获。低风险（散文非行为契约）。
  resolution: 已于 Story 3.2 登记为测试 defer——若该文案成契约一部分，加文本断言；否则保持。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-watchlist-and-revisit-management.md`
  summary: 关注数量统计 / 通知 / 推送 defer——V1 watchlist 不渲染关注计数、无通知/推送基建
  evidence: Story 3.3 的 `/favorites` 列表渲染全部 follow 行（一次 `listFollows` 全量），不展示「关注 N 个热点 / M 个主题」计数，无关注事件更新通知（无 WebSocket/SSE/邮件/push 基建）。epic-3-context 未列通知/计数为 V1 AC。关注事件的更新通知（事件有新证据/解释修订时提醒关注者）需独立通知基建（worker 触发 + 通知渠道 adapter），与 3.2 登记的通知 defer 同根。
  resolution: 已于 Story 3.3 登记为通知/计数 defer——待通知基建（WebSocket/SSE/邮件/push）落地时，加关注事件更新通知 + 关注数量展示。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-watchlist-and-revisit-management.md`
  summary: 批量管理 / 排序 / 筛选 / 分页 defer——V1 watchlist 单页全量按 createdAt desc，无批量 unfollow/排序 toggle/筛选/分页
  evidence: Story 3.3 `/favorites` 一次渲染全部 follow（live + offline），排序固定 createdAt desc（最近收藏在前），无批量 unfollow（「清除全部已下线」控件）、无排序 toggle（按标题/时间/kind）、无筛选（仅看事件/主题/已下线）、无分页。epic-3-context 明示「V1 关注量小，一次 listFollows 全量渲染」。批量管理/排序/筛选/分页 defer。
  resolution: 已于 Story 3.3 登记为批量管理/排序/筛选/分页 defer——待真实关注量增长至单页过长或用户反馈「想批量清理已下线」时，加批量 unfollow + 排序 toggle + 筛选 + 分页（或无限滚动）。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-watchlist-and-revisit-management.md`
  summary: watchlist 读缓存预算 defer——每个登录访客每次 `/favorites` 导航都跑三读（listFollows + listPublishedHotEvents + listPublishedThemeMemberships），无缓存
  evidence: Story 3.3 `/favorites` force-dynamic 请求期跑三个全表读 + JS join（resolveWatchlistView），无缓存。`revalidatePath` 重跑整页含三读。V1 体量可接受（published 行数极小、单用户 follow 行数极小）。与 1.7 feed 全表读 + 2.2 关联全表读 + 2.3 主题全表读同模式 defer。
  resolution: 已于 Story 3.3 登记为 scale defer——待 watchlist 流量增长时，引入 published 读缓存 + 按 follow 写事件失效（或按用户 follow 集 cache-key）。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-watchlist-and-revisit-management.md`
  summary: 跨 tab / 跨设备 watchlist 实时同步 defer——一 tab unfollow 后另一 tab/设备的 `/favorites` 不主动刷新
  evidence: Story 3.3 watchlist 是 force-dynamic 请求期读，无 WebSocket/SSE 实时推送。读者在 tab A unfollow 一个事件后，tab B 的 `/favorites` 仍显示该项（需导航/刷新才同步）。与 3.2 FollowButton 跨 tab 同步 defer 同根。V1 单用户单 tab 假设。
  resolution: 已于 Story 3.3 登记为实时性 defer——待多设备/实时同步需求出现时，引入 BroadcastChannel / SWR 轮询 / WebSocket 推送。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-watchlist-and-revisit-management.md`
  summary: offline 项批量清理 defer——V1 须逐项点 FollowButton 清理已下线项，无「一键清除全部已下线」控件
  evidence: Story 3.3 offline 组的每项挂 FollowButton（逐项 unfollow），无批量清除控件。读者积累大量已下线 follow 时须逐项点击。批量清除控件（「清除全部已下线」按钮 + 确认）defer（与批量管理 defer 同根）。
  resolution: 已于 Story 3.3 登记为批量清理 defer——待真实读者反馈「想一键清除已下线」时，加批量 unfollow server action + 确认控件。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-watchlist-and-revisit-management.md`
  summary: theme slug 字符集校验 defer——resolveWatchlistView 的 theme 离线判定按 slug 精确匹配，大小写/Unicode/首尾空白不一致会静默归类为 offline
  evidence: Story 3.3 `resolveWatchlistView` 的 `themeLabelBySlug` Map 按 slug 精确匹配。若 follow 记录的 slug 与 published membership 的 slug 存在大小写/首尾空白/NFC 差异，follow 会被静默归类为 offline（即使主题仍在线）。沿用 3.1 搜索 slug 规范性 + 3.2 theme slug 字符集 defer。V1 slug 来自 StubThemeAdapter（确定性、规范），故不可达；真实主题源 slug 质量不可控时存在风险。
  resolution: 已于 Story 3.3 登记为 slug 归一化 defer（沿用 3.1/3.2）——真实主题源引入时，在 slug 匹配前做归一化（trim + NFC + 可选 casefold），与 3.1 搜索 slug 规范性一并统一处理。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-watchlist-and-revisit-management.md`
  summary: `listFollows` 分页 defer——V1 返回该用户全部 follow 行，关注量增长后单用户 follow 集膨胀会成为瓶颈
  evidence: Story 3.3 `/favorites` 用 `listFollows`（无 where filter、无分页）返回该用户全部 follow 行。V1 单用户 follow 行数极小（读者少量收藏）；真实重度用户（关注数百+项）的全量读 + 内存 join + 全量渲染会成瓶颈。与 1.7/2.2/2.3 全表读 scale ceiling 同型 defer，但 listFollows 是 per-user 而非 global。
  resolution: 已于 Story 3.3 登记为 listFollows 分页 defer——待真实重度用户关注量增长时，给 listFollows 加分页（cursor 或 offset）+ watchlist 分页 UI。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-watchlist-and-revisit-management.md`
  summary: 真实 auth 落地后 watchlist 与账号资料/偏好关联 defer——V1 账号为纯 id，watchlist 无账号资料/偏好展示
  evidence: Story 3.3 `/favorites` 不渲染账号资料（昵称/头像）、无偏好设置（通知偏好/语言/时区）。`UserAccount` 表只有 id + 时间戳（3.2 设计）。真实 auth 落地后，watchlist 页可加账号资料 header + 偏好设置入口（与 3.2 账号体系 defer 同根）。
  resolution: 已于 Story 3.3 登记为账号体系关联 defer——待真实 auth 落地时，watchlist 加账号资料 header + 偏好设置入口（随 3.2 账号体系 defer 一并设计）。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-watchlist-and-revisit-management.md`
  summary: `resolveWatchlistView` 全量 published 读的伸缩上限 defer——三读（listFollows + listPublishedHotEvents + listPublishedThemeMemberships）均为全表读 + JS join，已发布集/单用户 follow 集增长后成瓶颈
  evidence: Story 3.3 `resolveWatchlistView` 接收三个全量数组（该用户全部 follow + 全部 published events + 全部 published theme memberships），在 JS 内存做 Map 索引 + diff。V1 published 体量极小（每次 /favorites 导航三读 + JS join）；已发布集增长后（数千+事件/主题）+ 单用户重度 follow（数百+项）的全量读 + 内存 join 会成瓶颈，需改 SQL JOIN 或增量读（只读该用户 follow 的 id 对应的 published 行）。沿用 1.7/2.2/2.3 全表读 scale ceiling 同型 defer。
  resolution: 已于 Story 3.3 登记为 scale ceiling——待已发布集/单用户 follow 集增长至三读 + JS join 有可测延迟时，把 published 读下推为 SQL JOIN（follow 的 id IN (...) → published 行存在性检查）或增量读（只读 follow 命中的 published 行）。


- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-watchlist-and-revisit-management.md`
  summary: watchlist a11y 基线 defer——标题层级（section h2「关注中」与每个 EventCard 内的 h2 同级）、offline FollowButton aria-label 不区分在线/下线、`<ul>` 未用 aria-labelledby 显式关联 h2
  evidence: Story 3.3 review (adversarial) 指出 `/favorites` 的 live section h2「关注中」与复用的 EventCard 内每卡 h2 同级（screen reader 无法区分 section 标签与 item 标题）；offline 行的 FollowButton aria-label 与 live item 相同（下线状态仅靠前置「已下线」文本 + 视觉传达，按钮 accessible name 不携带状态）；live/offline `<ul>` 仅靠 `<section>` DOM 嵌套隐式关联 h2。这些属 Story 3.5（公开页面语义与键盘可达基线）/3.6（触控热区与减少动态效果）跨切面 a11y 基线 scope——本 story 复用既有 EventCard h2 模式（home feed 同构），未单独修。
  resolution: 已于 Story 3.3 review 登记为 a11y defer——随 Story 3.5/3.6 a11y 基线统一处理（EventCard 标题层级调整跨 home/feed/watchlist；offline FollowButton aria-label 携带下线状态；`<ul>` aria-labelledby 显式关联）。本 story 不单独改（避免越 3.5/3.6 scope 与 EventCard 跨面回归）。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-watchlist-and-revisit-management.md`
  summary: `verify:*` selfcheck 未接入 CI/precommit defer——`verify:watchlist`/`verify:session-cookie`/`verify:follow-ref`/`verify:cluster-logic` 等纯 selfcheck 脚本仅手动运行，无 CI workflow / git hook / 根 `verify` 聚合脚本驱动
  evidence: Story 3.3 review (verification-gap) 指出 `verify:watchlist`（钉 AC3 离线归类）与新增 `verify:session-cookie`（钉 mint/verify 回环、防 sign() twin 漂移）在全仓 grep 仅命中 package.json 脚本行 + 自身注释，repo 无 `.github/`、无 `.husky/`、根 `package.json` 仅 build/typecheck/lint/format——selfcheck 回归只能靠开发者记得手动跑。这是 repo-wide 既有约定（`verify:follow-ref` 等同为手动），非 3.3 引入。
  resolution: 已于 Story 3.3 review 登记为 repo-wide verify 接入 defer——待 CI/hook 基建引入时，把所有 `verify:*` selfcheck 聚合进根 `verify`/`test` 脚本 + precommit/CI，使 AC3 离线归类与 session-cookie 回环等关键不变量自动运行。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-4-search-results-to-detail-return-loop.md`
  summary: 显式入口的来源感知仅覆盖 search origin——home/theme/daily 来源仍渲「返回首页」label（href 恢复该来源，仅 label 不区分）；未来可把来源感知 label 扩到这三类来源
  evidence: Story 3.4 BackLink 的 `searchLabel` prop + `isSearchReturn` 仅区分「搜索来源」vs「其他」。从 `/?window=7d`/`/topics/{slug}`/`/daily?date=D` 进详情时，href 仍正确恢复该来源 URL（2.5 字节不变），但 label 仍是通用「返回首页」（未变成「返回首页（7 日窗口）」/「返回主题」/「返回日报」）。AC2 与 epic 仅点名 search 须有显式「返回搜索结果」入口；home/theme/daily 的显式 label 未被要求，且扩到这三类会动 2.5 loop.spec 对 home/theme/daily origin 的 label 断言（当前断言「返回首页」），扩大 3.4 回归面。故本 story 仅 search 来源做来源感知 label。
  resolution: 已于 Story 3.4 登记为 label 扩展 defer——待真实用户反馈「想从 label 直接看出自己是从首页窗口/主题/日报进来的」时，给 BackLink 再增 `homeLabel`/`themeLabel`/`dailyLabel` 可选 prop + 对应 `isHomeReturn`/`isThemeReturn`/`isDailyReturn` 谓词（或泛化 `originLabel` + origin 分类），并同步更新 loop.spec 的 label 断言。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-4-search-results-to-detail-return-loop.md`
  summary: bfcache / browser-back 的通用 scroll 恢复（`history.scrollRestoration` / `pageshow`）未做——3.4 的「bfcache 不可恢复兜底」= 显式入口本身（页面级、history 无关），不扩张到改 history 语义
  evidence: Story 3.4 落地的 AC2 「bfcache 不可恢复兜底」= 一个页面级真实 `<a href="/search?q=…">`（不依赖 bfcache、不依赖 history state、刷新后仍在）。2.5 deferred-work 已把「浏览器 back 经 history 恢复 URL 但不恢复 scroll」列为通用机制 defer（适用 home/theme/daily/search 全部列表面，非搜索专属）。3.4 不扩张到改 history 语义（`history.scrollRestoration = "manual"` + `pageshow` eventpersisted 检测 + 手动 scroll 恢复），保持 ponytail + 不破坏 2.5 depth cap 与回归面。当前显式 BackLink 点击路径已恢复 scroll（2.5 marker），浏览器 back 仅恢复 URL 不恢复 scroll——后者是跨列表面通用 defer。
  resolution: 已于 Story 3.4 登记为通用 history scroll 恢复 defer（沿用 2.5）——待真实用户反馈「浏览器 back 后 scroll 丢失」频次较高时，在 `<ListContextMemory/>` 加 `history.scrollRestoration` + `pageshow` 监听做跨列表面通用 scroll 恢复（非搜索专属）。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-4-search-results-to-detail-return-loop.md`
  summary: label 内回显裸 query 文本（如「返回搜索结果「芯片」」）未做——href 已带 query 满足「带回原查询词」，label 回显是 UX 噪音 + 长 query 撑坏布局
  evidence: Story 3.4 AC2 「该入口带回原查询词而不是空白搜索页」由 href `/search?q=芯片` 满足（点进去就是该 query 的结果页）。在 label 文案里再回显「返回搜索结果「芯片」」是 UX 噪音，且长 query（近 128 字符，`parseSearchQuery` 的 `MAX_QUERY_LEN`）会撑坏返回链布局/截断。故 3.4 label 为静态「返回搜索结果」（不回显裸 query）。
  resolution: 已于 Story 3.4 登记为 label query 回显 defer——待真实设计需求出现「想在 label 里看到自己搜了什么」时，考虑：(1) 截断回显（`q.slice(0, 8) + "…"`）或 (2) tooltip/title 属性携带完整 query（不撑布局，SR 可读），需设计评审布局影响。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-4-search-results-to-detail-return-loop.md`
  summary: `isSearchReturn` 纯函数无 selfcheck / 未接入 CI——信任边界分类逻辑（origin 等值 + pathname 精确）仅由 e2e 间接覆盖，无纯单测快速回归
  evidence: Story 3.4 的 `isSearchReturn` 是 `list-context-memory.tsx` 内导出的纯函数（6 行核心逻辑），与 `isValidListReturn` 同套路。`search-return.spec.ts` 的信任边界测试（`/search//evil.com`、`/search/../console`）间接验证了「拒」，但需 live PG + playwright + dev server 才能跑，反馈慢。repo 无纯单测层（core 的 `*.selfcheck.ts` 惯例仅 core 包，web 包无对应），故 `isSearchReturn` 无快速纯单测。与 spec-3-3 review 的「repo-wide verify 接入 defer」同根。
  resolution: 已于 Story 3.4 登记为 selfcheck defer——待 web 包引入纯单测基建（或把 `list-context-memory.tsx` 的纯函数抽到 core 包享 selfcheck 惯例）时，给 `isSearchReturn` 加纯单测覆盖：精确 `/search` true、`/search?q=…` true、`/search/../console` false、`/search//evil.com` false、`https://evil.com` false、空/畸形 false。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-4-search-results-to-detail-return-loop.md`
  summary: 多级返回栈 / 面包屑 / 前进恢复未做——沿用 UX-DR12 一层深度上限；详情→列表→详情→列表 的多层返回栈 defer
  evidence: Story 3.4 BackLink 仍是 UX-DR12 一层深度（2.5 depth cap）：只记录最近一跳「列表→详情」的来源。读者若 详情→BackLink→列表A→详情→BackLink→列表B→详情，第三次 BackLink 只回到列表 B（最近一跳），不回到列表 A（多层栈）。面包屑（「首页 > 搜索 > 详情」）与前进恢复（「返回后再前进回详情」）亦 defer。AC1/AC2 仅要求单层稳定返回，多层栈超 3.4 scope。
  resolution: 已于 Story 3.4 登记为多级返回栈 defer（沿用 2.5）——待真实用户反馈「想沿原路多层返回」时，引入 sessionStorage 栈（push 来源 URL + pop on BackLink click）或面包屑组件，需同步扩 UX-DR12 depth cap 约定。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-4-search-results-to-detail-return-loop.md`
  summary: `@search-return` 与 `@search` 合并跑的串行时序未做——两 spec 共享 `seedSearchContext` 但各自 `beforeAll` 重新 seed，`pnpm e2e:search && pnpm e2e:search-return` 会跑两次 seed（确定性，但冗余）；合并跑需手动串行
  evidence: Story 3.4 `e2e:search-return` 脚本先跑 `tsx e2e/seed-search.ts`（与 `e2e:search` 同 seed），再 `--grep @search-return`。若开发者想一次跑完 search + search-return，需 `pnpm --filter web e2e:search && pnpm --filter web e2e:search-return`——两次 seed（第二次清表重写，确定性无冲突，但冗余 DB round-trip）。两 spec 的 `beforeAll` 各自调 `seedSearchContext()` 也会在 playwright worker 内再 seed（serial mode 单 worker，故不并发竞争，但仍多次 seed）。合并跑（单 seed 喂两 spec）需自定义 playwright 脚本或 globalSetup，超 3.4 scope。
  resolution: 已于 Story 3.4 登记为测试编排 defer——待 search + search-return 合并跑需求出现时，考虑：(1) 一个 `e2e:search-all` 脚本 `tsx e2e/seed-search.ts && playwright test --grep "@search|@search-return"`（单 seed 喂两 spec），或 (2) 提取 globalSetup 共享 seed（避免 beforeAll 重复），需评估两 spec serial mode worker 隔离。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-4-search-results-to-detail-return-loop.md`
  summary: 搜索来源的 scroll 位置恢复未在 3.4 e2e 直接断言——AC1「结果上下文保持不变」的 scroll 分量沿用 2.5 marker 机制（同一代码路径，loop.spec 已为 home/theme/daily 断言），但 search 来源的 scroll 恢复无直接测试
  evidence: Story 3.4 AC1「回到原搜索结果列表，原关键词、排序与结果上下文保持不变」中的「上下文」含 scroll 位置。scroll 恢复是 2.5 的 `RESTORE_MARKER` + `ListContextMemory` 机制（search 已在 allowlist，故机制对 search 生效），loop.spec 对 home/theme/daily 三面有 `scrollY` 恢复断言（需 ≥10 条结果撑高页面）。但 search 来源的 scroll 恢复从未被直接断言：3.1 test 9 只断 query 恢复，3.4 search-return.spec 的 AC1 点回用例只断 `q=` + EventCard 复现。直接断言需要 search 结果页足够高，而 `seedSearchContext` 对测试 query（如「芯片」）只产出 1 个事件 + 2 个主题 pill（页面很短，`scrollY` 断言会脆），修改共享 seed 会波及 search.spec。故 3.4 未加 search 来源 scroll 断言。
  resolution: 已于 Story 3.4 登记为 search scroll 验证 defer——待需要时：(1) 在 search-return.spec 加一个用多命中 query（如「稀土」命中 2 事件）+ 注入 spacer 撑高页面的 scroll 恢复断言，或 (2) 给 seedSearchContext 加专用高结果 query（评估对 search.spec 的影响），或 (3) 接受 scroll 恢复由 loop.spec 对同一 2.5 代码路径的覆盖间接保证（当前选择）。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-5-semantic-and-keyboard-accessibility-baseline.md`
  summary: 焦点指示器机制目前横跨两套——全局 `:where(a,button,input,textarea,select,summary):focus-visible` 规则（3.5）与 SearchBox/FollowButton 既有 `focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring`（Tailwind utility）——两者 specificity 正交、视觉共存无双重指示器，但统一为单一机制 defer
  evidence: Story 3.5 在 `globals.css` 落地一条全局 `:where(...):focus-visible { outline: 2px solid var(--color-focus-ring); ... }`，specificity 0；SearchBox（`search-box.tsx:88,94`）与 FollowButton（`follow-button.tsx:182,248,260`）仍带 Tailwind `focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring`（编译后 specificity > 0，故其 ring 不被全局规则覆盖——全局规则的 outline 只在元素无自己的 focus 类时生效）。两套机制视觉等价（同 `--color-focus-ring` 色）、无双重指示器（ring 元素不被全局 outline 覆盖），但「单一焦点机制」更易维护（改一处即全改）。统一为单一机制 defer。
  resolution: 已于 Story 3.5 登记为统一焦点机制 defer——后续移除 SearchBox/FollowButton 既有 `focus:outline-none focus-visible:ring-*` 改用全局规则（需验证 ring vs outline 视觉等价、tabindex 顺序、box-shadow 模拟 ring 的兼容性），或把全局规则升级为带 offset/ring 的等价形式（统一为单一机制）。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-5-semantic-and-keyboard-accessibility-baseline.md`
  summary: 关联子标题 / 成员事件行 / 主题行标题目前为 `<p>`（视觉小标题），未提为 `<h3>`——标题层级 AC1 字面已满足（每页一 h1、无跳级），但子项 heading 是增强非基线，defer
  evidence: Story 3.5 调查证实每页恰好一个 `<h1>`、无层级跳级（home/detail/themes×2/daily/search/favorites 均查证，AC1 标题层级今日已满足）。但详情页关联区块子标题、主题页成员事件行标题、日报成员行标题等用 `<p>` 而非 `<h3>`（视觉小标题样式）。这些子项 heading 可让屏幕阅读器跳级导航（h2 → h3 子项），是「增强非基线」——AC1 不要求。3.5 Never 明示不改 `<h1>`/`<h2>` 结构、不把 `<p>` 子标题提为 `<h3>`（defer），避免触发跨 home/feed/watchlist EventCard h2 模式的回归面。
  resolution: 已于 Story 3.5 登记为 heading 提升 defer——后续统一把关联区块/成员事件/主题行的 `<p>` 子标题提为 `<h3>`（需跨 home/feed/watchlist/themes/daily 统一 EventCard h2 模式，避免 section h2 与 item h2 同级歧义，见 3.3 watchlist a11y defer 同根）。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-5-semantic-and-keyboard-accessibility-baseline.md`
  summary: ReactionChip 未加 ▲▼↑↓ 符号层 / 未加 `aria-label`——AC2 由既有「涨/跌/平」CJK 文字 + 数值已满足（颜色非唯一维度），符号层/aria 层是增强，defer
  evidence: Story 3.5 调查证实 `ReactionChip`（`components/chips.tsx:152-160`）= `bg/text-market-*` 颜色 +「涨/跌/平」CJK 文字 + 数值（font-mono），AC2「关键状态不只依赖红绿颜色」今日已满足。3.5 在 `/design`（DB-free）加断言每态含可见文字（锁定 color+文字不变量防静默回归），不改 ReactionChip 实现（Never 明示）。▲▼ 符号层（视觉冗余信号，帮助色弱/色盲读者快速识别方向）+ `aria-label`（SR 播报「涨 +3.42%」而非裸文字拼接）是增强非基线，defer。
  resolution: 已于 Story 3.5 登记为符号层/aria 增强 defer——待 WCAG AA 对比度审计或色弱/色盲读者反馈时，给 `ReactionChip` 加 ▲/▼/─ 符号层（视觉冗余）+ `aria-label={`{涨/跌/平} ${value}`}`（SR 友好播报）。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-5-semantic-and-keyboard-accessibility-baseline.md`
  summary: FollowButton 成功/处理中态未做 `aria-live` 公告——既有 `role="alert"` 仅覆盖错误态，成功/处理中态无 SR 公告
  evidence: Story 3.5 Never 明示「不加 `aria-live` 公告 follow 成功/处理中态（FollowButton 既有 `role="alert"` 仅覆错误；成功公告 defer）」。`follow-button.tsx` 的 `role="alert"` 仅在 error state 非空时渲染（SR 播报错误），但收藏成功（following=true）/处理中（pending）态无 aria-live 公告，屏幕阅读器用户点了「收藏」后无确认反馈（除非他们再 Tab 回去看按钮文字变化）。defer 到后续 a11y 增强。
  resolution: 已于 Story 3.5 登记为 aria-live defer——待 SR 用户体验审计时，给 FollowButton 成功态加 `aria-live="polite"` 公告「已收藏」/「已取消收藏」（处理中态可选 polite 公告「正在处理」），与既有 `role="alert"` 错误公告互补。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-5-semantic-and-keyboard-accessibility-baseline.md`
  summary: 日报页 `<ol>` 未加 `role="list"` 显式语义——Tailwind preflight 可能使部分 SR 丢失列表语义，daily 成员顺序的 list 语义增强 defer
  evidence: Story 3.5 AC1/AC2 仅锁定基线（焦点 + 标题层级 + 非颜色 + 可达），不涉及 daily 成员 `<ol>` 的显式 `role="list"`。日报页成员用 `<ol>`（ordered，表达 evidenceCount DESC 顺序），Tailwind v4 preflight（list-style reset）可能使某些 SR（Safari + VoiceOver 历史问题）丢失 list 语义。日报成员顺序是阅读信号（证据多→少），但 list 语义增强非基线，defer。
  resolution: 已于 Story 3.5 登记为 list 语义 defer——待 SR 审计反馈「日报成员丢失 list 语义」时，给 daily 成员 `<ol>` 加 `role="list"`（+ 每个 `<li>` `role="listitem"`，如必要），与 home feed `<ul>`/theme 成员 `<ol>` 一致性统一处理。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-5-semantic-and-keyboard-accessibility-baseline.md`
  summary: 全局 `:focus-visible` 规则无单元/视觉回归自动化测试——e2e a11y.spec 断言 outline-style 非 none + outline-color 格式，但无像素级视觉回归（焦点环粗细/offset/颜色漂移）守卫
  evidence: Story 3.5 的 `e2e/a11y.spec.ts` 断言键盘聚焦的 nav 链接 outline-style 非 `none` + outline-color 匹配 rgb() 格式（surface-anchored 证明全局规则生效）。但 outline 粗细（2px）、offset（2px）、颜色值（`#335A91` → `rgb(51, 90, 145)`）的像素级漂移无自动化守卫（`--color-focus-ring` token 改值或 outline 属性微调不会触发 e2e 失败，只要 outline-style 非 none）。像素级视觉回归需 Playwright screenshot/visual comparison 或 Storybook + Chromatic，当前 repo 无此基建。defer。
  resolution: 已于 Story 3.5 登记为焦点视觉回归自动化 defer——待平台视觉回归基建（Playwright screenshot diff 或 Storybook + Chromatic）引入时，给焦点环的 2px 实线 + offset + brand color 加像素级守卫（与 DESIGN token 单测一并接入）。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-5-semantic-and-keyboard-accessibility-baseline.md`
  summary: 跨浏览器（WebKit/Firefox）a11y 验证缺失——项目 `playwright.config` 仅 chromium 单 project，3.5 a11y e2e（Tab 序列、`:focus-visible`、skip-link）仅在 Chromium 验证
  evidence: Story 3.5 复核（adversarial）指出 `apps/web/playwright.config.ts` 仅定义 chromium 单 project。`:focus-visible` 的鼠标 vs 键盘匹配启发式、Tab 序列、`tabIndex={-1}` 行为在 WebKit（Safari/VoiceOver）与 Firefox 上历史上有差异。3.5 的 a11y 断言（Tab 序列、outline-style/color、skip-link 跳转）全部仅 Chromium 跑。这是项目级测试基建配置（所有 spec 同样 chromium-only），非 3.5 引入，复核顺带 surface。
  resolution: 已于 Story 3.5 复核登记为跨浏览器 a11y 验证 defer（项目级）——待引入 WebKit/Firefox project 时，a11y.spec 自动跨浏览器跑（`:focus-visible` 与 Tab 序列跨浏览器一致性是 a11y 基线的关键），需评估 WebKit/Firefox 下 `:focus-visible` 匹配差异对断言的影响。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-5-semantic-and-keyboard-accessibility-baseline.md`
  summary: 标题层级（一 h1 / 无跳级）无自动化守卫——AC1「清晰标题层级」今日由代码结构满足，但无测试锁定
  evidence: Story 3.5 调查证实每公共页恰好一个 `<h1>`、无层级跳级（AC1 标题层级今日满足），3.5 未改任何 heading 结构。但复核（intent-alignment）指出无任何测试断言「每页一个 h1」「h1→h2 无跳级」——未来 heading 回归（如某页加第二个 h1、或 h1→h3 跳级）不会被自动抓。3.5 选择不为「未变化的结构」加测试（ponytail YAGNI），标题层级守卫 defer。
  resolution: 已于 Story 3.5 复核登记为标题层级守卫 defer——待需要时，加一个轻量 axe-core 或自定义 heading-order 审计（每公共页断言「恰好一个 h1」「heading 序列无跳级」），可作 a11y.spec 的一部分或独立 heading-audit 套件。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-5-semantic-and-keyboard-accessibility-baseline.md`
  summary: a11y e2e 仅覆盖 `/`（与 `/design`）——全局焦点规则跨面（6 面 + 全部共享组件），但 Tab 序列/outline 断言只在 `/` 跑；themes/daily/search/favorites/detail 无 a11y 断言
  evidence: Story 3.5 全局 `:where(...):focus-visible` 规则是元素类型级（`<a>`/`<button>`/`<input>`），跨面生效——在 `/` 上证明对 nav `<a>` + SearchBox `<input>` 生效即证明对所有同类元素生效；且 `/`（含 PublicNav + 首屏 feed）渲染全部共享交互组件（nav/SearchBox/FilterPill/EventCard/FollowButton，均为真实 `<a>`/`<button>`/`<input>`，调查证实零 div-onclick）。复核（intent-alignment/verification-gap）指出 themes/daily/search/favorites/detail 五面无 a11y e2e。但按面扩 a11y 断言需各自 seed（themes/daily/search/favorites 需其 seed、detail 需 seed-detail），且是对同一 CSS 规则 + 同类元素的冗余覆盖——超基线 scope。
  resolution: 已于 Story 3.5 复核登记为按面 a11y e2e 扩展 defer——待真实 a11y 回归出现在特定面（如某面 stylesheet 覆盖 outline）时，给该面加 a11y 断言；或引入 axe-core 全面自动审计（一次跑全 6 面，比逐面手写 Tab 断言更省）。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-5-semantic-and-keyboard-accessibility-baseline.md`
  summary: `package.json` base `e2e` 的 `--grep-invert` 现累计 14 个 `|@tag`——单字符串正则、无程序化校验，tag 拼写错误会静默含/排某套件
  evidence: Story 3.5 复核（adversarial）指出 base `e2e` 脚本的 `--grep-invert` 累计 `@console|@feed|@detail|@revision|@merge-split|@market-reaction|@associations|@themes|@daily|@loop|@search|@follow|@watchlist|@search-return`（3.5 patch 已把 `@a11y` 从该列表移除并入默认闸门）。每个 story 加其 `@tag` 进 grep-invert 是既有模式，但单 pipe-分隔正则无校验：tag 拼写错会静默把该 tagged 套件纳入/排除 base e2e。这是项目级测试编排模式（非 3.5 引入），复核顺带 surface。
  resolution: 已于 Story 3.5 复核登记为 grep-invert 可维护性 defer（项目级）——待 tag 数量继续增长时，考虑改为 playwright `testProjects` 或 `--grep` 白名单模式（base e2e 显式列含哪些 tag，而非 invert 排除），或加一个 lint 校验「grep-invert 里的每个 tag 都对应至少一个 spec 的 describe 标题」。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-6-touch-target-and-reduced-motion-support.md`
  summary: AGUHOT logo 链接触控热区未达标——header 品牌 `<a>` 非 44px，加 `min-h-11` 会破坏 header `h-16` 布局
  evidence: Story 3.6 Never 明示「不改 AGUHOT logo 链接触控热区（header 品牌标记，非核心交互；加 44px 会破坏 header `h-16` 布局——defer）」。`apps/web/app/(public)/_components/public-nav.tsx` 的 AGUHOT logo `<Link>` 在 header `h-16`(64px) 容器内用 `text-lg`，实际触控高度约 28px < 44px。logo 是品牌标记非核心交互控件，且 header 高度固定（加 `min-h-11` 会使 logo 超出 `h-16` 容器或撑高 header），故 defer。8 处欠尺寸交互控件均已加 `min-h-11`，logo 是唯一识别但未修的欠尺寸 `<a>`。
  resolution: 已于 Story 3.6 登记为 logo 触控热区 defer——后续若需达标，重构 header 布局（如把 `h-16` 改为 `min-h-16` + logo `min-h-11` + flex 居中），或接受 logo 作为品牌标记非触控控件（评估是否纳入触控基线）。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-6-touch-target-and-reduced-motion-support.md`
  summary: 减动效在真实 `/daily` transition 上的 seeded 行为验证未做——探针证 CSS 机制，`/daily` 需 seed 故 defer
  evidence: Story 3.6 Design Notes 明示「为何减动效 e2e 用探针而非测真实 `/daily` transition：`/daily` 是 `(public)` 唯一含 CSS transition 的面，但 `@a11y` 套件在 base `e2e` 闸门跑（无 `seed-daily` 前置），`/daily` 摘要行依赖 digest 数据，空态无 transition li 可断言」。3.6 的 `@a11y` 减动效测试在 `/design`（DB-free）注入探针 `<div style="transition:color 150ms ease">`，断言 `getComputedStyle.transitionDuration` 被全局 `* !important` 规则降级为近 0——证「media query 在偏好下把任一 transition 降级为即时」的机制，即降级 daily hover 的同一机制。但未在真实 `/daily` seeded 摘要行上直接断言 `transition-colors` 被降级（需 seed-daily 前置 + `@a11y` 套件加 seed 依赖）。
  resolution: 已于 Story 3.6 登记为 seeded daily 减动效验证 defer——待需要时，在 `e2e:a11y` 加 `seed-daily` 前置（或新建 `e2e:a11y:daily` 带 seed），goto `/daily` 在摘要行 `<li>` 上断言 `getComputedStyle.transitionDuration` ≤ 1ms（`reducedMotion:'reduce'` 下），直接证 daily hover 被降级（当前由探针间接证明同机制）。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-6-touch-target-and-reduced-motion-support.md`
  summary: 按面触控热区 e2e 全量 sweep 未做——3.6 仅守 FilterPill 代表性密集标签，逐链接断言 defer
  evidence: Story 3.6 的 `@a11y` 触控热区测试仅断言 `/design` 上 FilterPill「全部」高度 ≥ 44px（FilterPill 是 UX-DR13 点名的「密集小标签」代表，一处 pillClass 覆盖五面）。8 处欠尺寸交互控件（3 处返回链接 + 4 处空态 CTA + 证据外链）各加 `min-h-11`，但无逐链接 e2e 断言——逐链接断言需各面 seed（home/favorites/search 需 DB + seed，detail 需 seed-detail，daily 需 seed-daily），且是对同一 `min-h-11` token 的冗余覆盖。3.6 选择守 FilterPill 代表性密集标签（触控最易误触的控件），其余逐链接断言 defer。
  resolution: 已于 Story 3.6 登记为按面触控热区 sweep defer——待真实触控回归出现在特定面（如某面链接被样式覆盖 `min-h-11`）时，给该面加触控高度断言；或引入 axe-core/touch-target 审计一次性扫描全部交互控件高度（比逐面手写断言更省）。

- source_spec: `_bmad-output/implementation-artifacts/spec-3-6-touch-target-and-reduced-motion-support.md`
  summary: 跨浏览器减动效/触控验证缺失——项目 chromium-only 配置，3.6 a11y e2e 仅 Chromium 跑
  evidence: Story 3.6 沿用 3.5 既有项目级配置：`apps/web/playwright.config.ts` 仅定义 chromium 单 project。`prefers-reduced-motion` media query 的匹配与 `getComputedStyle.transitionDuration` 序列化在 WebKit（Safari）/Firefox 上历史上有差异（如 transition-duration 序列化格式、`!important` 覆盖优先级在旧引擎的边界 case）。3.6 的减动效探针断言（transition-duration ≤ 1ms）与触控高度断言（boundingBox.height ≥ 44px）全部仅 Chromium 跑。这是项目级测试基建配置（所有 spec 同样 chromium-only，3.5 复核已登记同根 defer），非 3.6 引入。
  resolution: 已于 Story 3.6 沿用 3.5 复核登记为跨浏览器 a11y 验证 defer（项目级）——待引入 WebKit/Firefox project 时，减动效探针与触控高度断言自动跨浏览器跑（需评估 WebKit/Firefox 下 `transition-duration` 序列化格式差异对 `parseFloat` 解析的影响）。

- source_spec: `_bmad-output/reviews/2026-07-11-salvaged-stories-code-review.md`
  summary: 1-6 运营写路径无 auth 闸 + decideReview TOCTOU 竞态（HIGH×2）
  evidence: 抢救故事专项评审「横切 2」+「三-1-6」：`apps/web/app/(operator)/layout.tsx:22-28` 无任何 auth 检查，`/console/*` 及其写 action（publish/takedown/merge/split/revise）对未认证请求开放，`reviewer:"operator"` 硬编码；`packages/core/src/modules/review-workflow/review-service.ts:68-135` `decideReview` 事务内 `findUniqueOrThrow`（无锁）→ `resolveTransition` → `update`，默认 Read Committed，两并发运营提交（approve + takedown 撞同一 candidate）可都读到 candidate、都过校验、都写，留下矛盾 PublicationDecision。修法：layout 加 `NODE_ENV==='production'` / env-flag `redirect()` 闸（V1 推迟真实 auth，但部署闸必须）；decideReview 改条件 update `where:{id, publicationStatus: fromStatus}`，Prisma P2025 → 映射 `IllegalTransitionError`（零迁移乐观锁）。由 bmad-quick-dev split 拆出，随 agent team 处理。
  resolution: 已解决（commit d304c3e，agent team 目标 B）——layout 加 `AGUHOT_OPERATOR_ENABLED` 部署闸（生产默认关闭、需显式 env 开启；非生产开释放行 dev/e2e），`decideReview` 改条件 `updateMany` where {id, publicationStatus: fromStatus}，count===0 → `IllegalTransitionError`，零迁移。verify:review-logic 33/33。

- source_spec: `_bmad-output/reviews/2026-07-11-salvaged-stories-code-review.md`
  summary: 1-7 AC3 日期窗过滤 e2e 零覆盖 + filter-pill/空态链接裸 querystring（HIGH×2）
  evidence: 抢救故事专项评审「三-1-7」：`apps/web/e2e/feed.spec.ts` 未覆盖 `?window=today/7d/30d`、active pill 态、"筛选无结果"分支（头条过滤 UX 零测试），且 `来源数` 断言只查文案不查数值；`apps/web/app/(public)/_components/feed-filters.tsx:53` 与 `apps/web/app/(public)/.../page.tsx:101` 的 filter-pill/空态链接用裸 querystring，会冲掉未来 `concept/industry` 参数。修法：补 AC3 日期窗 e2e（含空态分支 + 来源数数值断言）；链接改 `pathname+searchParams` 合并，空态链接用 `href="/"`。由 bmad-quick-dev split 拆出，随 agent team 处理。
  resolution: 已解决（commit 9f557aa，agent team 目标 C）——feed.spec.ts 补 5 个 AC3 用例（today/7d/30d 可见+active pill 高亮、空态分支、来源数数值断言）；filter-pill 与 association-clear 链接改 `mergeSearchParams` 合并保留兄弟参数，空态链接 `href="/"`（server-side spread，未加 useSearchParams）。e2e 沙箱未实跑（无 DB/浏览器），typecheck 过。

- source_spec: `_bmad-output/reviews/2026-07-11-salvaged-stories-code-review.md`
  summary: 1-9 operator 侧 AiLabel 源判定近似，误标已发布人工解释为 AI（HIGH）
  evidence: 抢救故事专项评审「三-1-9」：`apps/web/app/(operator)/console/[eventId]/page.tsx:223-227` operator 侧 `<AiLabel>` 用 `pending.explanation===true` 启发式判定源，"刚 republish 人工编辑后刷新"会误标已发布的人工解释为 AI（公开侧已用 `source` 字段精确判定，正确）。修法：给 `PublishedEventRevisionView.published.explanation` 投影补 `source` 字段，operator 侧直接判定 `source!=="human"`。`review-service.ts:388-389` pendingTitle/pendingTags 判据不一致为信息性项，本轮不动。由 bmad-quick-dev split 拆出，随 agent team 处理。
  resolution: 已解决（commit 969f922，agent team 目标 D）——operator 页改读 `publishedHotEventExplanation.explanationSource` 列（与公开侧 `getPublishedHotEventDetail` 同源），判定 `source !== "human"`，弃用 `pending.explanation===true` 启发式。列已存在于 schema（无迁移）。未改 review-service.ts 投影（授权锁定），改为页面级权威读。verify:revision 35/35。

## Deferred from: code review of salvaged-stories fix commits (2026-07-11)

- source_spec: `_bmad-output/reviews/2026-07-11-salvaged-stories-code-review.md`（fix commits b9b6e19..969f922 的对抗复核）
  summary: submitMerge/submitSplit 外层多事务 TOCTOU（merge 提交后 decideReview 抛错 → source 被抽干但未 taken_down）
  evidence: fix A 只把 merge/split 自身包进 $transaction，外层 submitMerge 序列（merge tx → decideReview(target,republish) tx → decideReview(source,takedown) tx）仍是 3 个独立事务、无补偿。并发在 merge 提交后改 source 状态，step3 抛 IllegalTransitionError，source 留 0 evidence 且仍 published、公开读模型过期。原评审已标 MEDIUM + deferred-work 已记 V1 已知项，本次复核再确认未闭合。
  resolution: V1 已知/接受（cross-module 事务是更大改动）。

- source_spec: 同上
  summary: $transaction 未真正串行化并发 merge/split（Read Committed + 无 FOR UPDATE）
  evidence: merge-split-service.ts:91-98 事务注释原称"row-level locks so concurrent merge/split serializes"，但 Prisma $transaction 默认 Read Committed、锁仅在写/删时取，findMany 读不锁。并发 merge 同一 target：第二个的 delete 命中已迁走的 link 抛 P2025（仅 P2002 被 swallow）；或 cluster_signature 从 stale member 集重算 → 签名发散。事务给了崩溃原子性（好），但未给串行化。本次 patch 已修正注释的过度声称；真正的 advisory-lock 串行化延后。
  resolution: 注释已修正；advisory lock 串行化 V1 量级延后（数据量极小，并发 merge/split 几乎不可能）。

- source_spec: 同上
  summary: decideReview count===0 把"并发竞态"与"事件被删"混为一谈 + IllegalTransitionError 语义不可区分
  evidence: review-service.ts:133-145 条件 updateMany count===0 → IllegalTransitionError，但"并发赢了竞态"与"findUniqueOrThrow 与 updateMany 之间事件被级联删除"都落到同一分支，后者应映射 CandidateNotFoundError/P2025 → 重定向 /console，而非重定向 /console/{eventId} 后 404。另：丢竞态 vs 真非法转移对运营都是 IllegalTransitionError，无法给出"重试"提示。
  resolution: 微秒级窗口、删除非正常运营路径，V1 接受。

- source_spec: 同上
  summary: 多项验证缺口——$transaction 原子性/并发、submitMerge 分歧态、operator AiLabel、AGUHOT_OPERATOR_ENABLED 生产分支、mergeSearchParams 兄弟参数保留均无测试
  evidence: verify:merge-split 单线程无故障，不触发崩溃中途/并发，事务的真实保证（回滚、串行化）零测试；submitMerge 的 read-model/status-table 分歧态无区分测试；operator AiLabel source 判定无 e2e（verify:revision 只覆盖公开侧 getPublishedHotEventDetail）；AGUHOT_OPERATOR_ENABLED 三个生产分支零覆盖（e2e 跑非生产环境）；mergeSearchParams 保留兄弟参数无单测/e2e。
  resolution: 廉价纯函数单测（mergeSearchParams、isOperatorEnabled）随相关 patch 补；并发/崩溃注入/分歧态/e2e/部署冒烟属集成级，V1 延后。

- source_spec: 同上
  summary: submitMerge 对不存在的 targetId 返回泛化 500（无 CandidateNotFoundError 映射）
  evidence: actions.ts submitMerge 只校验 source 已发布，未校验 targetId 存在；target 不存在时 mergeHotEvents 内部 FK 违反 P2003 → 事务回滚（source 安全），但 action 层 fall through 到 throw error → 运营见泛化 500 而非干净重定向。
  resolution: 边界、V1 接受。

- source_spec: 同上
  summary: refreshPublishedReadModel 确定性失败会把该事件永久卡死（每次重试都回滚、无错误分类）
  evidence: review-service.ts:150-155 decideReview step5 已条件更新状态后，step6 refreshPublishedReadModel 若确定性抛错（如某 event 的 published 行 malformed），整事务回滚（含 step5 状态与 append-only 决策记录），运营每次重试都回滚 500，无诊断面告诉是读模型刷新而非竞态。
  resolution: V1 接受（读模型是投影可重建；确定性失败需具体 malformed 数据才会触发）。

- source_spec: `_bmad-output/reviews/2026-07-11-salvaged-stories-code-review.md`（fix commit 复核期间发现）
  summary: Next 16 弃用 middleware 约定 → proxy.ts（当前 build 仅警告、可用）
  evidence: apps/web/middleware.ts 在 `pnpm next build`（Next 16.2.10）触发 deprecation 警告："The 'middleware' file convention is deprecated. Please use 'proxy' instead." 功能不受影响（build 通过、/console 路由 dynamic、闸在 request 时评估），但下次升级/清理时需按 Next 16 proxy 约定重命名 middleware.ts→proxy.ts 并核对导出签名。本次修复保留 middleware 命名以最小化改动面，重命名作为独立 follow-up。
  resolution: 待 Next 16 proxy 约定迁移时一并处理。

- source_spec: `_bmad-output/reviews/2026-07-11-salvaged-stories-code-review.md`（收口验证 e2e 实跑发现）
  summary: merge-split e2e AC4 数据依赖型失败——serial 状态变迁后合并 <select> 条件渲染消失
  evidence: `apps/web/e2e/merge-split.spec.ts` AC4「合并非法：source 非 published」在 serial 模式下跑在 AC1-3 之后：AC1 把 B 合并进 A（B taken_down）、AC2 拆分 A、AC3 下线重发布 A。到 AC4 时唯一 published 事件是 A 本身。`apps/web/app/(operator)/console/[eventId]/page.tsx:622` 的合并表单 `{otherPublished.length === 0 ? <p>暂无…</p> : <select name="sourceId">}` —— 无其它 published 事件时 <select> 不渲染，AC4 的 `querySelector('select[name="sourceId"]')` 返回 null → 抛 "merge source select not found"。是测试设计假设缺陷（依赖 ambient DB 有其它 published 事件），非本轮 auth/harness 改动引入（4/5 merge-split 测试过、含一次真实合并）。本轮 auth cookie 注入正确、harness build+start 改造让全套件首次实跑。
  resolution: 待修——AC4 应自带 seed 一个 published source 事件（不依赖 ambient 状态），或显式处理 select 缺席分支。

---

## 2026-07-11 Sprint Change Proposal — 时间流首页与 AI 分析层（Major pivot）

- source_spec: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-11.md`（correct-course 工作流产物，用户已 Approve 进入实施）
  summary: V1 交付后对照参考站 AI HOT (`https://aihot.virxact.com/all`)，决定把首页从"优先级热点事件流"改为"分钟级时间流 + 同事件精选"，并补三层 AI 分析（列表卡AI 解读 / 事件级 AI 深读 / 跨事件趋势研判）。与 PRD §1"不是财经资讯门户"、FR-1"而不是原始文章列表"直接冲突，属定位级转向（A 股版 AI HOT 方向）。
  evidence: sprint-change-proposal-2026-07-11.md 含 13 条编辑提案（PRD 8 / Arch 1 / UX 1 / Epic 2 / sprint-status 1），全部 Incremental Approve。新增 Epic 4（时间流首页，4 story）+ Epic 5（AI 分析层，4 story），已入 sprint-status.yaml backlog。lazy senior dev 风险已向用户明示：整个 PRD/brief/architecture 围绕"不做原始资讯流"构建的重机器（evidence-timeline / market-reaction / operator-review）在新定位下价值重心转移；用户知悉并坚持。
  resolution: Major → 已经本地 bmad-agent-pm / bmad-agent-architect 评审（均 Approve-with-conditions），阻塞项全部应用到源文件。状态：(1) §12 Q6/Q7/Q8/Q9 全部收口（Q8 分层闸门、Q9 假设三合规义务均触发、阻塞 GA 不阻塞 dev）；(2) 架构阻塞 A1-A5 已应用（method A 事务内增量刷新、三实体独立 append-only 表不复用 ExplanationVersion、LLMAdapter 进 5.1 首任务、spec-4-1 Code Map 补齐、折叠阈值归 event-assembly 模块配置）；(3) PM 阻塞 P1-P7 已应用（§10 三合规面、SM-8 重定义+基线、NFR-7 AI provenance、视觉权重、"AI 解读"全局改名+黑名单六类、5.3 拆 5.3a/5.3b、Vision 置顶带+锚定句）；(4) "推荐理由"→"AI 解读"文案定稿（解读 ≠ recommendation，合规风险最低）。待 PM 执行（非文件编辑）：SM-8 基线冻结（Epic 4 dev 启动前）、外部律所书面意见（§10 三合规面，2 周窗口）、算法推荐备案实操（GA 前）。源文件 prd/arch/epics/design/spec-4-1/epic-4-5-context/sprint-status 全部同步；Story 4.1 spec 已 ready-for-dev，可转 /bmad-create-story 正式化或直接交 bmad-loop。fallback（共存方案）被用户否决，仅作 Major 评审失败时备选。

---

## 2026-07-11 Story 4.1 review — deferred findings

- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-timeline-read-model-and-publish-refresh.md`（4.1 review pass，code-review 期间发现）
  summary: `deriveSessionTag`/`deriveTradeDate` 无 PRC 节假日日历——工作日节假日/周末补班日 session_tag 误判
  evidence: `packages/core/src/modules/publish-orchestrator/session-tag.ts` 的 `isTradingDay` 仅按 Mon–Fri 判定（无节假日表）。一个落在工作日的 PRC 法定假日（如国庆周）会被 tag 为 `Intraday`/`PostClose` 而非 `NonTrading`；一个周末补班日会被 tag 为 `NonTrading` 而市场实际开盘。每年约影响 ~20 个交易日的 `session_tag` 列（`trade_date` 仍为自然日、分组不受影响），会误导 4.3 的盘前/盘中/盘后筛选。PRD §12 Q5 已将日历列为 V1 后置；单一替换点是 `isTradingDay`。`apps/worker/src/verify-timeline.ts` 无节假日 fixture 覆盖。
  resolution: 待 V1.1——引入 PRC 交易日历（或交易所 holiday feed）注入 `isTradingDay`，并在 verify-timeline 加节假日边界 fixture。

- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-timeline-read-model-and-publish-refresh.md`（4.1 review pass，code-review 期间发现）
  summary: `listPublishedTimeline` 无游标分页 / `hasMore` 信号——单个 trade_date 超过 limit（默认 50）时静默截断
  evidence: `packages/core/src/modules/publish-orchestrator/timeline-read-model.ts` 的 `listPublishedTimeline` 用 `take: limit ?? 50` 取首页，`ListPublishedTimelineOptions` 无 `cursor`/`offset` 字段，返回类型无 `totalCount`/`hasMore`。代码注释标明 "No cursor pagination in V1 (tiny scale)"。当一个热门交易日条目 >50 时，首页无法触达后续条目且无 "加载更多" 契约——属文档化的 V1 限制，但规模误判时是静默截断。4.2 首页落地前不构成阻塞。
  resolution: 待规模评估——若首波真实流量出现单日 >50 条，为 `listPublishedTimeline` 加 cursor 分页 + `hasMore`，并在 4.2 卡片接 "加载更多"。


- source_spec: `_bmad-output/planning-artifacts/epics.md` (Story 4.3 V1 范围裁决，2026-07-11)
  summary: 公告/研报 类别筛选出 4.3 V1 范围——整个 codebase 无任何数据承载，待真实数据源 + 数据模型落地后另开 story
  evidence: 4.3 dev 在规划阶段 HALT（intent gap）：类别维度 V1 候选含「概念/行业/个股/公告/研报」六项，但 `published_timeline` 读模型无 category 字段、`listPublishedTimeline` 未实现 `category?` 参数，且 `公告|研报` 在 `packages/core/src` grep 零命中——无 enum、无 union 成员、无字段、无 source。唯一类别 taxonomy 是 `AssociationKind = concept|industry|stock`，仅存于 `EventAssociationSet.items`/`PublishedHotEventAssociation.items` 的 Json 展示列（不可 SQL 单项查）。PM 裁决（读法 B）：V1 类别 = concept/industry/stock 三项（复用既有 AssociationKind，内存过滤，镜像 2.2 feed-filter 模式），公告/研报 out-of-scope。强行实现公告/研报 pill 会违反 NFR「absence as absence，绝不伪造完整性」（无数据源的 pill 是死控件）。
  resolution: 公告/研报 类别筛选 defer 到未来 story——前置条件：采购公告/研报真实数据源 + 定义 enum/归属模块 + 投影到 timeline 读模型（或独立 category 列/子表）。届时扩 4.3（或新 story）类别 pill 至 6 项。本 defer 与 deferred-work 中既有「按 concept/industry SQL 聚合需重构 Json 列为子表」「scale ceiling」同根（数据底座）。
