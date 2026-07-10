---
title: '关注列表与回访管理 (3.3)'
type: 'feature'
created: '2026-07-11'
status: 'done'
review_loop_iteration: 0
baseline_revision: 'ad5a0511d19490cf16f200911e2d01dec98c4c80'
final_revision: '0564e86dca63251d1bf0cabe655cacdcb60767e9'
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-2-delayed-login-follow-action.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-aguhot-2026-07-09/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Epic 3 story 3.2 落地了收藏**写入**（`follow_targets` + 轻量会话 + 三面 FollowButton），但 `/favorites` 仍是 1.2 的结构性占位页（文案明示「关注列表与管理能力将在后续迭代中开放」）。读者登录并收藏后**无法在任何独立页面查看已收藏内容**，更无法知道某条收藏的热点/主题已下线——FR13「用户可以将热点事件或主题页加入关注列表，并在独立页面查看」、epic-3「watchlist 是一级页面」、AC3「已下线内容须明确标示、不伪装成正常内容」均未落地。这是 epic-3 回访闭环的查看/管理面（3.2 的列表 own defer 到本 story）。

**Approach:** 将 `/favorites` 占位页替换为真实关注列表（force-dynamic server component）：`readSession()`——匿名 → 空态（AC2，AD-8 匿名 200 不墙）；已登录 → `listFollows`（3.2 既有）取全部 follow 行 + `listPublishedHotEvents` + `listPublishedThemeMemberships`（既有 published 读）三读，在 **web 层纯函数 `resolveWatchlistView`** 里按 kind 分组、按 `createdAt desc` 排序、并 **diff published 集**判定每项 live/offline。live 事件复用 `EventCard`（含 3.2 FollowButton，整卡可进详情 + 可 unfollow 管理），live 主题渲染主题链接行 + FollowButton；offline 项渲染明确「已下线」标注行（视觉降级、**无**指向详情的链接——详情已 404、绝不伪造标题——摘要/evidenceCount 无数据源）+ FollowButton 可清理。零新 schema（`user_accounts`/`follow_targets` 已在 3.2 落地）、零新 core 函数（离线 diff 在 web 层，沿用 `/topics/[slug]` 已有的 JS-join 先例）、零新运行时依赖。ponytail：一 page 改造 + 一纯 helper + 其 selfcheck + session.ts 抽出纯 signer + 独立 @watchlist seed/spec。

## Boundaries & Constraints

**Always:**
- 匿名优先（AD-8，AC2）：`/favorites` 匿名 HTTP 200 不墙、无登录重定向。`readSession()` 返回 null（匿名 / cookie 验签失败）→ 渲染空态（「你还没有收藏内容」+ 返回首页 / 探索主题入口）。绝不因关注列表页引入登录墙。
- AD-3 只读 published_*：离线判定 = follow 的 id/slug **不在** published 读模型中（published **无** `publication_status` 列——行存在 = 在线，takedown = 行删除；theme 无独立 published 表，slug 的在线性由 `published_hot_event_themes.items` 派生）。watchlist **不**读 `hot_events`/`themes` 原始聚合，**不**给 `follow_targets` 加 FK（沿用 3.2 id-string-only 引用）。
- 诚实状态标注（AC3，NFR2 不造假）：live 项正常渲染（事件 = `EventCard`，主题 = 指向 `/topics/{slug}` 的链接行）；offline 项视觉降级（muted + 「已下线」badge + **无**详情链接）且**不**混入 live 列表伪装。offline 事件无标题可显示（published 行已删、`follow_targets` 不冗余标题）→ 标注「该热点已下线」，**绝不**伪造标题/摘要/evidenceCount。
- 管理能力（「管理」语义）：每个 watchlist 项（live **与** offline）挂 3.2 的 `FollowButton`（已收藏态 → 点击 = `unfollowTarget` + `revalidatePath` → 项从列表消失）。复用 3.2 组件，零新交互。**offline 项必须可 unfollow**——否则下线内容永久滞留、无法清理（AC3 的可恢复性）。
- build 解耦：page `force-dynamic`，`getPrisma`/`readSession` 仅请求期求值；`pnpm --filter web build` 无 `DATABASE_URL`/`SESSION_SECRET` 通过（与 home/search/theme 同模式）。`signSessionCookie` 抽出为纯函数（仅 Node `crypto`，不 import `next/headers`）。
- 不变性约定（沿用 1.4~3.2）：`const … as const` + union（禁 TS `enum`，`erasableSyntaxOnly`）；`import type` 用于类型；camelCase；web 纯 helper 放 `apps/web/lib/watchlist.ts` + `watchlist.selfcheck.ts`（镜像 `follow-ref-parser.selfcheck.ts` 模式，可被 tsx 直接导入）；e2e 镜像 `seed-follow.ts`/`follow.spec.ts` 模式 + `@watchlist` tag。

