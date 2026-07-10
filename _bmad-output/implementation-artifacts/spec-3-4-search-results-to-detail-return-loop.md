---
title: '搜索结果到详情页的回访闭环 (3.4)'
type: 'feature'
created: '2026-07-11'
status: 'done'
review_loop_iteration: 0
baseline_revision: '7631bdd1dc324905db56cc1046891bab730e97ce'
final_revision: '5908516677eb77dc5eefe8c8ed58995e6332c843'
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-1-hot-event-and-theme-search.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-5-cross-surface-context-return-loop.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Verbatim intent (Story 3.4, epics.md):** "As a 市场观察用户, I want 从搜索结果进入详情后还能稳定回到原结果列表, So that 我可以沿着同一查询上下文继续寻找相关热点。" AC1: "Given 用户输入关键词并获得搜索结果, When 从结果列表进入某个热点事件详情页后执行返回, Then 页面回到原搜索结果列表, And 原关键词、排序与结果上下文保持不变。" AC2: "Given 用户从搜索结果进入详情页, When 浏览器返回状态不可恢复, Then 页面提供明确的「返回搜索结果」入口, And 该入口带回原查询词而不是空白搜索页。"

**Problem:** AC1 的「回到原搜索结果列表 + 原关键词/排序/上下文」**已由 2.5 + 3.1 落地**——`<ListContextMemory/>` 在点 `/events/` 时捕获 `/search?q=…` + scroll、`/search` 已在 `isValidListReturn` allowlist、详情页 `<BackLink>` 已恢复该 URL（query 保留），3.1 e2e test 9 已证。但 AC2 的「明确的『返回搜索结果』入口」**未落地**：详情页 `<BackLink>` 的 label **恒为「← 返回首页」**（静态 children），即使读者来自搜索也只显示「返回首页」——既不「明确」告知有回搜索结果的路，也未把入口语义与查询来源对齐。3.1 Never 与 deferred-work 明示「3.4 own 的显式『返回搜索结果』入口与 bfcache 不可恢复兜底」，2.5 deferred-work 亦把「浏览器 back/bfcache 不可恢复时的兜底」指向本 story。读者从搜索进详情后，除依赖浏览器 back（bfcache 命中则可、未命中/隐私模式/直访则 query 丢失或不可达），页面上没有一个**显式、带原查询词、history 无关**的回搜索入口。

**Approach:** **纯 web 层、零 core/DB/worker/迁移改动。** 把详情页唯一的 `<BackLink>`（2.5 depth cap：BackLink 仅用于详情页）做成**来源感知**：新增纯 helper `isSearchReturn(raw)`（`new URL(raw,"http://localhost")` + origin 严格等值 + pathname **精确** `"/search"`，与 `isValidListReturn` 同信任边界套路；拒 `/search/../console`、`/search//evil.com`、跨站）。`<BackLink>` 增一个可选 `searchLabel?: ReactNode` prop——`useSyncExternalStore` 读出的 `fromHref` 经 `isSearchReturn` 为真时渲染 `searchLabel`（「← 返回搜索结果」），否则渲染既有 `children`（「← 返回首页」）；**href 逻辑不变**（仍 `fromHref ?? fallback`，故 `/search?q=…` 原样恢复、query 原封带回——绝非空白 `/search`）。详情页给 BackLink 传 `searchLabel="← 返回搜索结果"`。SSR/首渲 `fromHref=null` → 渲染 `children`「返回首页」（与今日字节一致，既有断言不破、无 hydration mismatch），hydrate 后读 sessionStorage 才可能切到「返回搜索结果」（与既有 href 切换同模式）。这个显式 `<a href="/search?q=…">` 即 AC2 要的**页面级、history 无关、带原查询词**的兜底入口——不依赖 bfcache/back，刷新/直访/隐私模式诚实降级。ponytail：一纯 helper（信任边界分类，6 行）+ BackLink 一可选 prop + 详情页传一 prop + 一条既有 selector 跟随新 label 更新 + 独立 `@search-return` e2e（复用 `seedSearchContext`，零新 seed）。

## Boundaries & Constraints

