---
title: '视觉 token 与排版基础落地 (1.3)'
type: 'feature'
created: '2026-07-10'
status: 'done'
baseline_revision: 'bb1c6c4de8b78ef8742863996f99f934a42409fb'
final_revision: '9f84d10eba201ea9e3857e7e9762874e65cbb58a'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-aguhot-2026-07-09/DESIGN.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-2-responsive-navigation-and-public-shell.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** 1.1/1.2 只留了空 `@theme` 与裸 neutral 颜色：公共页面没有任何 DESIGN.md token（暖底画布 / 深墨文字 / 品牌-市场红绿解耦），排版也未落地（display 衬线 / sans 正文 / mono 数字三层无区分）；同时首页与运营台残留永不生效的 `dark:` 死代码 + `<html suppressHydrationWarning>`，深色 OS 下首页浅字叠白底不可读（1.1/1.2 已记入 deferred-work，绑定到本 story）。

**Approach:** 在 `apps/web/app/globals.css` 的 `@theme` 落地 DESIGN.md 全部颜色/字体/圆角 token 作为唯一语义来源；用 `next/font/google` 加载 IBM Plex Mono（数字层），CJK 显示/正文字体走 OS font-family stack；把公共壳层与各页面的 neutral 硬编码色全部改接到 token；移除全部 `dark:` 变体与 `suppressHydrationWarning`（DESIGN V1 仅暖底亮色）。新增一个极简匿名 `/design` 预览页 + 三个 token 驱动的 chip 原语（AI 标签 / 筛选胶囊 / 市场反应 chip），作为 AC 的 surface-anchored 验证面。

## Boundaries & Constraints

**Always:**
- 所有颜色/字体/圆角一律走 `globals.css` `@theme` token 工具类；DESIGN.md 为 token 唯一来源，取值逐字对齐。
- 红/绿仅表市场语义（涨/跌/平）；品牌色 `brand` 不得兼作行情色（DESIGN 解耦约束）。
- 市场反应 chip 必须同时带文本标签（涨/跌/平）与颜色（a11y 地板：色彩非唯一语义）。
- 公共路径匿名可用（继承 1.1 AD-8）：`/design` 为 server component，无会话依赖、无登录墙。
- 1.1 `home.spec.ts` 与 1.2 `navigation.spec.ts` 必须保持全绿（H1「AGUHOT」、导航结构/href/aria 不变）。

**Block If:**
- 构建期 Google Fonts（fonts.googleapis.com / gstatic）不可达致使 `pnpm --filter web build` 失败（本轮已确认可达；若 CI/沙箱阻断则 HALT）。
- 任一公共页面或 `/design` 在匿名访问下触发重定向或需要会话（违反 AD-8）。

**Never:**
- 不接入 theme provider / 暗色 token / `prefers-color-scheme` 分支（DESIGN V1 仅亮色；暗色需另立 story 配套 token）。
- 不为 CJK 字体引入本地字体文件或打包 Source Han woff2（体积过大；走 OS stack）。
- 不实现真实热点流 / 过滤器 / 卡片 / 证据时间线 / 详情内容（属 1.7、1.8）；`/design` 仅为 token 预览，无业务数据、无 mock。
- 不在页面内硬编码颜色 hex 或内联 `font-family`（一律走 `@theme` token 工具类）。
- 不新增 `tailwind.config.js`（Tailwind 4 CSS-first）；不引入新依赖（`next/font/google` 为 Next 内置）。
- 不改 1.1 `home.spec` / 1.2 `navigation.spec` 既有断言文本与结构。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 暖底画布落地 | 访问 `/`、`/daily`、`/design` 等任意公共页面 | `body` 背景为 `canvas` 暖底、默认文字 `ink-primary`、默认字体 `font-sans`（computed CSS 锚定） | 无错误预期 |
| 排版三层可读 | 访问 `/design` 排版区 | 渲染 display 衬线标题、sans 正文、mono 数字三类样本，三者字体族不同 | 无错误预期 |
| chip 语义统一 | `/design` 渲染 AI 标签 / 筛选胶囊 / 市场反应 chip | 各 chip 使用 `@theme` token 派生 class（accent-warm / brand+surface / market-up\|down\|flat），带「AI」「涨/跌/平」文本 | 无错误预期 |
| 深色死代码清理 | `prefers-color-scheme: dark` 下访问公共页面 | 页面仍为暖底亮色（DESIGN 仅 V1 亮色）；无 `dark:` 变体残留、`<html>` 无 `suppressHydrationWarning` | 无错误预期 |
| 既有用例无回归 | 运行 `home.spec` / `navigation.spec` | 全绿；H1「AGUHOT」、nav aside/banner/dialog 结构与 href 不变 | 无错误预期 |

