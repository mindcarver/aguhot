---
title: 'Issue #47 核心资本环境记录持久化与 A 股观察映射'
type: 'feature'
created: '2026-07-31'
status: 'done'
baseline_commit: '54c5f2dd8222fb9328e48aafdb332ad1ad1bd292'
review_loop_iteration: 0
context:
  - '{project-root}/packages/core/src/modules/capital-environment/types.ts'
  - '{project-root}/packages/core/src/modules/capital-environment/metric-catalog.ts'
  - '{project-root}/packages/core/prisma/schema.prisma'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** #41/#43 已定义点时数据契约和指标目录，但资本环境没有 append-only 存储，回放没有稳定、可审计的输入。

**Approach:** 在 Prisma/PostgreSQL 持久化 `CapitalDataRecord`，提供纯 core adapter 将规范化 A 股 sidecar 行映射为目录允许的 canonical/degraded 记录。worker 生产编排延后。

## Boundaries & Constraints

**Always:** 遵守 `published_at <= as_of`、来源/处理版本/状态可追溯、重复导入幂等、新 revision 追加、未知/失败/待复核不补零。Node/Prisma 拥有资本表；Python sidecar 继续独占三个原始表写入权。

**Ask First:** 修改 #41/#43 字段语义、增加 metricKey、把 observation-only/复合字段提升为数值或接入新 provider时暂停确认。

**Never:** 不实现 worker 刷新编排/调度、外部 provider 网络适配、基金集中度、回放/比较、UI、部署、历史修订回填或既有记录覆盖。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 合法记录 | 有 `publishedAt` 的记录 | 追加保存并按截止点读取 | 校验失败拒绝 |
| sidecar 观察 | 无 provider 发布日期 | `value=null`、unknown/降级 | 不伪造 `publishedAt` |
| 复合来源 | 宽度独立字段或 related mapping | 保留映射/原因，不新增 metricKey | 禁止静默聚合 |
| 重复/revision | 相同键或新 revision | 幂等；新 revision 追加 | 冲突失败；gap 返回 incomplete |

</frozen-after-approval>

## Code Map

- `packages/core/prisma/schema.prisma` -- 资本记录表、唯一键、查询索引。
- `packages/core/prisma/migrations/20260731000000_add_capital_environment_records/migration.sql` -- 迁移。
- `packages/core/src/modules/capital-environment/record-repository.ts` -- 校验、幂等追加、冲突检测、点时读取。
- `packages/core/src/modules/capital-environment/ashare-observation-adapter.ts` -- sidecar 行到 canonical/degraded 记录的映射。
- `packages/core/src/modules/capital-environment/capital-environment-record.selfcheck.ts` -- 隔离 fixture 自检。
- `packages/core/src/modules/capital-environment/index.ts`、`packages/core/package.json` -- 导出入口和自检命令。

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/prisma/schema.prisma`、`packages/core/prisma/migrations/20260731000000_add_capital_environment_records/migration.sql` -- 增加 append-only 模型、来源元数据、状态、revision、trace、`recordKey`、唯一键和查询索引。
- [x] `packages/core/src/modules/capital-environment/record-repository.ts` -- 复用 `validateCapitalDataRecord`、`capitalRecordKey`、`selectCapitalRecordsAt`，实现 append/listAt 和冲突检测。
- [x] `packages/core/src/modules/capital-environment/ashare-observation-adapter.ts` -- 映射三类规范化 sidecar 行；无发布日期、复合字段和 related mapping 保持降级。
- [x] `packages/core/src/modules/capital-environment/capital-environment-record.selfcheck.ts`、`index.ts`、`package.json` -- 覆盖契约、幂等、revision、cutoff、映射并注册命令。

**Acceptance Criteria:**
- Given 合法记录，when append 后按 `as_of` 查询，then 只返回满足发布日期截止的记录并保留来源、版本、状态。
- Given 相同稳定键重复 append，when 内容一致，then 只有一行；when 冲突，then 明确失败且原行不变。
- Given 新 revision，when append 后查询，then 旧 revision 保留；缺少中间版本时数值为 `incomplete_reconstruction`。
- Given A 股观察无 provider `published_at` 或含复合字段，when adapter 映射，then 不生成伪造确认值且状态原因可审计。
- Given 隔离 fixture，when 运行 self-check、core lint/typecheck/build、config build 和 `git diff --check`，then 全部成功。

## Design Notes

`cn-market-breadth` 的 independent scalar fields 与 `cn-akshare-index-sector` related mapping 不扩展为新指标；worker 读取原表并写入资本记录的生产路径已登记为延后交付。

## Verification

**Commands:**
- `pnpm --filter @aguhot/core verify:capital-environment-record` -- expected: all assertions pass.
- `pnpm --filter @aguhot/core lint` -- expected: SUCCESS.
- `pnpm --filter @aguhot/core typecheck` -- expected: SUCCESS.
- `pnpm --filter @aguhot/core build` -- expected: SUCCESS.
- `pnpm --filter @aguhot/config build` -- expected: SUCCESS.
- `git diff --check` -- expected: no whitespace errors.

## Suggested Review Order

**持久化与回放边界**

- 先看 append/listAt 入口，理解幂等、冲突、截止点筛选和 revision 重建。
  [`record-repository.ts:139`](../../packages/core/src/modules/capital-environment/record-repository.ts#L139)

- 检查稳定身份包含数据集，避免来源切换覆盖旧历史。
  [`point-in-time.ts:17`](../../packages/core/src/modules/capital-environment/point-in-time.ts#L17)

- 检查契约校验与数据库边界，确保发布日期、枚举和 revision 不失真。
  [`types.ts:233`](../../packages/core/src/modules/capital-environment/types.ts#L233)

- 检查 Prisma 模型、索引和 append-only 字段是否与 repository 对齐。
  [`schema.prisma:1226`](../../packages/core/prisma/schema.prisma#L1226)

- 检查真实数据库部署时的约束、唯一键与查询索引定义。
  [`migration.sql:4`](../../packages/core/prisma/migrations/20260731000000_add_capital_environment_records/migration.sql#L4)

**A 股映射与降级**

- 检查 canonical breadth、related index/sector 以及未知 source 的降级分支。
  [`ashare-observation-adapter.ts:59`](../../packages/core/src/modules/capital-environment/ashare-observation-adapter.ts#L59)

- 检查 observation-only 日期不会伪装成 provider publishedAt。
  [`metric-catalog.ts:797`](../../packages/core/src/modules/capital-environment/metric-catalog.ts#L797)

**自检与交付边界**

- 运行并阅读 repository、并发冲突、cutoff、revision、round-trip 和映射自检。
  [`capital-environment-record.selfcheck.ts:1`](../../packages/core/src/modules/capital-environment/capital-environment-record.selfcheck.ts#L1)

- 检查命令入口，以及 worker 生产编排明确留在 deferred work。
  [`package.json:10`](../../packages/core/package.json#L10)

- 检查真实 PostgreSQL round-trip 验证为何需要后续隔离环境补跑。
  [`deferred-work.md:1`](./deferred-work.md#L1)