**Always:**
- 显式入口语义对齐来源（AC2）：`fromHref` 为合法 `/search?…` URL（`isSearchReturn` 真）→ label「← 返回搜索结果」+ href=`/search?q=…`（**带原 query**，非空白 `/search`，非 `/`）。该入口是页面级真实 `<a>`（键盘可达、可 focus、可中键新开，UX-DR13；沿用既有返回链样式 token，零新视觉）。
- href 行为字节不变（AC1 不回归）：BackLink 的 href 仍是 `fromHref ?? fallback`、`onClick` 仍仅在 `fromHref !== null` 时写 `RESTORE_MARKER`（2.5 scroll 恢复基建不动）。从搜索点 BackLink 回搜索仍经 2.5 marker 恢复 query+scroll（3.1 e2e test 9 已证的 AC1 路径保持）。
- 信任边界（AC2 反面 + 2.5 AC6 延续，**不可简化**）：`isSearchReturn` 用 `new URL(raw,"http://localhost")` 解析——`origin !== "http://localhost"` 拒（拦 `https://evil`、`//evil`、`/\evil`）；pathname 必须**精确** `"/search"`（拒 `/search/../console` normalize 后的 `/console`、拒 `/search//evil.com`、拒 `/search/X`）；raw 空/畸形→false。任何篡改/越权 returnContext → label 回退「返回首页」、href 回退 `/`，**绝不**产生站外跳转、**绝不**把非搜索来源误标成搜索。
- 诚实降级（NFR 一致）：直访/外链/隐私模式（RETURN_CONTEXT 缺/不可读/校验失败）→ label「返回首页」、href `/`；**不**伪造查询词、**不**在没有来源信息时硬渲「返回搜索结果」（无来源却显示回搜索 = 死链/误导）。
- SSR 安全（build 不变量延续 2.5/3.1）：`<BackLink/>` 仍 `"use client"`、`useSyncExternalStore` 的 `getServerSnapshot` 仍返 null → SSR + 首渲 label=children「返回首页」、href=fallback（与今日字节一致）。hydrate 后才可能切 label——与既有 href 切换同一 effect 时机，无 hydration mismatch。`pnpm --filter web build` 无 `DATABASE_URL` 仍成功（本 story 不动任何 `@aguhot/core` import 或路由动态性）。
- a11y（UX-DR13）：显式入口为真实 `<a href>`（非 JS button）；「返回搜索结果」文案对屏幕阅读器可读、可 focus。沿用既有返回链 className（`inline-flex items-center gap-1 text-sm text-ink-secondary hover:text-ink-primary`），零新 token/间距。
- 不变性约定（沿用 1.4~3.3）：`const … as const` + union（禁 `enum`，`erasableSyntaxOnly`）；`import type` 用于类型；`isSearchReturn` 是 `list-context-memory.tsx` 内导出纯函数（与 `isValidListReturn`/`scrollKey` 同源，单一 URL 解析套路）；camelCase。

**Block If:**
- 改 BackLink 致 `pnpm --filter web build`（无 `DATABASE_URL`）失败 → HALT。
- 改 BackLink/`isSearchReturn` 致 `pnpm -r typecheck`/`pnpm -r lint` 回归 → HALT。
- 本地 PG `aguhot_dev` 不可达致 `e2e:search-return`（复用 `seed:search` 造数）失败 → HALT（不得跳过 e2e）。
- `loop.spec`（2.5 三向返回 home/theme/daily）/`detail.spec`（直访 fallback）/`search.spec`（除「返回恢复」一条 selector 外）因本 story 回归 → HALT（BackLink href 行为字节不变、home/theme/daily/直访 origin 的 label 仍「返回首页」、2.5 depth cap 不破）。