</intent-contract>

## Code Map

- `apps/web/app/globals.css` -- MODIFY：`@theme` 落地 DESIGN 全部颜色（`--color-canvas/surface-base/surface-raised/surface-muted/ink-primary/ink-secondary/ink-tertiary/border-hairline/brand/brand-foreground/accent-warm/accent-warm-foreground/market-up(-soft)/market-down(-soft)/market-flat(-soft)/focus-ring/overlay`）、字体（`--font-display/sans/mono`）、圆角（`--radius-sm/md/lg/xl`）。画布/文字/默认字体不在此重复设置——由 `layout.tsx` 的 `<body className>` 统一承担（避免 `@layer base` 与 className 双写）
- `apps/web/app/layout.tsx` -- MODIFY：`next/font/google` 加载 `IBM_Plex_Mono` 注入 `--font-plex-mono` 于 `<html>`；`<body>` 接 `bg-canvas text-ink-primary font-sans antialiased`；移除 `suppressHydrationWarning`
- `apps/web/app/(public)/page.tsx` -- MODIFY：移除 `dark:` 死代码；neutral 文字色 → ink token；品牌字 H1「AGUHOT」保持 sans-bold（与 nav logo 一致）
- `apps/web/app/(public)/_components/public-nav.tsx` -- MODIFY：侧栏/顶部栏/抽屉的 neutral → surface/border/ink token（surface-base 底、border-hairline 线、ink 文字、overlay 用 `bg-overlay`）
- `apps/web/app/(public)/daily/page.tsx`、`topics/page.tsx`、`favorites/page.tsx` -- MODIFY：neutral 文字 → ink token；中文 H1 → `font-display`
- `apps/web/app/(operator)/console/page.tsx` -- MODIFY：移除 `dark:` 死代码；neutral → ink token
- `apps/web/components/chips.tsx` -- NEW：`AiLabel` / `FilterPill` / `ReactionChip` 三个 token 驱动展示型原语（accent-warm / brand+surface / market-up\|down\|flat，`rounded-full`，涨跌平文本标签，数字 `font-mono`）
- `apps/web/app/(public)/design/page.tsx` -- NEW：极简匿名设计系统预览页（排版 display/headline/title/body/body-sm/label/numeric 样本 + 分组色板 + 三类 chip），AC1/AC2 的 surface-anchored 验证面
- `apps/web/e2e/design.spec.ts` -- NEW：`/design` 200 且无 `/login`；AI 标签、筛选胶囊默认+激活、市场反应涨/跌/平 可见；display 衬线标题可见；`body` 背景为 canvas token（`toHaveCSS` 锚定）

## Tasks & Acceptance

