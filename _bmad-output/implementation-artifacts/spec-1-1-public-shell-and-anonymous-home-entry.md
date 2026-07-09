---
title: '初始化公共站点脚手架与匿名首页壳层 (1.1)'
type: 'feature'
created: '2026-07-09'
status: 'done'
baseline_revision: '07fbc3d3a1e65105aabe1a371aa4cddeb571dcb8'
final_revision: 'c1e2b33b106222f9a7e43a05424b5ed09d57866c'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-aguhot-2026-07-09/ARCHITECTURE-SPINE.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** AGUHOT V1 仓库目前只有 BMAD 规划产物，没有任何可运行的应用代码。团队需要一个与架构 spine 对齐、可立即运行与扩展的公共 Web 骨架，作为后续所有公共页面与运营后台 story 的共享基线。

**Approach:** 用 pnpm workspaces 建立单仓 monorepo，按 spine 的 Structural Seed 初始化 `apps/web`(可运行的 Next.js 16 App Router 应用，含 Tailwind 4 + shadcn/ui 基线)、`apps/worker`、`packages/{core,ui,config}` 五个 workspace 成员；`apps/web` 的 `(public)` 路由组提供一个匿名可访问的首页壳层；`packages/config` 提供类型化环境变量解析与 `.env.example`。

## Boundaries & Constraints

**Always:**
- 栈版本必须严格对齐 ARCHITECTURE-SPINE.md 的 Stack 表：Node 24.18.0 LTS / TypeScript 5.9 / Next.js 16 (App Router) / React 19.2 / Tailwind 4 / shadcn-ui CLI 4 / Base UI 1.6.0 / PostgreSQL 18 / Prisma 7.7.0 / Redis 8 / BullMQ 5.79.3 / Playwright 1.60。pin 到该范围。
- 目录结构必须对齐 spine 的 Structural Seed：`apps/{web,worker}`、`packages/{core,ui,config}`；`apps/web/app/` 含 `(public)` 与 `(operator)` 两个路由组。
- 公共首页默认匿名可用：`(public)` 路径不得有任何强制登录 / 认证重定向（AD-8）。首页为 server component，无会话依赖。
- 环境变量结构由根 `.env.example` 显式声明（至少 `DATABASE_URL`、`REDIS_URL`、`NODE_ENV`），并由 `packages/config` 做类型化解析；Web 骨架在未配置 DB / Redis 时仍可构建与启动（首页不触达 DB）。
- 包管理器固定为 pnpm（spine 隐含 monorepo workspaces；pnpm 是该栈的标准选择）。

**Block If:**
- spine 中 pin 的某个版本在 npm 上尚未发布、导致无法安装（HALT，报告缺失版本与替代证据）。
- shadcn/ui 4 + Tailwind 4 + Next 16 无法按官方文档方式共存初始化（HALT，报告冲突与证据）。

**Never:**
- 不实现任何领域模块业务逻辑、Prisma schema、BullMQ job、采集 / 聚类 / 解释 / 发布链路（属于 Story 1.4–1.10）。
- 不实现导航、响应式布局或 design tokens / 排版体系（属于 Story 1.2 与 1.3）；`globals.css` 仅留 Tailwind 4 入口与空 `@theme` 占位。
- 不实现登录 / 账户 / 认证后端；本 story 只保证公共路径无登录墙。
- 不为未来 story 预建空业务子目录与占位业务逻辑（`packages/core` 不预建 source-ingest 等模块子目录，later scaffolds for itself）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 首页匿名渲染 | 访问 `/`，无 cookie / 会话 | HTTP 200，渲染公共首页壳层与默认入口文案；无任何 `/login` 重定向 | 无错误预期 |
| 全量构建 | `pnpm install` 后 `pnpm -r typecheck && pnpm --filter web build` | 所有 workspace 类型检查通过；web 生产构建成功 | 失败即构建 / 类型错误，需修复 |
| 缺 DB / Redis 启动 | 未设置 `DATABASE_URL` / `REDIS_URL`，构建并启动 web | 构建成功；首页静态壳层正常渲染（不触达 DB） | 缺连接不导致构建或首页崩溃 |
| shadcn 管线可用 | 已初始化 shadcn/ui CLI | `components.json` 存在，且 `shadcn add <基础组件>` 可成功添加 | CLI 初始化失败需修复配置后重试 |

</intent-contract>

## Code Map