**Never:**
- 不改 `<BackLink>` 的 href 逻辑 / `onClick` marker 写法 / `useSyncExternalStore` 适配（2.5 AC1~AC7 基建字节不变；本 story 仅在「label 选择」这一维度上加一个可选 prop）。
- 不改 `<ListContextMemory/>` 的捕获/恢复逻辑 / `isValidListReturn` / allowlist（2.5+3.1 已落地；`/search` 已在 allowlist，本 story 不碰）。
- 不改 core / prisma / worker / 任何 `@aguhot/core` 导出 / 任何 schema / migration（本 story 纯 web 层）。
- 不新增 sessionStorage key / 不写 `?from=` URL 参 / 不引入 Provider/Context/状态库（沿用 2.5 sessionStorage + useSyncExternalStore 套路）。
- 不做 bfcache/browser-back 的 scroll 恢复（`history.scrollRestoration` / `pageshow`）——那是 2.5 deferred-work 的**通用**机制（非搜索专属），本 story 的「bfcache 不可恢复兜底」= 显式入口本身（页面级、history 无关），不扩张到改 history 语义。不做多级返回栈/面包屑/前进恢复（UX-DR12 一层上限）。
- 不把 label 来源感知扩到 home/theme/daily origin（AC 与 defer 仅点名 search；home/theme/daily 仍「返回首页」label 不变，避免 2.5 loop.spec 回归 + 超出 3.4 范围）。
- 不在显式入口文案里回显裸 query 字符串（如「返回搜索结果「芯片」」）——href 已带 query 满足「带回原查询词」，label 回显裸 query 是 UX 噪音 + 长 query 撑坏布局，defer。
- 不改 1.1~3.3 既有 seed/verify/既有 `@*` spec 断言——**唯一例外**：`search.spec.ts` 的「返回恢复」用例（line ~491）原 selector `/返回首页/` 在搜索来源下不再命中（label 切成「返回搜索结果」），须把该 selector 更新为 `/返回搜索结果/`（断言意图「BackLink 恢复搜索 URL」不变，仅跟随新 label 文案——这是 3.4 改 label 的必然结果，非回归）。其余既有 spec 零改动。
- 不新增 seed 脚本（`@search-return` 复用 `seedSearchContext`：`e2e:search-return` 先跑 `tsx e2e/seed-search.ts` 再 `--grep @search-return`，与 `e2e:search` 同构）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 搜索来源详情页（AC2） | 读者 `/search?q=芯片` 点 EventCard → `/events/{id}`；`RETURN_CONTEXT="/search?q=芯片"` | BackLink hydrate 后 label「← 返回搜索结果」、href `/search?q=芯片`（带原 query，非空白 `/search`、非 `/`） | 无错误预期 |
| 点显式入口回搜索（AC1） | 点上述「返回搜索结果」 | 导航至 `/search?q=芯片`；search 服务端按 q 确定性重渲同排序；2.5 marker 恢复原 scroll | 无错误预期 |
| bfcache 未命中/刷新（AC2 兜底） | 在 `/events/{id}` 上 `page.reload()`（sessionStorage RETURN_CONTEXT 持久） | 显式「返回搜索结果」仍在、href 仍带 query（页面级真实 `<a>`，不依赖 bfcache/history） | 无错误预期 |
| 直访/外链无来源 | 直接 `GET /events/{id}`（无 RETURN_CONTEXT） | label「← 返回首页」、href `/`（无伪造 query） | 无错误预期 |
| home/theme/daily 来源（不回归） | `RETURN_CONTEXT="/?window=7d"` / `/topics/{slug}` / `/daily?date=D` | label 仍「← 返回首页」（isSearchReturn 假）、href=该来源（2.5 行为字节不变） | 无错误预期 |
| 篡改 search URL（信任边界） | `RETURN_CONTEXT` 改为 `/search//evil.com` / `/search/../console` / `https://evil.com` | isSearchReturn 假 → label「返回首页」、href `/`；**不**站外跳转、**不**误标搜索 | 静默回退 |
| 隐私模式（storage 不可用） | sessionStorage 读写抛错 | fromHref null → label「返回首页」、href `/`；页面正常浏览 | 静默降级 |
| SSR/首渲（build 不变量） | 服务端渲染详情页（无 window） | label=children「返回首页」、href=fallback `/`（与今日字节一致）；hydrate 后 effect 读 storage 方可能切 | 无错误预期 |

</intent-contract>

## Code Map