**Block If:**
- 预期零新 schema / 零新 core 函数即可实现；若实施中发现**必须**新增 schema 表/migration 或新增 core 模块函数才能落地 → 是设计偏差，HALT（blocking condition `unexpected schema/core change required`）。
- `pnpm -r typecheck` / `pnpm -r lint` 回归 → HALT。
- `pnpm --filter web build`（无 `DATABASE_URL`/`SESSION_SECRET`）失败 → HALT（force-dynamic 必须保 session/db 不在 build 期求值）。
- `navigation.spec`（1.2 四个一级入口）/ `home.spec`（首页无登录墙）/ `follow.spec`（3.2 收藏动作）任一因本 story 回归 → HALT（AD-8 红线 + PRIMARY_NAV_ITEMS 4 项不动、`/favorites` 仍是一级入口、FollowButton 跨页一致不破）。
- `@watchlist` e2e seed 因 `SESSION_SECRET`/`DATABASE_URL` 未注入失败 → HALT（不得硬编码默认密钥）。

**Never:**
- 不引入真实凭证 auth / 不改 session 机制（沿用 3.2 HMAC 签名 cookie；`signSessionCookie` 是纯抽取，行为不变）。
- 不新增 schema 表 / migration（`user_accounts` + `follow_targets` 已在 3.2 落地）。
- 不新增 core 模块 / core 函数（复用 `listFollows` + `listPublishedHotEvents` + `listPublishedThemeMemberships`；离线 diff 收在 web 层纯函数，避免 `user-profile` 反向依赖 `publish-orchestrator` 读模型、破坏 single ownership boundary）。
- 不给 `follow_targets` 加 FK / 不读 `hot_events`/`themes`/`explanation_*`/`evidence_*`/`review_*` 等非 published 表。
- 不改 `PRIMARY_NAV_ITEMS` / `NavList`（`/favorites` 一级入口 + 「收藏」label 保持，`navigation.spec` 不动）。
- 不做关注数量统计 / 通知 / 推送 / 个人偏好 / 批量管理 / 排序筛选 / 分页 / 跨 tab 实时同步（defer；V1 关注量小，一次 `listFollows` 全量渲染）。
- 不为 offline 项伪造标题/摘要/evidenceCount/publishedAt（无数据源；诚实标注「已下线」+ 不向用户暴露裸 id）。
- 不把 offline 项渲染成可进详情的卡片（详情已 404，可点即误导；AC3 反面）。
- 不改 1.1~3.2 既有 verify/seed/spec 断言（home/navigation/detail/themes/daily/search/loop/follow 零改动保持绿；本 story 仅新增 `@watchlist` seed/spec + `e2e:watchlist`/`seed:watchlist`/`verify:watchlist` 脚本 + `e2e` grep-invert 追加 `|@watchlist`）。`session.ts` 改动仅限「抽出纯 `signSessionCookie`、`createSession` 委托」，`readSession`/cookie 名/属性字节不变。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 匿名访问 /favorites（AC2 anon） | `readSession()` null（未登录 / cookie 缺失） | 空态：「你还没有收藏内容」+ 返回首页 / 探索主题入口；HTTP 200 无重定向 | 无错误预期 |
| 已登录零 follow（AC2） | session 有效，`listFollows`=[] | 同空态（文案微调反映「登录后收藏的内容会出现在这里」） | 无错误预期 |
| 已登录有 live 事件 + 主题 follow（AC1） | follow 命中 published 集（id 在 `publishedHotEvents` Map / slug 在 theme membership slug→label Map） | 事件以 `EventCard` 列出（标题 + 整卡可点进详情）+ 主题以链接行列出（可点进 `/topics/{slug}`），各挂 FollowButton「已收藏」 | 无错误预期 |
| 已登录有 offline follow（AC3） | follow 的 hotEventId/slug **不**在 published 集 | 「已下线」标注行（muted + badge + 无详情链接），挂 FollowButton 可 unfollow；**不**混入 live 组 | 无错误预期 |
| watchlist 上 unfollow（管理） | 已登录，点某项 FollowButton「已收藏」 | `unfollowTarget` 删行 + `revalidatePath` → 该项从未收藏列表消失；live/offline 项均可清理 | 行已不存在 → 幂等无操作 |
| 会话验签失败→匿名 | cookie `aguhot:session` 篡改/过期 | `readSession()` 返回 null → 匿名空态；无 500 | 静默降级匿名 |
| DB 缺失（NFR 一致） | runtime `DATABASE_URL` 缺失 | `getPrisma()` 抛错冒泡（loud failure，与 home/topics 一致） | 路由错误 |

