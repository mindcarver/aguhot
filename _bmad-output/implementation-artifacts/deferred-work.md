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