- `apps/web/app/(public)/_components/list-context-memory.tsx` -- MODIFY（新增导出，既有内容零改动）：新增并 `export function isSearchReturn(raw: string | null | undefined): boolean`——`typeof raw !== "string" || raw === ""` → false；`new URL(raw, "http://localhost")` 解析（catch → false）；`url.origin !== "http://localhost"` → false；`url.pathname === "/search"` → true，否则 false。注释点明：与 `isValidListReturn` 同信任边界套路（origin 严格等值拦协议相对/绝对/反斜杠外链；pathname **精确** `/search` 拒 `/search/../console`(normalize 为 /console)、`/search//evil.com`、`/search/{x}`）；供 `<BackLink>` 选 label；search 已在 `LIST_PATH_EXACT` allowlist 故 `isSearchReturn` 真 ⇒ `isValidListReturn` 亦真（子集），但 `isSearchReturn` 仅判「是不是搜索来源」这一 label 维度。
- `apps/web/app/(public)/_components/back-link.tsx` -- MODIFY：(1) `import { isSearchReturn } from "./list-context-memory"`（追进既有 import 块）；(2) `BackLinkProps` 增 `searchLabel?: ReactNode`（可选——「来自搜索时渲染的显式入口 label，如 `← 返回搜索结果`；缺省则不区分搜索来源、始终渲染 children，向后兼容」）；(3) 组件内 `const label = fromHref !== null && isSearchReturn(fromHref) ? (searchLabel ?? children) : children;`，`return <Link href={href} ...>{label}</Link>`。**href（`fromHref ?? fallback`）与 onClick（`fromHref !== null` 写 marker）字节不变**。注释更新：label 现来源感知——`fromHref` 为合法 `/search?…` 时渲染 `searchLabel`（Story 3.4 显式「返回搜索结果」入口，AC2），否则 children；SSR/首渲 fromHref null → children（与既有裸链字节一致）。
- `apps/web/app/(public)/events/[hotEventId]/page.tsx` -- MODIFY（仅 BackLink 调用处 + 注释）：既有 `<BackLink fallback="/" className="…">…← 返回首页</BackLink>` 增 `searchLabel` prop：`<BackLink fallback="/" searchLabel={<><span aria-hidden>←</span> 返回搜索结果</>} className="…">{<><span aria-hidden>←</span> 返回首页</>}</BackLink>`（children 保持「返回首页」为非搜索来源默认）。返回链上方注释更新：补「Story 3.4 — 来自搜索（`/search?q=…`）时 BackLink 渲染显式『返回搜索结果』入口，带原 query（AC2）；其余来源仍『返回首页』。href/scroll 恢复仍走 2.5 基建（AC1）。」其余六分区/证据/反应/关联/主题零改动。
- `apps/web/e2e/search.spec.ts` -- MODIFY（仅「返回恢复」用例 line ~491 的 selector，断言意图不变）：该用例 selector `page.getByRole("link", { name: /返回首页/ })` → `page.getByRole("link", { name: /返回搜索结果/ })`（因从 `/search?q={titleQuery}` 进详情，hydrate 后 label 切成「返回搜索结果」）。`expect.poll(...href...).toContain("/search")` 与点击后 `toHaveURL(/q=…/)` 断言**不变**（AC1 行为字节不变）。用例顶部注释补一句「3.4：来自搜索时 BackLink label 为『返回搜索结果』」。其余 17 用例零改动。**「/search 开放重定向守卫」用例不动**（其 RETURN_CONTEXT 被篡改为 `/search/../console` 等 → `isSearchReturn` 假 → label 仍「返回首页」→ `/返回首页/` selector 仍命中、href `/` 断言不变）。
- `apps/web/e2e/search-return.spec.ts` -- NEW（`describe` 标题含 `@search-return`，`test.describe.configure({mode:"serial"})`，`beforeAll` `const seeded = await seedSearchContext()` 复用 seed-search、捕获 `titleHitId`/`titleQuery`）：(1) AC2 显式入口：`/search?q={titleQuery}` → 点 EventCard 进 `/events/{titleHitId}` → hydrate 后 `getByRole("link", { name: /返回搜索结果/ })` 可见 + `expect.poll(href).toContain("/search")` + `expect.poll(href).toContain(encodeURIComponent(titleQuery))`（带原 query，**非**空白 `/search`、**非** `/`）；且该页**不**出现「返回搜索结果」之外的歧义（同页 `/返回首页/` 在搜索来源下不渲染——`toHaveCount(0)`）。(2) AC1 点回：点「返回搜索结果」→ `toHaveURL(new RegExp(\`q=${encodeURIComponent(titleQuery)}\`))` + 搜索结果 EventCard 复现（同 query ⇒ 同排序）。(3) AC2 兜底（bfcache 未命中/刷新）：在详情页 `page.reload()` → 「返回搜索结果」仍可见、href 仍带 query（页面级、history 无关；sessionStorage RETURN_CONTEXT 跨 reload 持久）。(4) 直访无来源：新 context 直接 `GET /events/{titleHitId}`（无前序点击，无 RETURN_CONTEXT）→ label「返回首页」、href `/`；「返回搜索结果」`toHaveCount(0)`（不伪造）。(5) 信任边界：`page.evaluate` 写 `sessionStorage["aguhot:returnContext"]="/search//evil.com"` → reload → label 回退「返回首页」、href `/`（`isSearchReturn` 拒非精确 pathname）；同样测 `/search/../console`。(6) 不回归：详情页六分区/标题仍渲（搜索来源不破坏详情主体）；匿名全程 200。
- `apps/web/package.json` -- MODIFY：加 `"e2e:search-return": "tsx e2e/seed-search.ts && NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 playwright test --grep @search-return"`（复用 seed-search，无新 seed）；`e2e` 的 `--grep-invert` 追加 `|@search-return`。**`e2e:search` 的 `--grep` 由 `@search` 收紧为 `"@search[^-]"`**——因 `@search-return` 含子串 `@search`，playwright `--grep @search`（正则）会把 `@search-return` 用例也 matched 进来，导致 search.spec 与 search-return.spec 的 `beforeAll seedSearchContext()` 在不同 worker 并发 seed 竞争；`@search[^-]` 利用 describe 标签后跟空格（非 `-`）精确选中 `@search`、排除 `@search-return`。`seed:search` 等其余既有脚本不动。
- `_bmad-output/implementation-artifacts/deferred-work.md` -- MODIFY：追加 3-4 defer（label 来源感知扩到 home/theme/daily origin 的显式入口、bfcache/browser-back 通用 scroll 恢复 `history.scrollRestoration`/`pageshow`、label 内回显 query 文本、`isSearchReturn` 的 selfcheck 接入 CI、多级返回栈/面包屑、`@search-return` 与 `@search` 合并跑的串行时序）。

## Tasks & Acceptance