</intent-contract>

## Code Map

- `apps/web/lib/watchlist.ts` -- NEW：纯函数 `resolveWatchlistView({ follows: FollowTarget[]; publishedEvents: PublishedHotEventSummary[]; themeMemberships: PublishedThemeMembershipRow[] }): { liveEvents: (PublishedHotEventSummary)[]; liveThemes: { slug: string; label: string }[]; offlineEvents: { hotEventId: string }[]; offlineThemes: { slug: string }[] }`——按 `createdAt desc` 排序 follows；事件 follow 的 `hotEventId` 命中 `publishedEvents` id→summary Map → liveEvents，否则 offlineEvents；主题 follow 的 `slug` 命中 `themeMemberships` 扫描出的 slug→label Map → liveThemes，否则 offlineThemes。纯数据变换，零运行时依赖，可被 tsx selfcheck 直接导入。注释点明 AD-3/AC3/JS-join 先例。
- `apps/web/lib/watchlist.selfcheck.ts` -- NEW（镜像 `follow-ref-parser.selfcheck.ts`）：覆盖 `resolveWatchlistView`——live 事件归类、live 主题归类、offline 事件归类、offline 主题归类、`createdAt desc` 排序、空输入全空、混合输入、theme label 取首见。导出 `runWatchlistSelfcheck()`，直接运行守卫。
- `apps/web/lib/session.ts` -- MODIFY（最小）：抽出纯 `signSessionCookie(accountId: string, secret: string): string`（返回 `${accountId}.${base64url hmac}`，仅 Node `crypto`，不 import `next/headers`）；`createSession` 委托之（cookie 名/属性/httpOnly/SameSite/Secure/maxAge 字节不变）。`readSession` 不变。单一 cookie 格式真值源 + 供 e2e mint cookie 复用（避免复制 HMAC 公式漂移）。
- `apps/web/app/(public)/favorites/page.tsx` -- MODIFY：占位页 → 真实关注列表 server component。`export const dynamic = "force-dynamic"`；`getPrisma()` + `newTraceId()` + `readSession()`。session null → 渲染空态（h1「收藏」+ 空态文案 + 「返回首页」/「探索主题」Link，沿用 search/home 空态 token：`text-ink-secondary` + `bg-brand` rounded-full CTA）。session 有效 → `Promise.all([listFollows, listPublishedHotEvents, listPublishedThemeMemberships])` → `resolveWatchlistView` → 渲染：live 事件组（`<ul role="list">` 复用 `EventCard`，传 `isFollowing`/`isLoggedIn`/`followRef`）+ live 主题组（链接行 + `FollowButton ref={kind:theme,themeSlug}`）+ offline 组（offline 事件/主题合并，muted + 「已下线」badge + `FollowButton`，**无**详情链接）。零 follow 也走空态。H1 保留「收藏」（nav 一致）。注释 AD-8/AD-3/AC3/JS-join。
- `apps/web/e2e/seed-watchlist.ts` -- NEW（镜像 `seed-follow.ts` 结构）：`resetEnvCache`→`requireEnv("DATABASE_URL"|"SESSION_SECRET")`→`getPrisma`→清表（FK 序，含 `follow_targets`/`user_accounts`）→复用 `seed-search`/`seed-follow` 的 published 造数管线（≥2 已发布事件 + ≥1 stub theme membership）→`createAccount`（accountA）→`followTarget` live 事件 + live 主题→直接 `prisma.followTarget.create` 两个 offline 行（`targetHotEventId`=未发布 uuidv7 / `targetThemeSlug`=无 membership 的 slug）→`resetPrisma`→导出 `{ accountAId, liveEventId, liveEventTitle, liveThemeSlug, liveThemeLabel, offlineEventId, offlineThemeSlug }`。直接运行守卫。
- `apps/web/e2e/watchlist.spec.ts` -- NEW（`describe` 标题含 `@watchlist`，serial，`beforeAll seedWatchlistContext()`）：(1) 匿名 `/favorites` → 空态文案 + 「返回首页」/「探索主题」入口存在 + HTTP 200 无重定向（AC2 anon + AD-8）；(2) `signSessionCookie(accountAId, SESSION_SECRET)` mint cookie + `context.addCookies` → `/favorites` 显示 live 事件 `EventCard`（标题可见 + 整卡链接指向 `/events/{liveEventId}`）+ live 主题行（链接指向 `/topics/{liveThemeSlug}`）（AC1）；(3) offline 事件/主题标注「已下线」+ **无**指向详情/主题页的链接 + **不**出现在 live 组（AC3）；(4) 新 accountB（`createAccount`，零 follow）+ mint cookie → 空态（AC2 logged-in）；(5) 点 live 项 FollowButton「已收藏」→ unfollow → 该项消失；(6) 点 offline 项 FollowButton → unfollow → offline 项消失（可清理，AC3 可恢复）；(7) 篡改 cookie → 匿名空态无 500（验签降级）。
- `apps/web/package.json` -- MODIFY：加 `"e2e:watchlist": "tsx e2e/seed-watchlist.ts && SESSION_SECRET=... NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 playwright test --grep @watchlist"`（SESSION_SECRET 经 env 注入，与 `e2e:follow` 同模式，不硬编码）、`"seed:watchlist": "tsx e2e/seed-watchlist.ts"`、`"verify:watchlist": "tsx lib/watchlist.selfcheck.ts"`；`e2e` 的 `--grep-invert` 追加 `|@watchlist`。既有脚本不动。
- `_bmad-output/implementation-artifacts/deferred-work.md` -- MODIFY：追加 3-3 defer（关注数量统计/通知/推送、批量管理/排序/筛选/分页、watchlist 读缓存预算、跨 tab/设备实时同步、offline 项批量清理、theme slug 字符集校验、`listFollows` 分页、真实 auth 落地后 watchlist 与账号资料/偏好关联、`resolveWatchlistView` 全量 published 读的伸缩上限）。