- `package.json` -- monorepo 根 manifest，声明 workspace、共享脚本、`engines`(Node 24.18.0)
- `pnpm-workspace.yaml` -- 声明 `apps/*` 与 `packages/*` 为 workspace 成员
- `tsconfig.base.json` -- 所有 workspace 继承的共享 TS 配置
- `apps/web/` -- 可运行的公共 Web 应用（Next 16 App Router），本 story 的主要交付物
- `apps/web/app/layout.tsx` + `apps/web/app/(public)/page.tsx` -- 根布局与匿名首页壳层（server component，默认入口文案）
- `apps/web/app/(operator)/` -- 运营路由组占位（最小 placeholder，对齐 spine 双路由组结构，无功能）
- `apps/web/app/globals.css` -- Tailwind 4 入口（`@import "tailwindcss"` + 空 `@theme` 占位）
- `apps/web/components.json` -- shadcn/ui 4 配置（Base UI 1.6 基线）
- `apps/worker/` -- worker workspace 成员（仅 `package.json` + `tsconfig.json` + `src/index.ts` 占位，无 job 逻辑）
- `packages/config/src/env.ts` + 根 `.env.example` -- 类型化环境变量解析与示例文件
- `packages/core/`, `packages/ui/` -- workspace 成员（`package.json` + `tsconfig.json` + `src/index.ts` 占位，无业务逻辑 / tokens）
- `apps/web/e2e/home.spec.ts` -- Playwright 冒烟测试，覆盖首页匿名渲染矩阵行

## Tasks & Acceptance

**Execution:**
- `package.json` + `pnpm-workspace.yaml` -- 建立 pnpm monorepo，声明 workspace、`engines`、共享脚本（`install`/`build`/`typecheck`/`lint`）-- 为所有 workspace 提供统一入口
- `tsconfig.base.json` + 各包 `tsconfig.json` -- 共享 TS 5.9 配置继承，保证 `pnpm -r typecheck` 一致 -- 类型基线
- `apps/web/` -- 用 Next 16 App Router 初始化可运行应用（React 19.2 + TS 5.9 + 根 layout）-- 交付"可运行的公共 Web 应用骨架"
- `apps/web/app/(public)/page.tsx` -- 匿名首页 server component，渲染公共骨架与默认入口文案（无 mock 热点卡片）-- 满足匿名首页入口 AC
- `apps/web/app/(operator)/` -- 最小 placeholder 路由组（标注"1.1 未实现"）-- 对齐 spine 双路由组
- `apps/web/app/globals.css` + Tailwind 4 接入 -- CSS-first `@import "tailwindcss"` + `@tailwindcss/postcss`，空 `@theme` 占位 -- 为 1.3 预留接入点但不实现 token
- `apps/web/components.json` + shadcn/ui 4 初始化 -- 初始化 CLI 与 Base UI 1.6 基线，验证 `shadcn add` 可用 -- 落地"shadcn/ui 基线"
- `packages/config/src/env.ts` + `.env.example` -- 类型化环境变量解析（zod 校验 `DATABASE_URL`/`REDIS_URL`/`NODE_ENV` 等）与示例文件 -- 满足"环境变量结构与 spine 一致"
- `apps/worker/`、`packages/core/`、`packages/ui/` -- 各建为最小 workspace 成员（`package.json` + `tsconfig.json` + `src/index.ts` 空 stub），无业务逻辑 -- 对齐 spine 基础目录
- 根级 ESLint flat config + Prettier -- 统一 lint/format 基线，`pnpm -r lint` 可用 -- 代码风格基线
- `apps/web/e2e/home.spec.ts` -- Playwright 冒烟：访问 `/` 返回 200、渲染骨架文案、无登录重定向 -- 覆盖首页匿名矩阵行（surface-anchored AC）

**Acceptance Criteria:**
- Given 仓库仅有 BMAD 规划产物，When 用约定栈初始化 pnpm monorepo 并安装依赖，Then `apps/web` 是可运行的 Next 16 App Router 应用，And 依赖版本、`.env.example` 变量结构与基础目录均与 ARCHITECTURE-SPINE.md 的 Stack 与 Structural Seed 对齐。
- Given 用户首次访问 AGUHOT，When 首页加载完成，Then 用户看到公共页面骨架与默认首页入口，And 首页不强制登录即可浏览核心内容。

## Design Notes

Tailwind 4 为 CSS-first 配置：`globals.css` 中 `@import "tailwindcss";`，token 经 `@theme` 定义（token 内容留待 Story 1.3，本 story 仅留空 `@theme` / 注释占位），通过 `@tailwindcss/postcss` 插件接入，无需 `tailwind.config.js`。shadcn/ui 4 默认基于 Base UI，初始化生成 `components.json` 与 `lib/utils.ts`(`cn`)；本 story 只验证 CLI 管线可用，不强制安装业务组件。环境变量解析用最小自建（`packages/config/src/env.ts` 以 zod 校验并导出类型化 `env`），不引入额外配置框架；web 骨架首页为纯静态壳层、不依赖 DB 连接，故缺 `DATABASE_URL` 不阻塞构建。

## Verification