**Execution:**
- `apps/web/app/(public)/_components/list-context-memory.tsx` -- 新增导出纯 `isSearchReturn`（origin 严格等值 + pathname 精确 `/search`，与 `isValidListReturn` 同套路） -- AC2 label 分类的信任边界（错判 = 误显搜索入口或漏显）
- `apps/web/app/(public)/_components/back-link.tsx` -- 增可选 `searchLabel` prop，`fromHref` 经 `isSearchReturn` 为真时渲 `searchLabel` 否则 children；href/onClick 字节不变 -- AC2 显式入口落点（SSR 安全、无 hydration mismatch）
- `apps/web/app/(public)/events/[hotEventId]/page.tsx` -- BackLink 传 `searchLabel="← 返回搜索结果"` + 注释更新 -- 详情页显式回搜索入口（AC2 surface）
- `apps/web/e2e/search.spec.ts` -- 「返回恢复」用例 selector `/返回首页/` → `/返回搜索结果/`（断言意图不变） -- 跟随 3.4 新 label，保持 AC1 e2e 绿
- `apps/web/e2e/search-return.spec.ts` + `package.json:{e2e:search-return}` + `e2e` grep-invert 加 `|@search-return` -- 复用 seedSearchContext + `@search-return` e2e（AC2 显式入口带 query、AC1 点回、reload 兜底、直访不伪造、信任边界、不回归） -- AC1/AC2 surface-anchored 验证；既有 seed/spec 除一条 selector 外零改动
- `_bmad-output/implementation-artifacts/deferred-work.md` -- 追加 3-4 defer 项 -- 诚实登记来源感知扩展/bfcache scroll/label 回显 query 等

**Acceptance Criteria:**
- Given 读者在 `/search?q=芯片` 点击 EventCard 进入 `/events/{id}`，When 详情页 hydrate 完成，Then 页面渲染一个 label 为「返回搜索结果」的真实 `<a>`，And 其 href 含 `/search` 与原 `q=芯片`（**非**空白 `/search`、**非** `/`），And 同页不渲染「返回首页」label（AC2 显式入口 + 带回原查询词）。
- Given 上述显式「返回搜索结果」入口，When 读者点击它，Then 落回 URL 含 `q=芯片`（AC1 原关键词/排序/上下文——search 对 q 确定性），And 搜索结果列表复现。
- Given 读者在 `/events/{id}`（来自搜索）刷新页面（模拟 bfcache 未命中 / history 不可恢复），When 详情页重渲，Then 「返回搜索结果」入口仍在、href 仍带原 query（AC2 兜底：页面级、history 无关）。
- Given 读者直接访问 `/events/{id}`（外链/无前序搜索点击，无 RETURN_CONTEXT），When 详情页渲染，Then 返回链 label 为「返回首页」、href `/`，And **不**渲染「返回搜索结果」（不伪造查询词/来源）。
- Given 读者从首页 `/?window=7d` / 主题 `/topics/{slug}` / 日报 `/daily?date=D` 进入详情，When 详情页渲染，Then 返回链 label 仍为「返回首页」、href 恢复该来源（2.5 三向返回行为字节不变，AC1 不回归）。
- Given `sessionStorage["aguhot:returnContext"]` 被改写为 `/search//evil.com` / `/search/../console` / `https://evil.com` 任一，When 详情页 BackLink 读取，Then `isSearchReturn` 全拒、label 回退「返回首页」、href `/`、**不**产生站外跳转、**不**误标搜索来源（AC2 信任边界）。
- When 执行 `pnpm -r typecheck`/`pnpm -r lint`，Then 通过；And `pnpm --filter web build`（无 `DATABASE_URL`）成功（BackLink 仍 client、SSR 安全）；And `pnpm --filter web e2e:search-return`（`@search-return`）全过（AC2 显式入口带 query + AC1 点回 + reload 兜底 + 直访不伪造 + 信任边界 + 不回归）；And `pnpm --filter web e2e:search`（`@search`，含更新 selector 后的「返回恢复」用例）全过；And `pnpm --filter web e2e`（home/navigation 等 base）与 `e2e:loop`/`e2e:detail` 不回归（BackLink href 字节不变、home/theme/daily/直访 label 仍「返回首页」、2.5 depth cap 不破）。

## Spec Change Log

<!-- 空，直至首次 bad_spec 回路。 -->

## Review Triage Log