## Tasks & Acceptance

**Execution:**
- `apps/web/lib/{watchlist.ts,watchlist.selfcheck.ts}` -- NEW 纯 `resolveWatchlistView`（按 kind 分组 + createdAt desc 排序 + diff published 集判定 live/offline）+ selfcheck -- AC3 离线判定的可验证纯逻辑（正确归类正是会被 break 的点）
- `apps/web/lib/session.ts` -- 抽出纯 `signSessionCookie`（`createSession` 委托、行为不变） -- cookie 格式单一真值源 + e2e 可 mint cookie
- `apps/web/app/(public)/favorites/page.tsx` -- 占位→真实关注列表（force-dynamic，readSession→匿名空态；已登录三读 + `resolveWatchlistView` + EventCard/主题行/offline 行/空态） -- AC1 列表 + AC2 空态 + AC3 离线标注 + AD-8 匿名 200 不墙
- `apps/web/e2e/{seed-watchlist.ts,watchlist.spec.ts}` + `package.json:{e2e:watchlist,seed:watchlist,verify:watchlist}` + `e2e` grep-invert 加 `|@watchlist` -- 独立 seed + @watchlist e2e（匿名空态、live 事件/主题、offline 标注、logged-in 空态、unfollow 管理、验签降级） -- AC1/AC2/AC3 surface-anchored 验证；既有 seed/spec 零改动
- `_bmad-output/implementation-artifacts/deferred-work.md` -- 追加 3-3 defer 项 -- 诚实登记管理/通知/分页/缓存等

