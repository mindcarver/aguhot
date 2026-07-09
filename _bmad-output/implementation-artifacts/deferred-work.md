# Deferred Work

Findings surfaced by review but belonging to future stories (out of Story 1-1's intent scope). Append-only — one entry per finding.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-public-shell-and-anonymous-home-entry.md`
  summary: `packages/config/src/env.ts` 的设计缺陷待消费者接入时再修
  evidence: 模块级 `cached` 单例不会随 `process.env` 变化失效（Next dev 热更新后返回陈旧 env）；`requireEnv(key)` 在任意其他 env 变量非法时也会抛出（跨 key 失败耦合）；`NODE_ENV` zod enum 未做大小写归一化（`PRODUCTION`/`prod`/`staging` 会抛）；`requireEnv("NODE_ENV")` 签名声明可抛但该 key 有 `.default` 实际永不抛。当前无任何消费者（worker/operator 属 Story 1.4+），正确修法取决于未来用法，过早修补有过度设计风险。

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-public-shell-and-anonymous-home-entry.md`
  summary: `.npmrc` 全局 `ignore-scripts=true` 会在后续 story 抑制原生依赖 postinstall
  evidence: 该开关作为 `unrs-resolver`/`resolve@2` 的临时绕过被全局提交，但会同时禁用所有包的 postinstall/preinstall。Story 1.4 引入 Prisma 7.7（以及未来 esbuild/sharp）需要 postinstall 生成引擎/二进制，届时会被静默跳过导致运行时缺件。应在引入首个原生 postinstall 依赖时改为 `pnpm.onlyBuiltDependencies` 等白名单机制。

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