### 2026-07-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (low 2)
- defer: 1: (low 1)
- reject: 15
- addressed_findings:
  - `[low]` `[patch]` **reload 测试注释不实**（`search-return.spec.ts` reload 用例标题 + 文件头注释 + 行内注释）：原文称 `page.reload()` "simulates bfcache miss / history not restorable"，但 reload 是整页导航，不触发 bfcache/pageshow 代码路径，注释 vs 实测行为漂移（2.5 复核曾修同类"文档谎言"）。修复：注释改为诚实表述——reload 证明显式入口是**页面级真实 `<a>`**、其 href 来自 sessionStorage RETURN_CONTEXT（同源同 tab 跨 reload 持久），即入口 history 无关（3.4 scope）；浏览器 back 的 scroll 恢复是 2.5 通用 history 机制、非 3.4 scope。测试名去掉"bfcache 未命中"措辞。注释 only，无逻辑改动，重跑 e2e:search-return 6/6 绿。
  - `[low]` `[patch]` **spec Code Map 与 diff 不符**（spec package.json 任务行）：spec 原写 `e2e:search`/`seed:search` "既有脚本不动"，但实现必须把 `e2e:search` 的 `--grep` 由 `@search` 收紧为 `"@search[^-]"`（否则 `--grep @search` 把 `@search-return` 用例也 matched 进来，两 spec beforeAll 并发 seed 竞争）。修复：更新该 Code Map 行，准确记录 grep 收紧及其原因（tag 子串碰撞 + serial seed 竞争）。spec doc only。
  - 1 项 defer 追加至 deferred-work（见下）：搜索来源 scroll 恢复未在 3.4 e2e 直接断言——AC1「结果上下文」的 scroll 分量沿用 2.5 marker 同一代码路径（loop.spec 已为 home/theme/daily 断言），但 `seedSearchContext` 对测试 query 产出短结果页，直接断言需改共享 seed（波及 search.spec）。
  - 15 项 reject 丢弃：`@search[^-]` 正则对未来 tag 的假设性脆（今日验证可用）、`e2e` grep-invert `|@search-return` 冗余（belt-and-suspenders 无害）、`isSearchReturn⟹isValidListReturn` 子集不变量无独立守卫（e2e AC2 用例同时断 label「返回搜索结果」+ href 含 `/search`，mismatch 会被抓）、`isSearchReturn` 无 selfcheck「defer 过早」（trivial 6 行信任边界谓词 + verification-gap 层确认全分支 e2e 覆盖 + `(public)` 目录 import 摩擦，defer 结论正确）、跨站类（`https://evil.com`/`//evil.com`/`/\evil.com`）isSearchReturn 未在本 story 直接测（origin 守卫与 `isValidListReturn` 字节相同、loop.spec AC6 已回归保护；search-return 信任边界测试正确聚焦 isSearchReturn 独有的精确 `/search` pathname 逻辑）、serial 模式 sessionStorage 跨用例泄漏（playwright 默认 context per-test、无泄漏）、`toHaveCount(0)` 未来脆（今日有效、假设性）、SR 通告质量（role+name 选择器已验可访问名）、bundle/tree-shaking（无新模块、layout 已 bundle list-context-memory）、`/search#evil` hash 分支（同源、良性、isValidListReturn 既有同行为）、spec「仅 selector」vs 注释（trivial）、cross-origin 不可达（schema-enforced 同上）、intent-alignment 描述性 divergences（映射到已 patch 的 reload 注释 + 已 defer 的 scroll）、adversarial 的 e2e:search grep「未文档化」（已由 patch C 修 spec Code Map）。
- verification_note: patch 后重跑 `pnpm --filter web e2e:search-return` 6/6 PASS（注释 only，无逻辑改动）。其余验证（typecheck/lint/build/e2e:search/e2e:loop/e2e:detail/base e2e）在实现期已全绿、patch 不触及。

## Design Notes

**为何「改 BackLink label 来源感知」而非新增独立「返回搜索结果」组件：** 三个候选都给 AC2 的显式入口，差异在组件数与回归面。(1) 新增独立 `<SearchReturnLink/>` 仅在搜索来源渲：与既有 `<BackLink>` 并存 → 搜索来源时页面上出现两条返回链（「返回首页」BackLink 实际也指向 `/search?q=…` + 新链），冗余且互相冲突（读者困惑点哪个）。若让新链「替换」BackLink 则等于 BackLink 在搜索来源下不渲——仍是 BackLink 内分支，没省事。(2) 把整段返回 UI（label+href+marker）复制到新组件：违反 DRY + 双处维护 sessionStorage 读取/校验/marker 写入（漂移风险，违背 2.5「单一返回面」）。(3) **BackLink 增一可选 `searchLabel` prop、按 `isSearchReturn(fromHref)` 选 label**：单一返回面、单一 href/marker 真值源、单一 SSR 契约；`searchLabel` 缺省时行为与今日字节一致（向后兼容，其他用 BackLink 的虚拟场景不受影响）。label 切换与既有 href 切换同源同时机（都从 `fromHref` 派生、同 effect），无 hydration mismatch。这是 ponytail：覆盖 AC2（显式、带 query、history 无关入口）的最短 diff——一纯 helper + 一可选 prop + 一处调用。

**为何 `isSearchReturn` 用「origin 严格等值 + pathname 精确 `/search`」而非复用 `isValidListReturn`：** `isValidListReturn` 判「是不是合法列表来源」（`/`、`/daily`、`/search` exact + `/topics/` prefix），它只决定 **href 渲染**（恢复哪个 URL）。`isSearchReturn` 判的是另一维度——「是不是**搜索**来源」，决定 **label 文案**。两者不同：`/topics/{slug}` 对 `isValidListReturn` 真、对 `isSearchReturn` 假（label 应「返回首页」非「返回搜索结果」）。故需独立谓词。套路一致（同 `new URL(raw,"http://localhost")` + origin 等值拦开放重定向），但判定更窄（pathname **精确** `/search`，拒 `/search/../console`(URL normalize 为 `/console`)、`/search//evil.com`、`/search/{x}`）。`isSearchReturn` 真 ⇒ `isValidListReturn` 亦真（搜索是列表来源子集），故 label 切「返回搜索结果」时 href 必为合法 `/search?q=…`（绝不会出现「搜索 label + `/` href」的错配）。