**Acceptance Criteria:**
- Given 未登录读者，When 访问 `/favorites`，Then HTTP 200 且无登录重定向/登录墙，页面显示明确空态说明（「你还没有收藏内容」类）并提供返回首页与探索主题入口（AC2 + AD-8 匿名优先）。
- Given 已登录读者且有 ≥1 仍在线的已收藏热点事件与主题页，When 进入 `/favorites`，Then 页面列出这些内容（事件可点进 `/events/{id}` 详情、主题可点进 `/topics/{slug}` 主题页继续阅读），And 每项挂 FollowButton「已收藏」（AC1）。
- Given 已登录读者但无任何收藏，When 进入 `/favorites`，Then 显示明确空态说明 + 返回首页/探索主题入口（AC2 logged-in）。
- Given 已登录读者且某已收藏内容已下线（published 行已删 / 主题无 membership），When 查看 `/favorites`，Then 该项被明确标示「已下线」状态（视觉降级 + 无详情链接），And **不**伪装成正常可点内容、**不**混入 live 组、**不**伪造标题（AC3）。
- Given 已登录读者在 `/favorites`，When 点某项（live 或 offline）的 FollowButton「已收藏」，Then 该项从未收藏列表消失，And offline 项同样可被清理（不滞留；AC3 可恢复性 + 「管理」语义）。
- When 执行 `pnpm -r typecheck`/`pnpm -r lint`，Then 通过；And `pnpm --filter web build`（无 `DATABASE_URL`/无 `SESSION_SECRET`）成功（force-dynamic 保 session/db 不在 build 期求值）；And `pnpm --filter web verify:watchlist` 全过（live/offline 分类 + 排序 + 空输入）；And `pnpm --filter web e2e:watchlist`（`@watchlist`）全过（匿名空态、live 事件/主题、offline 标注、logged-in 空态、unfollow 管理、验签降级）；And `pnpm --filter web e2e`（home/navigation/detail/themes/daily/search/loop/follow）不回归（PRIMARY_NAV_ITEMS 4 项不变、首页无登录墙、3.2 收藏动作与跨页一致不破）。

## Spec Change Log

<!-- 空，直至首次 bad_spec 回路。 -->

## Review Triage Log

### 2026-07-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (medium 1, low 2)
- defer: 2: (low 2)
- reject: 15
- addressed_findings:
  - `[medium]` `[patch]` **`signSessionCookie` mint/verify 漂移无隔离测试** (`session.ts` / `session-cookie-signer.ts` / 新 `session-cookie-signer.selfcheck.ts` + `verify:session-cookie` 脚本)：`readSession` 原保留私有 `sign()` twin（为兑现 spec「readSession 字节不变」Never），与 `signSessionCookie` 的 sign 各自定义同一公式——任一处单字符编辑会静默破坏全部鉴权会话，而默认 `pnpm e2e`（grep-invert 排除 `@watchlist`）抓不到。修复：把 `sign` 提升为 `session-cookie-signer.ts` 的**导出**单一真值，`readSession` 改为 import 之（**readSession 调用点 `sign(accountId, secret)` 与 cookie 名/属性/格式字节不变**，仅删除本地 twin 定义 + 调整 import），新增纯 `verifySessionCookie` + round-trip selfcheck（8 断言：格式、mint→verify 回环、篡改/错 secret/畸形拒绝、不同 accountId 异签名、safeEqual）钉死 mint↔verify 一致。`createHmac` 从 session.ts import 移除（twin 删除后不再用）。
  - `[low]` `[patch]` **`resolveWatchlistView` 对 `m.items` Json 列无运行期形状守卫** (`watchlist.ts`)：`as ThemeRef[]` 强制转型 + 直接读 `item.label`，若 published membership Json 行损坏（null/非数组/非字符串 label）→ 500/渲染垃圾。修复：`Array.isArray(m.items) ? ... : []` + `typeof item.label === "string" && item.label.trim() !== ""` 守卫，损坏行静默跳过（与「unknown targetKind skip 不抛」防御风格一致）。
  - `[low]` `[patch]` **过时注释仍把 `/favorites` 列为静态路由** (`page.tsx` / `events/[hotEventId]/page.tsx` / `core/src/index.ts`)：本 story 把 `/favorites` 改为 force-dynamic + core-importing，但三处旧注释仍把它列在「静态/不 import core」路由清单。修复：更新三处注释，准确反映 `/favorites`（及 `/daily`、`/topics`）为 force-dynamic，仅 layout + `/design` 保持静态。
  - 2 defer 项追加至 `deferred-work.md`（见下）：a11y 基线（标题层级冲突、offline FollowButton aria-label 不区分、`<ul>` 未 aria-labelledby——属 Story 3.5/3.6 跨切面 a11y 基线，本 story 复用既有 EventCard h2 模式）；`verify:*` selfcheck 未接入 CI/precommit（repo-wide 既有约定，`verify:follow-ref` 等同为手动运行——本 story 新增 `verify:watchlist`/`verify:session-cookie` 沿用之）。
  - 15 reject 丢弃：`listFollows` 无 orderBy（helper 层确定性排序，行为正确）、id tiebreaker 用非 UUID 测试串（确定性，cosmetic）、seed 直插 offline 行（模拟「已关注后下线」态的诚实造数、write-path 无法对未发布 id 落 follow）、serial e2e 顺序耦合（既有 follow.spec 同模式）、selfcheck 仅测 classifier（页面层由 e2e:watchlist 覆盖、防御性死分支）、offline 组内顺序未测（cosmetic）、`DATABASE_URL-free` 注释无 CI（repo-wide 既有，build 命令在验证里）、`signSessionCookie` 死 re-export（无害公开面，注释已修正）、无分页（spec Never 已 defer）、tampered-cookie test 7 被指歧义（实测用全新 context + 硬编码不存在 accountId + `还没有收藏内容` 空态断言为主证，独立于 accountA 状态——reviewer 误读共享态耦合）、重复 follow 行（DB `@@unique` schema-enforced）、invalid-UUID offline id（write-path 已 UUIDv7 校验，不可达）、三读未 try/catch（matrix row 7 by-design loud failure，与 home/topics 一致）、Invalid-Date createdAt（DB `@default(now())` 永不 invalid）、`<ul>` 未 aria-labelledby（DOM 嵌套 acceptable）、intent-alignment 的测试海拔描述性注记（非缺陷）。
