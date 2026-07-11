---
status: blocked
spec_file: _bmad-output/implementation-artifacts/spec-4-3-session-and-category-filters.md
story_id: 4-3-session-and-category-filters
epic: 4
created: '2026-07-11'
---

# BMad Dev Auto Result — Story 4.3 盘前/盘中/盘后与类别筛选

Status: blocked
Blocking condition: intent gap（类别筛选维度无法在现有数据模型上确定可辩护的唯一读法）

## 解析的 spec_file

`_bmad-output/implementation-artifacts/spec-4-3-session-and-category-filters.md`（尚未落盘——规划阶段 HALT，未写 spec）

## 意图来源（binding）

- `epics.md` Story 4.3 AC：切换 盘前/盘中/盘后 或 概念/行业/个股/公告/研报 筛选；列表实时更新；当前筛选可见且可清除；URL 可分享，返回不丢失。
- `sprint-change-proposal-2026-07-11.md:190` UX-DR5（改写版）：筛选维度 = 时间范围（盘前/盘中/盘后/全天）+ 类别（概念/行业/个股/公告/研报）；URL 可分享。
- `epic-4-context.md`：FR-2 — 按 session（盘前/盘中/盘后/全天）和 category（概念/行业/个股/公告/研报）筛选；active state visible/clearable/URL-shareable/返回不丢滚动。

## 已查实的代码事实

### 时段维度（session）—— 完全可实现，无歧义

- `published_timeline_entries.session_tag` 字段存在（`TimelineSessionTag` union: `pre_open|intraday|post_close|non_trading`）。
- `listPublishedTimeline` 已接受 `sessionTag?: TimelineSessionTagType` 参数（`packages/core/src/modules/publish-orchestrator/timeline-read-model.ts:436`）。
- 复合索引 `@@index([tradeDate, sessionTag, occurredAt])` 已建（`schema.prisma:789`）。
- `deriveSessionTag` / `deriveTradeDate` 纯函数已就位（`session-tag.ts`）。
- 「全天」= 不传 sessionTag（清除态）；`non_trading` 条目仅在「全天」下出现（无独立 pill，可辩护）。
- 结论：session 维度 4.3 可直接做 UI + URL 参数 + 透传既有参数。

### 类别维度（category）—— 数据底座缺失，多读法不可选定

1. **`published_timeline` 读模型无任何 category 字段**（`schema.prisma:766-791`，字段仅 id/hotEventId/tradeDate/occurredAt/sessionTag/sourceName/title/summary/evidenceCount/foldedEvidenceRecordIds/recommendationReason/traceId/createdAt）。
2. **`listPublishedTimeline` 未实现 `category?` 参数**——尽管 spec-4-1 Code Map（line 120）曾规划 `category?`，实际实现未落地。
3. **公告 / 研报 在整个 codebase 无任何数据承载**：无 enum、无 union 成员、无字段、无 source。`grep 公告|研报` 在 `packages/core/src` 零命中。唯一类别 taxonomy 是 `AssociationKind`（`theme-linking/types.ts:39`）= `concept|industry|stock`（概念/行业/个股），且仅存于 `EventAssociationSet.items` / `PublishedHotEventAssociation.items` 的 **Json 展示列**。
4. **Json 列不可按单项 SQL 查询**（deferred-work line 291-293 明示）：按 concept/industry 做服务端聚合/筛选需先重构为规范化子表（schema migration）。当前只能整体读出在内存过滤。
5. **类别筛选在 deferred-work 中被多次推迟**：line 77/156/211 把「分类筛选维度」归给 Epic 2.2；2.2 落地了 association 数据但未做 feed 筛选维度（line 281-282 单维度 + clear 沿用 1.7 defer）。

## 三种可辩护读法（导致可观察的不同产物）

- **读法 A（全 6 类别）**：新建 公告/研报 的数据源与 enum；重构 `PublishedHotEventAssociation.items` 为可查询子表或在 timeline 读模型投影 category 列；扩展 `listPublishedTimeline` 与索引。— Epic 级跨模块改动，远超「筛选 UI」story 范围，且无任何 story 授权该数据建模。
- **读法 B（仅 concept/industry/stock 3 类）**：用既有 `AssociationKind`，扩展读契约 join `PublishedHotEventAssociation`（或内存过滤），UI 渲染 3 个类别 pill，defer 公告/研报。— 需读契约扩展 + Json 列查询性妥协；event 可有多 kind（OR 语义未指定）；无 association 的事件在该筛选下不出现。
- **读法 C（仅 session，类别全 defer）**：4.3 只做时段筛选；类别筛选等数据模型就绪后再开 story。— 与 deferred-work 历史一致，但丢弃 UX-DR5/story-4.3-AC 显式列出的类别维度。

## 未决问题（需人工决策）

1. 类别筛选的 V1 范围：6 类 / 3 类（concept/industry/stock）/ 0 类（仅 session）？
2. 若含公告/研报：其数据源、归属模块、enum 定义方是谁？（当前 codebase 无任何承载）
3. 若含 concept/industry/stock：是服务端 SQL 筛选（需先重构 Json 列为子表 + 索引，属 4.1 读模型扩展）还是内存过滤（受 50 行 cap 与 N+1 限制）？event 多 kind 时 OR 还是单选？
4. 是否将本 story 拆分为 4.3a（session 筛选，立即可做）+ 4.3b（类别筛选，待数据模型）？

## 结论

session 维度无歧义、可直接规划实现；类别维度因数据底座缺失存在多种可辩护读法且意图无法选定，构成 intent gap。按 dev-auto step-02 规则不得自行择一读法，HALT 待人工裁决类别范围。

## 上下文（供恢复用）

- 已加载：epic-4-context.md、spec-4-2（done，Code Map/Design Notes/Spec Change Log/Auto Run Result）、spec-4-1 Code Map 相关行、sprint-change-proposal-2026-07-11.md、deferred-work.md 相关条目。
- 前置 story 状态：4.1 done、4.2 done；分支 `feat/epic-4-timeline`，工作树干净。
- 关键可复用件：`FilterPill`（`apps/web/components/chips.tsx:87`）、`mergeSearchParams`/`firstString`（`feed-filters.tsx`，V1 `window/concept/industry/stock` 维度，需新 query keys）、`searchParams: Promise<{}>` 异步模式（`daily/page.tsx`、`search/page.tsx`）。