**为何「bfcache 不可恢复兜底」= 显式入口本身（而非新增 `history.scrollRestoration`/`pageshow`）：** 2.5 deferred-work 把「浏览器 back 经 history 恢复 URL 但不恢复 scroll」列为**通用**机制 defer（适用 home/theme/daily/search 全部列表面，非搜索专属）。3.1 deferred-work 指给 3.4 的是「显式返回搜索结果入口**与 bfcache 不可恢复兜底**」——后者即「当浏览器 back/bfcache 不可靠时，页面仍提供一个能回到带 query 的搜索页的入口」。一个页面级真实 `<a href="/search?q=…">`（不依赖 bfcache、不依赖 history state、刷新后仍在）正是该兜底：读者无需依赖浏览器 back，点显式入口即回到原查询语境。把 `history.scrollRestoration` 等通用机制留在 2.5 defer（搜索在其中无特殊性），3.4 不扩张到改 history 语义——保持 ponytail + 不破坏 2.5 depth cap 与回归面。`@search-return` e2e 的 reload 用例直接验证此兜底（sessionStorage RETURN_CONTEXT 跨 reload 持久 → 显式入口 reload 后仍带 query）。

**为何不回显裸 query 在 label 里：** AC2 说「该入口带回原查询词而不是空白搜索页」——「带回查询词」由 href `/search?q=…` 满足（点进去就是该 query 的结果页，非空白）。在 label 文案里再回显「返回搜索结果「芯片」」是 UX 噪音，且长 query（近 128 字符）会撑坏返回链布局/截断。defer。

## Verification

**Commands:**
- `pnpm -r typecheck` -- expected: 全 workspace 通过（list-context-memory 新 export + back-link 新 prop + 详情页调用 + search.spec selector + 新 search-return spec + tsconfig.e2e）
- `pnpm -r lint` -- expected: 无错误
- `pnpm --filter web build` -- expected: 无 `DATABASE_URL` 下构建成功（BackLink 仍 client、SSR 安全、详情页 force-dynamic 不变）
- `pnpm --filter web e2e:search-return` -- expected: 复用 seed-search 造数后 `@search-return` 全过（AC2 显式入口带 query + AC1 点回 + reload 兜底 + 直访不伪造 + 信任边界 `/search//evil.com`/`/search/../console` 回退 + 不回归六分区 + 匿名 200）
- `pnpm --filter web e2e:search` -- expected: `@search` 全过（含「返回恢复」用例 selector 更新为 `/返回搜索结果/` 后仍证 BackLink 恢复 `/search?q=…`）
- `pnpm --filter web e2e` / `e2e:loop` / `e2e:detail` -- expected: 不回归（BackLink href 字节不变、home/theme/daily/直访 label 仍「返回首页」、2.5 depth cap 不破）

**Manual checks (if no CLI):**
- `/search?q=芯片` 点 EventCard 进详情 → 返回链显示「← 返回搜索结果」（非「返回首页」）；点它 → 落回 `/search?q=芯片` 原 scroll；在详情页刷新 → 「返回搜索结果」仍在、仍带 query；直访 `/events/{id}`（拷链新开）→ 返回链「返回首页」回首页顶部；从 `/?window=7d` 进详情 → 返回链「返回首页」回 `/?window=7d`（2.5 不回归）；详情六分区不破坏；全程未登录可用。

## Auto Run Result

Status: done

**Summary:** 落地 Epic 3 story 3.4 的 AC2 显式「返回搜索结果」入口——纯 web 层（零 core/DB/worker/迁移）。AC1（搜索→详情→返回恢复原 query/排序/上下文）已由 2.5 ListContextMemory 捕获/恢复基建 + 3.1 把 `/search` 加入 allowlist 落地；3.4 的净新增是 AC2：详情页唯一 `<BackLink>` 改为来源感知——新增纯信任边界 helper `isSearchReturn(raw)`（origin 严格等值 + pathname 精确 `/search`，与 `isValidListReturn` 同套路、更窄），`<BackLink>` 增可选 `searchLabel` prop，当 `fromHref` 为合法 `/search?…` 时渲染「← 返回搜索结果」（href 仍 `fromHref ?? fallback`，字节不变、query 原封带回、非空白 `/search`），其余来源仍「← 返回首页」。该页面级真实 `<a>` 即 AC2 要的 history 无关、带原查询词的兜底入口（刷新/直访/隐私模式诚实降级）。SSR/首渲 fromHref=null → label=children「返回首页」（与今日字节一致、无 hydration mismatch）。