## Design Notes

**为何离线判定在 web 层纯函数（而非新 core 函数）：** watchlist 的离线判定天然是「follow 状态（`user-profile`）× published 可用性（`publish-orchestrator`）」的跨模块 join。core 不应让 `user-profile` 反向依赖 `publish-orchestrator` 的读模型（破坏 epic-3「single ownership boundary」——`user-profile` 只按 id 存取 follow，不读 published）。既有先例：`/topics/[slug]` 页已在 web 层用 `listPublishedThemeMemberships` + `listPublishedHotEvents` 做 JS join 判定 theme 是否有在线 member、无则 `notFound()`。watchlist 沿用同一模式：web 层取三读（`listFollows` + `listPublishedHotEvents` + `listPublishedThemeMemberships`），纯函数 `resolveWatchlistView` 做 diff（id/slug 命中 published 集 → live，否则 offline）。纯函数可被 tsx selfcheck 确定性测试——AC3 离线归类正确性正是会被 break 的点（错把 offline 当 live = AC3 失败）。零新 core 函数 / 零跨模块耦合 / 复用既有 published 读。

**为何 offline 项不渲染成 EventCard / 不造假标题：** `published_hot_events` 行已删 = 无 title/summary/evidenceCount 数据源；`follow_targets` 只存 id（无标题冗余，3.2 设计）。伪造标题违背 NFR2「不造假」。诚实标注「该热点已下线」+ 视觉降级 + **无**详情链接（详情已 404，可点即误导，AC3 反面）。offline 项仍挂 FollowButton（ref 仍有效：`hotEventId`/`themeSlug`）使其可被 unfollow 清理——否则下线内容永久滞留、违背「管理」语义。theme offline：slug 仍在但人可读 label（派生自 published membership）已不可得 → 标注「该主题已下线」，不展示裸 slug。

**为何抽出 `signSessionCookie` 纯函数：** session cookie 格式（`${accountId}.${base64url hmac}`）需在 `createSession`（服务端设 cookie）与 e2e（mint cookie 模拟登录）两处一致。抽出纯 signer（仅 Node `crypto`，不依赖 `next/headers`）= 单一真值源 + 可测，避免 e2e 复制 HMAC 公式漂移（3.2 复核已登记 `createSession secure 读裸 env` defer 项，纯 signer 是其可测化的自然一步）。`createSession` 委托之，行为不变；`readSession` 字节不变。