**Execution:**
- `apps/web/app/globals.css` -- 在 `@theme` 写入 DESIGN 全部颜色/字体/圆角 token（取值逐字对齐 DESIGN.md）；不新增 `@layer base`（画布/文字/默认字体由 `<body className>` 承担，避免双写） -- 单一 token 来源
- `apps/web/app/layout.tsx` -- `import { IBM_Plex_Mono } from "next/font/google"`，`const plexMono = IBM_Plex_Mono({ subsets:["latin"], weight:["500"], variable:"--font-plex-mono", display:"swap" })`，`<html className={plexMono.variable} lang="zh-CN">`（删 `suppressHydrationWarning`），`<body className="bg-canvas text-ink-primary font-sans antialiased">` -- 注入数字字体 + 画布默认 + 清理水合模板残留
- `apps/web/app/(public)/_components/public-nav.tsx` -- 把 `bg-neutral-50`→`bg-surface-base`、`border-neutral-200`→`border-border-hairline`、`text-neutral-700/900`→`text-ink-secondary/ink-primary`、`bg-neutral-100`→`bg-surface-muted`、`bg-white`→`bg-surface-raised`、`bg-black/40`→`bg-overlay` -- 壳层 chrome 接入 token（含 mobile 抽屉）
- `apps/web/app/(public)/page.tsx` -- 删全部 `dark:` 类；`text-neutral-600/700`→`text-ink-secondary/ink-primary`；H1「AGUHOT」保留 `font-bold`（sans，与 logo 一致） -- 首页接 token + 清死代码
- `apps/web/app/(public)/daily/page.tsx`、`topics/page.tsx`、`favorites/page.tsx` -- `text-neutral-600/700`→ink token，H1 加 `font-display` -- 占位页接 token + 落地衬线大标题
- `apps/web/app/(operator)/console/page.tsx` -- 删 `dark:`；`text-neutral-700`→`text-ink-secondary` -- 运营台占位清死代码 + 接 token
- `apps/web/components/chips.tsx` -- NEW 三个原语：`AiLabel`（`bg-accent-warm text-accent-warm-foreground`，文案「AI」）；`FilterPill({active})`（默认 `bg-surface-base text-ink-secondary`、active `bg-brand text-brand-foreground`）；`ReactionChip({tone:"up"|"down"|"flat", value})`（up→`market-up`/「涨」、down→`market-down`/「跌」、flat→`market-flat`/「平」，底用对应 `-soft`，`value` 用 `font-mono`）-- AC2 复用原语，验证 token 可消费
- `apps/web/app/(public)/design/page.tsx` -- NEW 极简预览：排版样本区（display `font-display`、headline/title/body/body-sm `font-sans`、numeric `font-mono` 各一行真实中文/数字样本）、色板区（canvas/surface/ink/brand/accent-warm/market 各一块 `bg-*` + 文字标签）、组件区（`<AiLabel/>`、`<FilterPill>` 默认+激活、`<ReactionChip tone="up|down|flat"/>`）；server component、无会话 -- AC1/AC2 surface 验证面
- `apps/web/e2e/design.spec.ts` -- NEW：默认 describe：`/design` 返回 200 且 URL 不含 `/login`；`getByText("AI")` 可见；筛选胶囊默认 + 激活可见；`getByText("涨")`/`"跌"`/`"平"` 可见；display 区标题可见；`expect(page.locator("body")).toHaveCSS("background-color", "rgb(245, 241, 232)")` 锚定 canvas token（浏览器将 hex 序列化为 rgb）。另起 `colorScheme: "dark"` describe：断言同一 `body` 背景仍为 `rgb(245, 241, 232)`（暖底亮色不变，钉住 AC3）；不触碰 home/navigation 既有断言 -- surface-anchored 覆盖矩阵全部行

**Acceptance Criteria:**
- Given `globals.css` `@theme` 已落地，When 任意公共页面加载，Then 暖底 `canvas`、深墨 `ink-primary`、品牌 `brand` 与市场红绿 `market-up/down` 解耦的视觉 token 生效为 Tailwind 工具类，And 标题（`font-display`）/正文（`font-sans`）/数字（`font-mono`）三类文本层级稳定可读。
- Given `/design` 渲染 AI 标签、筛选胶囊与市场反应 chip，When 组件渲染，Then 它们使用 `@theme` token 派生的统一语义 class，And 页面内不存在任何硬编码颜色或字体值。
- Given DESIGN V1 仅有暖底亮色，When `prefers-color-scheme: dark` 下访问公共页面，Then 页面保持暖底亮色、无 `dark:` 变体残留、`<html>` 不再带 `suppressHydrationWarning`。

