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