**为何复用 EventCard + FollowButton 而非新建 watchlist 项组件：** `EventCard`（3.2 已含 FollowButton + 整卡点击进详情）已是 live 事件的正确渲染；`FollowButton`（已收藏 → unfollow toggle）已是管理 affordance。复用 = ladder 最高 rung（已安装组件），零新组件、零新交互。「管理」语义由 FollowButton toggle 覆盖，无需独立的 remove 控件/批量管理（defer）。offline 项不复用 EventCard（无 published summary 字段），用最小独立行 + FollowButton。

## Verification

**Commands:**
- `pnpm -r typecheck` -- expected: 全 workspace 通过（watchlist helper + selfcheck + favorites page + session signer 抽取 + e2e tsconfig）
- `pnpm -r lint` -- expected: 无错误
- `pnpm --filter web build` -- expected: 无 `DATABASE_URL`/无 `SESSION_SECRET` 构建成功（force-dynamic 保 `getPrisma`/`readSession` 不在 build 期求值）
- `pnpm --filter web verify:watchlist` -- expected: `resolveWatchlistView` selfcheck 全过（live 事件/主题归类、offline 事件/主题归类、createdAt desc 排序、空输入、theme label 首见）
- `pnpm --filter web e2e:watchlist` -- expected: seed 后 `@watchlist` 全过（匿名空态 + 返回入口、live 事件 EventCard + live 主题行、offline「已下线」标注 + 无详情链接 + 不混入 live、logged-in 空态、unfollow 管理 live/offline、验签降级）
- `pnpm --filter web e2e` -- expected: 不回归（home/navigation/detail/themes/daily/search/loop/follow；PRIMARY_NAV_ITEMS 4 项不变、首页无登录墙、3.2 收藏动作与跨页一致保持）

**Manual checks (if no CLI):**
- 未登录访问 `/favorites`：空态文案 + 「返回首页」/「探索主题」入口、HTTP 200、无重定向。登录（详情页点收藏→登录并收藏）后导航到 `/favorites`：该 live 事件以卡片列出、可点进详情；再收藏一个主题后刷新 `/favorites`：主题行可点进主题页；live 项点「已收藏」→ 从列表消失。构造一个 offline follow（DB 直接写一条指向未发布 id 的 follow 行）后刷新：该项标注「已下线」、无可点详情链接、点其 FollowButton → 消失。篡改 `aguhot:session` cookie 后刷新 → 降级匿名空态、无 500。

## Auto Run Result

Status: done

**Summary:** 落地 Epic 3 story 3.3 的 FR13 关注列表与回访管理——把 `/favorites` 1.2 占位页替换为真实 force-dynamic 关注列表 server component。匿名 `readSession()` → 空态（AC2 + AD-8 不墙）；已登录 → `listFollows` + `listPublishedHotEvents` + `listPublishedThemeMemberships` 三读 → 纯 web 层 `resolveWatchlistView` 按 kind 分组、`createdAt desc` 排序、diff published 集判定 live/offline。live 事件复用 `EventCard`（整卡进详情 + FollowButton 可 unfollow），live 主题渲染主题链接行；offline 项诚实标注「已下线」（视觉降级 + 无详情链接 + 不造假标题）+ FollowButton 可清理（AC3 可恢复 + 「管理」语义）。零新 schema（3.2 已落地）、零新 core 函数（沿用 `/topics/[slug]` JS-join 先例）、零新运行时依赖。