## Review Triage Log

### 2026-07-10 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 1, low 1)
- defer: 2: (high 0, medium 0, low 2)
- reject: 17
- addressed_findings:
  - `[medium]` `[patch]` chip 颜色未断言（AC2 brand/market 解耦无保护——visibility-only 测试无法捕获 tone 错色，如「涨」渲染为绿）→ `apps/web/e2e/design.spec.ts` 新增「chip 颜色锚定 @theme token 与品牌/市场解耦」测试：AiLabel(accent-warm)、激活 FilterPill(brand)、涨/跌/平 chip(market-*-soft 底 + market-* 文字) 全部 `toHaveCSS` 锚定。
  - `[low]` `[patch]` 排版三层仅断言 H1 可见、未断言字体族互异（AC1「三类层级」可静默塌缩为单族）→ `design.spec.ts` 新增「排版三层 font-display/sans/mono 互异」测试：比较 display/body/numeric 三样本 computed `font-family` 字符串互异。
  - `[low]` `[defer]` `--color-focus-ring` 已落地但无交互元素消费（导航链接/汉堡按钮无 focus-visible 焦点环，1.2 即如此）→ 登记至 `deferred-work.md`，归 Epic 3.5 可达性基线。
  - `[low]` `[defer]` `ReactionChip` flat 对比度约 3.4:1（DESIGN 源 market-flat 取值，非实现偏差）→ 登记至 `deferred-work.md`，待 1.7+ 真实 chip 落地做 WCAG 校验。
  - reject 17：body 画布为根布局全局 class（逐路由 dark-scheme / canvas 断言冗余）；`toHaveCSS` rgb 仅 chromium 序列化（当前仅 chromium project，多引擎为假设）；`plexMono.variable` 不会为 undefined（next/font 保证字符串）；离线构建无回退（spec Block-If 已覆盖 + 残留风险已记）；`/design` 静态日期 / overlay rgba 格式 / JSX 内 `//` 注释（cosmetic，编译通过）；FilterPill 默认加边框（偏离 DESIGN bg-only 规格）；暗色色块标签对比度（标签在画布上非色块上，已撤回）；AiLabel tracking 与 body 行高（预览打磨超 AC）；无消费者的单 token 保真（本 story 无行为消费者，色板即视觉证明）；占位 H1 `font-semibold`（DESIGN display 600 faithful）等。

## Design Notes

**字体策略（ponytail 取舍）：** AC1 命名「标题/正文/数字」三层 → 数字层 `IBM Plex Mono` 经 `next/font/google` 加载（Latin 轻量、构建期可达性已确认）；display（Source Han Serif SC）与 sans（Source Han Sans SC）走 `@theme` font-family stack + OS CJK fallback（`"Noto Serif SC", ui-serif, serif` / `"Noto Sans SC", ui-sans-serif, system-ui, sans-serif`），避免 CJK webfont 的构建体积与子集脆弱性——目标用户 OS 自带 CJK 字形，token 已指名首选族，OS 仅做替换。DESIGN 的 `label`（IBM Plex Sans）非 AC1 三层之一，chip 用 `font-sans` + `uppercase tracking-wide text-xs` 近似；Plex Sans 标签字面登记 `deferred-work.md`，待 1.7+ 标签保真度需要时再加载（升级路径：加一行 `--font-label` token）。

**暗色清理：** DESIGN.md V1 仅定义暖底亮色、无任何暗色 token，故本 story 一次性移除首页/运营台全部 `dark:` 死代码与 `<html suppressHydrationWarning>`（1.1/1.2 两条 deferred 绑定项），确立单一亮色主题。若未来需暗色，另立 story 配套暗色 token 与 theme provider，不在本 story 预埋。