**Commands:**
- `pnpm install` -- expected: 安装成功，无致命 peer 依赖冲突
- `pnpm -r typecheck` -- expected: 所有 workspace 通过
- `pnpm -r lint` -- expected: 无错误
- `pnpm --filter web build` -- expected: Next 生产构建成功
- `pnpm --filter web e2e` -- expected: Playwright 冒烟通过，首页 `/` 返回 200、渲染骨架文案、无 `/login` 重定向

**Manual checks (if no CLI):**
- 确认 `apps/web/app/(public)/page.tsx` 为 server component 且无 auth / redirect；`apps/web` 无任何拦截 `(public)` 的中间件。

## Review Triage Log

### 2026-07-10 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 1, medium 0, low 0)
- defer: 5: (high 0, medium 4, low 1)
- reject: 12
- addressed_findings:
  - `[high]` `[patch]` shadcn 管线断裂：`apps/web/components.json` 含非 schema 字段 `"base": "base"`，导致 `shadcn add` 以 "Invalid configuration" 失败（matrix Row 4 与 spec 任务"验证 `shadcn add` 可用"未达成）。已在 matrix 审计阶段删除该字段，并用 pinned 的 `shadcn@4.12.0 add button` 验证管线可用（随后回退 button 与 radix-ui 以遵守"不强制安装业务组件"）。
  - 其余 5 条 defer 已写入 `deferred-work.md`（各自指向后续 story）；12 条 reject 为误报 / 推测 / 在 pnpm 工作流中未触发，已静默丢弃。

## Auto Run Result

Status: done

### 实施变更摘要
恢复并完成 Story 1-1（公共站点脚手架与匿名首页壳层）。先前 run 已提交正确对齐 spine 的 pnpm monorepo 脚手架（commit `dbea0a5`）；本 run 修补了使 spec 验证门失败的缺口，并修复一处 shadcn 管线断裂缺陷（matrix Row 4）。

### 变更文件（一行描述）
- `apps/web/components.json` — 删除非 schema 字段 `"base": "base"`，修复 `shadcn add` "Invalid configuration" 失败（matrix Row 4）
- `apps/web/next.config.ts` — 增 `allowedDevOrigins: ["127.0.0.1"]`，避免系统 HTTP 代理拦截 Playwright loopback HMR 探测
- `apps/web/playwright.config.ts` — baseURL/webServer.url 由 `localhost` 改 `127.0.0.1`，确定回环绑定
- `apps/web/package.json` — e2e 脚本加 `NO_PROXY/no_proxy=localhost,127.0.0.1`（试装 radix-ui 后已移除）
- `apps/worker/package.json`、`packages/{config,core,ui}/package.json` — 补 `eslint` + `typescript-eslint` devDep，使各 workspace `lint: eslint src` 可解析
- `eslint.config.js` — 根 ignores 增补 `_bmad/**`、`.agents/**`、`.claude/**`，避免 lint vendor 脚本
- `.gitignore` — 增加 `*.tsbuildinfo`；`git rm --cached` 全部 workspace 的 tsbuildinfo 缓存
- `pnpm-lock.yaml` — 依赖增删后重生成

### 评审结论分布
- patch：1（shadcn 管线修复，已应用并复验）
- defer：5（指向后续 story，见 `deferred-work.md`）
- reject：12（误报 / 推测 / pnpm 工作流中未触发）
- intent_gap / bad_spec：0

### 是否建议跟进评审
false —— 本评审 pass 未产生 review-driven 代码改动；shadcn 修复属 matrix 审计（验证）阶段产物且已复验全绿。

### 验证执行
- `pnpm install`：成功
- `pnpm -r typecheck`：5/5 workspace 通过
- `pnpm -r lint`：5/5 通过
- `pnpm --filter web build`：Next 16.2.10 构建成功，`/`、`/_not-found`、`/console` 静态预渲染（构建时未设 `DATABASE_URL`/`REDIS_URL`，覆盖 matrix Row 3）
- `pnpm --filter web e2e`：2/2 Playwright 通过（首页 200、骨架文案、无 `/login` 重定向，覆盖 matrix Row 1）
- shadcn 管线：`shadcn@4.12.0 add button` 成功创建组件（验证后回退，覆盖 matrix Row 4）
- AD-8 人工核对：无 `middleware.ts`；`(public)/page.tsx` 为纯 server component，无 auth / redirect / `"use client"`

### 残留风险 / 残留产物
- 5 条 defer 见 `_bmad-output/implementation-artifacts/deferred-work.md`（env 模块设计、`.npmrc` ignore-scripts、e2e/CI 自动化门、`/console` 公开路由、dark 主题死代码）。
- 磁盘构建缓存（`.next/`、`node_modules/`、`*.tsbuildinfo`）已 gitignore，不入产物。
