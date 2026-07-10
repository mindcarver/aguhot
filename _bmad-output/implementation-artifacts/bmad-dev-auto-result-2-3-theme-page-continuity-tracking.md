---
status: done
---

# BMad Dev Auto Result — Story 2.3 主题页连续追踪

Status: done
Spec: `_bmad-output/implementation-artifacts/spec-2-3-theme-page-continuity-tracking.md`

## 实现摘要

在 `theme-linking` 模块（2.2 已建 concept/industry/stock 关联）扩主题子域，镜像 2.2 关联端到端形态：`ThemeAdapter` 端口 + `StubThemeAdapter`（测试双桩）+ `generateThemes`（强制 `mappingBasis`/`slug`/`label` 非空 + slug URL 安全、append-only、adapter 缺失/空→不写诚实降级）+ append-only `EventThemeSet` 写表（items Json）。复用 `publish-orchestrator` 投影第 6 张公开读模型 `published_hot_event_themes`（publish 投影最新 set / takedown 同批清），`getPublishedHotEventDetail` 加 `themes` 字段，新增 `listPublishedThemeMemberships`。新增 `theme-backfill` BullMQ worker（镜像 2-1 `market-reaction-queue`，epic 列明 job 类目；V1 adapter 缺失→诚实 skip，stub 不入 worker）。Web 落地：`/topics` 目录页（替换静态占位，distinct 主题链 + 降级）、`/topics/[slug]` 主题页（`latestEvidenceAt` 升序成员事件序列 + FR11 成员链 + FR9 闭环 + 未知 slug 404）、详情页加「主题」section（FR9 FilterPill 链 `/topics/{slug}` + provenance + AiLabel + 降级）。V1 无真实主题知识源（prod 诚实降级，stub 仅 verify/e2e）。

## 变更文件（18）

**core schema+迁移（新）**
- `packages/core/prisma/schema.prisma` — 加 `EventThemeSet` + `PublishedHotEventTheme` 模型 + HotEvent 反向导航
- `packages/core/prisma/migrations/20260710153750_theme_read_models/migration.sql` — 2 表 + 索引 + FK Cascade

**theme-linking 主题子域（新）**
- `packages/core/src/modules/theme-linking/{theme-adapter,stub-theme-adapter,theme-service}.ts` + `types.ts`/`index.ts` — 端口 + 测试双桩 + 生成器/读取器（`normalizeThemeItems` 含 slug URL 安全校验）+ 类型/桶

**publish-orchestrator（改）**
- `publish-service.ts` — `projectThemes`（publish 分支）+ takedown 清第 6 表 + 详情第 6 读 + `themes` 字段 + `listPublishedThemeMemberships`（`orderBy hotEventId` 确定 label 派生）
- `types.ts` — `ThemeRef`/`PublishedHotEventTheme`/`PublishedThemeMembershipRow`/选项类型
- `index.ts` + `packages/core/src/index.ts` — 新符号导出

**worker（新+改）**
- `apps/worker/src/queues/theme-backfill-queue.ts` — BullMQ worker（镜像 2-1，V1 adapter 缺失→诚实 skip）
- `apps/worker/src/index.ts` — 注册第 5 worker + 优雅关闭（「五 worker」独立解耦不自动链）
- `apps/worker/src/verify-themes.ts` — 24 断言自检
- `apps/worker/package.json` — `verify:themes`

**web（改+新）**
- `apps/web/app/(public)/topics/page.tsx` — 替换静态占位为动态主题目录（distinct + AiLabel + 降级）
- `apps/web/app/(public)/topics/[slug]/page.tsx` — 主题页（升序成员序列 + FR11 链 + FR9 闭环 + 未知/空成员 slug 404 + 返回链 + AiLabel + sort tiebreaker）
- `apps/web/app/(public)/events/[hotEventId]/page.tsx` — 「主题」section（FR9 FilterPill 链 + provenance + AiLabel + 降级）
- `apps/web/package.json` — `e2e:themes`/`seed:themes` + `e2e` grep-invert 加 `@themes`
- `apps/web/e2e/{seed-themes.ts,themes.spec.ts}` — 独立 seed（≥2 共享主题 + 1 无主题 + seedTopicsEmpty）+ 9 测试 @themes（含升序 DOM 序断言 + 目录降级）

**defer**
- `_bmad-output/implementation-artifacts/deferred-work.md` — 实现 14 项 + review 3 项 defer

## Review findings

- patches applied: 7（主题页成员升序 DOM 序断言 [medium]；`normalizeThemeItems` slug URL 安全校验 + verify 断言 [medium]；空 join → notFound 统一 AC3 [low]；sort tiebreaker [low]；`listPublishedThemeMemberships` orderBy 确定 label 派生 [low]；移除 vestigial type re-export hack [low]；`seed-themes.ts` `pending[0]!` 修 typecheck 回归 [low]）
- items deferred: 4（theme-backfill eligible `none:{}` 使已有 set 事件永不回填 + 投影缺失无修复路径；`normalizeThemeItems` slug dedup 静默丢弃冲突项 observability；主题页成员行 source name/原始链接 traceability 丰富化；projectThemes read→write 非原子 race——实现期已登记，本 pass 确认 worker 为第二触发源归并）
- items rejected: 22（详见 spec `## Review Triage Log`）

## Verification

- `pnpm -r typecheck` / `lint` — PASS（5 包）
- `pnpm --filter worker verify:themes` — PASS 24/24（含 review 补的 malformed-slug 抛错断言）
- `pnpm --filter worker verify:publish` 48/48 / `verify:market-reaction` 18/18 / `verify:associations` 21/21 — 不回归
- `pnpm --filter web build`（无 DATABASE_URL）— PASS（`/topics` + `/topics/[slug]` ƒ Dynamic、`/daily`/`/design`/`/favorites` ○ Static，build 不变量延续）
- `pnpm --filter web e2e:themes` — PASS 9/9（含升序 DOM 序 + 目录降级 + 双向闭环 + 未知 slug 404）
- `pnpm --filter web e2e`（home/navigation/design）17/17 / `e2e:associations` 5/5 — 不回归
- 迁移：本地 PG 用户缺 CREATEDB + 2.2 迁移 checksum drift 致 `prisma migrate dev` 受阻；migration SQL 按 Prisma 约定生成、经 `prisma migrate diff`→`db execute`→`migrate resolve --applied` 应用并登记 `_prisma_migrations`，两表存在、client 已 regenerate。

## 残留风险

- V1 无主题生成触发（worker adapter 缺失→skip、无 cron/钩子）→ prod 永远降级（AC3 诚实下限，真实知识源落地需同步引入触发 + 重派生 eligible）。
- `StubThemeAdapter` fixture 仅 verify/e2e；真实主题映射依赖 defer 的知识源。
- `theme-backfill` worker 运行时（Redis/Job/shutdown）无集成测试（镜像 2-1/explain 未测运行时 defer）。
- `items` Json + `/topics` 目录/主题页为全表读 + 内存 join/dedup（scale ceiling 已 defer）。
- 迁移经 `db execute` 直应用（本地权限 + 既有 checksum drift 限制），非 `prisma migrate dev` 标准路径；2.2 迁移 checksum drift 为既有问题、未处理。
- 跨页返回路径 scroll/filter 上下文恢复归 2.5（本 story 仅基本导航 + 浏览器原生 back）。