**Files changed:**
- `apps/web/app/(public)/_components/list-context-memory.tsx` — 新增导出纯 `isSearchReturn`（与 `isValidListReturn` 同信任边界套路，判「是不是搜索来源」以选 label；pathname 精确 `/search`，拒 `/search/../console`、`/search//evil.com`、`/search/{x}`）。
- `apps/web/app/(public)/_components/back-link.tsx` — 增可选 `searchLabel?: ReactNode` prop；label 来源感知（`isSearchReturn(fromHref)` 真 → searchLabel，否则 children）；href/onClick marker 字节不变。
- `apps/web/app/(public)/events/[hotEventId]/page.tsx` — BackLink 传 `searchLabel="← 返回搜索结果"` + 注释更新（3.4 显式入口 + AC2）。
- `apps/web/e2e/search.spec.ts` — 「返回恢复」用例 selector `/返回首页/` → `/返回搜索结果/`（断言意图不变，跟随搜索来源新 label）。
- `apps/web/e2e/search-return.spec.ts` — NEW `@search-return` e2e（6 测，复用 `seedSearchContext`，零新 seed）：AC2 显式入口带 query、AC1 点回、reload 兜底（页面级 history 无关）、直访不伪造、信任边界（`/search//evil.com`/`/search/../console` 回退）、不回归六分区 + 匿名。review patch：reload 用例注释诚实化（reload≠bfcache 模拟，证明入口 history 无关）。
- `apps/web/package.json` — `e2e:search-return` 脚本 + `e2e` grep-invert 加 `|@search-return` + **`e2e:search` 的 `--grep` 由 `@search` 收紧为 `"@search[^-]"`**（避免 `@search` 子串 match `@search-return` 致两 spec beforeAll 并发 seed 竞争）。
- `_bmad-output/implementation-artifacts/deferred-work.md` — 追加 3-4 实现期（6）+ 复核期（1，search scroll 验证）defer 项。

**Review findings:** 4 层并行复核（adversarial / edge-case / verification-gap / intent-alignment）。intent_gap 0、bad_spec 0（intent-alignment 确认 diff 忠实实现 Reading A：3.4 = AC2 显式入口，AC1 = 2.5/3.1 既有非回归边界）。patch 2（low 2：reload 用例注释 vs reload≠bfcache 的诚实化；spec Code Map 把 `e2e:search` grep 收紧如实记录）。defer 1（search 来源 scroll 恢复未直接断言——2.5 同代码路径、loop.spec 已覆三面、seedSearchContext 短页断言脆）。reject 15（tag 正则假设性脆、grep-invert 冗余无 harm、子集不变量由 e2e label+href 联断保护、selfcheck defer 正确 [trivial + 全分支 e2e 覆盖 + `(public)` import 摩擦]、跨站类 origin 守卫字节同 isValidListReturn 由 loop.spec AC6 保护、serial sessionStorage per-test 无泄漏、`toHaveCount(0)` 假设性、SR 名由 role+name 验、bundle 无新模块、`/search#` hash 同源良性、注释级 trivial、intent-alignment 描述性 divergences 映射到已处理项等）。

**Verification:** `pnpm -r typecheck` PASS、`pnpm -r lint` PASS、`pnpm --filter web build`（无 `DATABASE_URL`）PASS（`/search`、`/events/[hotEventId]` 仍 `ƒ` Dynamic、BackLink 仍 client SSR 安全）、`pnpm --filter web e2e:search-return` 6/6 PASS（patch 后重跑）、`pnpm --filter web e2e:search` 18/18 PASS（含 `/返回搜索结果/` selector 更新后的「返回恢复」用例）、`pnpm --filter web e2e:loop` 10/10 PASS（2.5 三向返回字节不变）、`pnpm --filter web e2e:detail` 7/7 PASS（直访 fallback + 「返回首页」label 保持）、`pnpm --filter web e2e`（base home/navigation/design）17/17 PASS。

**Follow-up review:** false。2 patches 均为 localized low-severity——reload 用例注释诚实化（注释 only、零逻辑改动）+ spec Code Map doc 准确性。无 API/数据完整性/安全/架构层变更；显式入口的信任边界（isSearchReturn）由 e2e:search-return 信任边界用例 + 共享 origin 守卫（loop.spec AC6）覆盖；全部 fully verified，不构成需独立 follow-up 的显著变更。

**Residual artifacts:** `_bmad-output/implementation-artifacts/.review-diff-3-4.patch`（复核工作 diff，非变更一部分，未提交）。其余残留风险已登记于 deferred-work.md（label 来源感知扩到 home/theme/daily、bfcache/browser-back 通用 scroll 恢复、label 内回显 query、isSearchReturn selfcheck/CI 接入、多级返回栈、search scroll 验证、`@search`/`@search-return` 合并跑编排等）。