**Files changed:**
- `apps/web/lib/watchlist.ts` + `watchlist.selfcheck.ts` — NEW 纯 `resolveWatchlistView`（四桶 live 事件/主题 + offline 事件/主题、`createdAt desc` + id 确定性排序、published 集 diff、first-seen theme label、unknown kind 防御跳过）+ 10 断言 selfcheck（`verify:watchlist`）。review patch：`m.items` Json 列加 `Array.isArray` + `typeof label` 守卫。
- `apps/web/lib/session-cookie-signer.ts` + `session-cookie-signer.selfcheck.ts` — NEW/EXP 纯 signer（`sign` 提升为导出单一真值 + `signSessionCookie` + 新 `verifySessionCookie` + `safeEqual`，仅 Node `crypto`，无 `next/headers`）+ 8 断言 round-trip selfcheck（`verify:session-cookie`）。
- `apps/web/lib/session.ts` — `createSession` 委托 `signSessionCookie`；`readSession` 改为 import 共享 `sign`（**调用点 + cookie 名/属性/格式字节不变**，删除本地 twin 消除 mint/verify 漂移）。
- `apps/web/app/(public)/favorites/page.tsx` — 占位 → 真实关注列表（force-dynamic；匿名空态；已登录三读 + `resolveWatchlistView` + live EventCard 组 / live 主题组 / offline 组 + 空态 CTA）。
- `apps/web/e2e/{seed-watchlist.ts,watchlist.spec.ts}` — 独立 seed（published 事件/主题 + accountA + live follow + 2 offline follow）+ 7 测 `@watchlist`（AC2 匿名/登录空态、AC1 live 事件+主题、AC3 offline 标注、live/offline unfollow 管理、验签降级）。
- `apps/web/package.json` — `verify:watchlist`/`verify:session-cookie`/`e2e:watchlist`/`seed:watchlist` 脚本 + `e2e` grep-invert 加 `|@watchlist`。
- `apps/web/app/(public)/page.tsx` + `events/[hotEventId]/page.tsx` + `packages/core/src/index.ts` — review patch：过时注释更正（`/favorites` 等为 force-dynamic，非静态）。
- `_bmad-output/implementation-artifacts/deferred-work.md` — 追加 3-3 实现期（9）+ 复核期（2）defer 项。

**Review findings:** 4 层并行复核（adversarial / edge-case / verification-gap / intent-alignment）。intent_gap 0、bad_spec 0（intent-alignment 确认 diff 忠实实现 Readings A+C：`/favorites` 列表 + 纯 helper，3.2 面作非回归边界）。patch 3（medium 1：session-cookie mint/verify `sign()` twin 漂移无隔离测试——把 `sign` 提升为单一导出真值 + `readSession` import 之【调用点不变】+ 新 `verifySessionCookie` + round-trip selfcheck 钉死；low 2：`resolveWatchlistView` 对 `m.items` Json 列加 `Array.isArray`+`typeof label` 守卫防损坏行 500、过时注释把 `/favorites` 列为静态）。defer 2（watchlist a11y 基线属 3.5/3.6；`verify:*` selfcheck 未接入 CI/precommit repo-wide 既有）。reject 15（确定性排序/seed 诚实造数/serial e2y 既有模式/by-design loud failure/DB schema-enforced/不可达防御分支/测试海拔描述性注记等 by-design、不可达、或已 schema-enforced）。

**Verification:** `pnpm -r typecheck` PASS、`pnpm -r lint` PASS、`pnpm --filter web build`（无 DATABASE_URL/SESSION_SECRET）PASS（`/favorites` 现为 `ƒ` Dynamic）、`pnpm --filter web verify:session-cookie` 8/8 PASS（新增）、`pnpm --filter web verify:watchlist` 10/10 PASS、`pnpm --filter web verify:follow-ref` 10/10 PASS（sibling 无回归）、`pnpm --filter web e2e:watchlist` 7/7 PASS（AC1/AC2/AC3 + 管理 + 验签降级）、`pnpm --filter web e2e:follow` 10/10 PASS（session.ts 改动无回归）、`pnpm --filter web e2e`（base）17/17 PASS（navigation 四入口 + /favorites 匿名可达 + home 无登录墙保持）。patch 后全部重跑通过。

**Follow-up review:** false。3 patches 多为 localized（1 medium 是 session-cookie 单一真值化 + 回环 selfcheck，纯验证加固 + 等价行为去重，已由 8 断言 selfcheck + e2e:follow/e2e:watchlist 真 auth 回环全验证；2 low 是 Json 边界守卫 + 注释准确性）——无 API/数据完整性/架构层变更，全部 fully verified。

**Residual artifacts:** `_bmad-output/implementation-artifacts/.review-diff-3-3.patch`（复核工作 diff，非变更一部分，未提交）。其余残留风险已登记于 deferred-work.md（a11y 基线归 3.5/3.6、`verify:*` CI 接入、分页/通知/批量管理、watchlist scale ceiling 等）。