**品牌字一致性：** 「AGUHOT」品牌字（首页 H1 与 nav logo）统一用 sans-bold；中文页 H1（日报/主题/收藏/`/design` display 样本）用 `font-display` 衬线，落地 DESIGN「大标题衬线、编辑感」。

**`/design` 定位：** token 预览面，非业务页；匿名可达（AD-8）、不进主导航（仅作 URL 可达），1.7/1.8 消费同一 `@theme` token 而非本页。

**`@theme` 范式（golden example，取值逐字对齐 DESIGN.md，此处节选）：**
```css
@theme {
  --color-canvas: #F5F1E8;
  --color-surface-base: #FBF8F2; --color-surface-raised: #FFFFFF; --color-surface-muted: #EEE6D8;
  --color-ink-primary: #151A22; --color-ink-secondary: #5D6470; --color-ink-tertiary: #8A909A;
  --color-border-hairline: #DDD4C4;
  --color-brand: #213B63; --color-brand-foreground: #FFFFFF;
  --color-accent-warm: #B86633; --color-accent-warm-foreground: #FFF8F1;
  --color-market-up: #C43C32; --color-market-up-soft: #F8E0DD;
  --color-market-down: #0E8B5B; --color-market-down-soft: #DDF2E9;
  --color-market-flat: #8E7759; --color-market-flat-soft: #EFE7DA;
  --color-focus-ring: #335A91; --color-overlay: rgba(21,26,34,0.42);
  --font-display: "Source Han Serif SC", "Noto Serif SC", ui-serif, serif;
  --font-sans: "Source Han Sans SC", "Noto Sans SC", ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-plex-mono), ui-monospace, monospace;
  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 14px; --radius-xl: 20px;
}
```

## Verification

**Commands:**
- `pnpm -r typecheck` -- expected: 全 workspace 通过（含 `tsconfig.e2e.json`）
- `pnpm -r lint` -- expected: 无错误
- `pnpm --filter web build` -- expected: Next 生产构建成功，`/`、`/daily`、`/topics`、`/favorites`、`/console`、`/design` 均可静态预渲染（构建期 `next/font/google` 拉取 IBM Plex Mono；未设 `DATABASE_URL`/`REDIS_URL`）
- `pnpm --filter web e2e` -- expected: 1.1 `home.spec`、1.2 `navigation.spec` 无回归；`design.spec` 全绿

**Manual checks (if no CLI):**
- 暖底画布肉眼可见（非纯白）；中文页 H1 为衬线、数字样本为等宽；AI 标签为暖橙、涨红跌绿且各带文本标签；深色 OS 偏好下页面不变暗。

## Auto Run Result

Status: done

### 实施变更摘要
交付 Story 1-3（视觉 token 与排版基础落地）。在 `apps/web/app/globals.css` `@theme` 落地 DESIGN.md 全部颜色/字体/圆角 token 作为唯一语义来源；`layout.tsx` 经 `next/font/google` 加载 IBM Plex Mono（数字层）、`<body>` 接 `bg-canvas text-ink-primary font-sans antialiased`、移除 `suppressHydrationWarning`；公共壳层（侧栏/顶部栏/抽屉）与首页/日报/主题/收藏/运营台各页面的 neutral 硬编码色全部改接到 token，首页与运营台的 `dark:` 死代码一并清除（解 1.1/1.2 两条 deferred）。新增三个 token 驱动 chip 原语（`AiLabel`/`FilterPill`/`ReactionChip`）与匿名 `/design` 预览页作为 AC1/AC2 的 surface-anchored 验证面。

