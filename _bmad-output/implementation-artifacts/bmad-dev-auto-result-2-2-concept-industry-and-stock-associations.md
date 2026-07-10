---
status: done
---

# BMad Dev Auto Result — Story 2.2 概念、行业与个股关联视图

Status: done
Spec: `_bmad-output/implementation-artifacts/spec-2-2-concept-industry-and-stock-associations.md`

## 实现摘要

新建 `theme-linking` 领域模块（concept/industry/stock 关联）：`AssociationAdapter` 端口 + `StubAssociationAdapter`（测试双桩）+ `generateAssociations`（强制 `mappingBasis`、append-only、adapter 缺失/空→不写诚实降级）+ append-only `EventAssociationSet` 写表（items Json）。复用 `publish-orchestrator` 投影第 5 张公开读模型 `published_hot_event_associations`（publish 投影最新 set / takedown 同批清），`getPublishedHotEventDetail` 加 `associations` 字段，新增 `listPublishedAssociations`。详情页加「关联」section（concept/industry/stock 分组 FilterPill 链 → `/?<kind>=<label>` + provenance + 降级态）。首页 feed 接受 `?concept=|?industry=|?stock=` JS 过滤（`listPublishedHotEvents` 保持 filter-free）。V1 无 worker（epic 未列关联生成 job 类目）、无真实知识源（prod 诚实降级，stub 仅 verify/e2e）。

## 变更文件（21）

**core 模块+schema（新）**
- `packages/core/prisma/schema.prisma` — 加 `EventAssociationSet` + `PublishedHotEventAssociation` 模型 + HotEvent 反向导航
- `packages/core/prisma/migrations/20260710141148_association_read_models/migration.sql` — 2 表 + 索引 + FK Cascade
- `packages/core/src/modules/theme-linking/{types,adapter,stub-adapter,association-service,index}.ts` — 端口 + 测试双桩 + 生成器/读取器 + 桶

**publish-orchestrator（改）**
- `publish-service.ts` — `projectAssociations`（publish 分支）+ takedown 清第 5 表 + 详情第 5 读 + `associations` 字段 + `listPublishedAssociations`
- `types.ts` — `AssociationItem`/`PublishedHotEventAssociation`/选项类型
- `index.ts` — 导出新符号（顺手补 2-1 遗留：`PublishedHotEventReaction` 桶导出）
- `packages/core/src/index.ts` — theme-linking 模块组 + 新导出

**worker（新）**
- `apps/worker/src/verify-associations.ts` — 21 断言自检
- `apps/worker/package.json` — `verify:associations`

**web（改+新）**
- `apps/web/app/(public)/events/[hotEventId]/page.tsx` — 「关联」section
- `apps/web/app/(public)/page.tsx` — feed 关联维度 JS 过滤 + 活动维度可清除 pill
- `apps/web/app/(public)/_components/feed-filters.tsx` — `parseAssociationFilter` + 活动 pill
- `apps/web/package.json` — `e2e:associations`/`seed:associations` + `e2e` grep-invert 加 `@associations`
- `apps/web/e2e/{seed-associations.ts,associations.spec.ts}` — 独立 seed + 5 测试 @associations

**defer**
- `_bmad-output/implementation-artifacts/deferred-work.md` — 实现 9 项 + review 7 项 defer

## Review findings

- patches applied: 2（feed 关联过滤 exclude 负向断言 [medium]；关联过滤空态+清除路径测试 [low]）
- items deferred: 9（投影并发 race、normalizeItems 静默丢弃 observability、label 边界归一化、corrupt-DB Json 读校验、provenance 固定文案 multi-basis、降级 traceId 日志、复合索引 perf；多维度 collapse + JS 全表读与既有 defer 重叠未重复追加）
- items rejected: 18（详见 spec `## Review Triage Log`）

## Verification

- `pnpm -r typecheck` / `lint` — PASS（5 包）
- `pnpm --filter worker verify:associations` — PASS 21/21
- `pnpm --filter worker verify:publish` 48/48 / `verify:market-reaction` 18/18 — 不回归
- `pnpm --filter web build`（无 DATABASE_URL）— PASS（详情/首页 ƒ Dynamic、静态页 ○ Static）
- `pnpm --filter web e2e:associations` — PASS 5/5（含 review 补的 exclude 负向断言 + 空态清除测试）
- `pnpm --filter web e2e`（home/navigation/design）17/17 / `e2e:market-reaction` 3/3 — 不回归
- 迁移：本地 PG 用户缺 CREATE DATABASE（Prisma shadow DB），`pnpm --filter core db:migrate` 受阻；migration SQL 按 Prisma 约定手写、经 psql 直接应用并登记 `_prisma_migrations`，`prisma migrate status` 报 up-to-date。

## 残留风险

- V1 无关联生成触发（无 worker/cron/钩子）→ prod 永远降级（AC3 诚实下限，真实知识源落地需同步引入触发）。
- `StubAssociationAdapter` fixture 仅 verify/e2e；真实 concept/industry/stock 映射依赖 defer 的知识源。
- `items` Json + feed 关联过滤为全表读 + 内存 join（scale ceiling 已 defer）。
- 迁移经 psql 直应用（本地权限限制），非 `prisma migrate dev` 标准路径。