### 变更文件（一行描述）
- `apps/web/app/globals.css` — MODIFY：`@theme` 落地 DESIGN 全部 color/font/radius token（单一来源）
- `apps/web/app/layout.tsx` — MODIFY：`next/font/google` IBM Plex Mono 注入 `--font-plex-mono`、`<body>` 画布/文字/默认字体、移除 `suppressHydrationWarning`
- `apps/web/app/(public)/_components/public-nav.tsx` — MODIFY：侧栏/顶部栏/抽屉 neutral→surface/border/ink/overlay token
- `apps/web/app/(public)/page.tsx` — MODIFY：移除 `dark:`、neutral→ink token（品牌字 H1 保持 sans-bold）
- `apps/web/app/(public)/daily/page.tsx`、`topics/page.tsx`、`favorites/page.tsx` — MODIFY：neutral→ink token、中文 H1→`font-display`
- `apps/web/app/(operator)/console/page.tsx` — MODIFY：移除 `dark:`、neutral→ink token
- `apps/web/components/chips.tsx` — NEW：`AiLabel`/`FilterPill`/`ReactionChip` 三个 token 驱动原语
- `apps/web/app/(public)/design/page.tsx` — NEW：匿名 token 预览页（排版/色板/chip），AC 验证面
- `apps/web/e2e/design.spec.ts` — NEW：`/design` 200 + chip 颜色锚定（AC2 解耦）+ 排版三层字体族互异（AC1）+ canvas body 背景 + `colorScheme:"dark"` 亮色保持（AC3）
- `_bmad-output/implementation-artifacts/deferred-work.md` — MODIFY：登记 Plex Sans label / focus-ring 消费 / market-flat 对比度三条 defer，并标注 1.2 dark-strategy 已解决

### 评审结论分布
- patch：2（1 medium chip 颜色断言、1 low 排版字体族互异断言；均已应用并复验 17/17 e2e 全绿）
- defer：2（focus-ring 无消费者→Epic 3.5；market-flat 对比度→1.7+ WCAG 校验）
- reject：17（冗余 / 假设 / 非真实 / cosmetic / DESIGN-faithful）
- intent_gap / bad_spec：0

### 是否建议跟进评审
false —— 本评审 pass 的改动仅为 `design.spec.ts` 单文件的 2 条测试加固（钉住 AC2 brand/market 解耦与 AC1 字体族互异），无产品代码/行为/API/安全/数据面变更，范围窄、仅强化验证覆盖。

### 验证执行
- `pnpm -r typecheck`：5/5 workspace 通过（含 `tsconfig.e2e.json`）
- `pnpm -r lint`：5/5 通过
- `pnpm --filter web build`：Next 16.2.10 构建成功，`/`、`/_not-found`、`/console`、`/daily`、`/design`、`/favorites`、`/topics` 均 `○ (Static)` 静态预渲染（构建期 `next/font/google` 拉取 IBM Plex Mono；未设 `DATABASE_URL`/`REDIS_URL`）
- `pnpm --filter web e2e`：17/17 通过（8 条 `design.spec` 含新增 chip 颜色 + 排版字体族互异 + dark-scheme 亮色保持；2 条 1.1 `home.spec`；7 条 1.2 `navigation.spec`，全无回归）
- 单一来源不变量复核：`dark:`/`suppressHydrationWarning`/`neutral-*`/`bg-white`/`bg-black`/内联 `font-family` 在 `app`+`components` 下零活用（仅余 4 处 explanatory 注释；19 个 hex 全部集中于 `globals.css` `@theme`）

### 残留风险 / 残留产物
- IBM Plex Mono 经 `next/font/google` 构建期自托管拉取；本环境已确认 fonts.googleapis.com 可达且构建通过。若 CI/沙箱阻断出网，`pnpm --filter web build` 将按 spec Block-If 失败（需 CI 侧确认出网）。
- CJK 显示/正文字体（Source Han Serif/Sans SC）走 OS font-family stack + fallback；目标用户 OS 自带 CJK 字形，无 CJK 字体的环境回退到通用 serif/sans（e2e 在 headless chromium 上验证字体族 token 互异，不验证具体 CJK 字形）。
- focus-ring 未被交互元素消费、market-flat chip 对比度——见 `deferred-work.md`。
- 工作树残留（构建/测试缓存 `*.tsbuildinfo`、`.next/`、`test-results/` 等）已 gitignore，不入产物。
