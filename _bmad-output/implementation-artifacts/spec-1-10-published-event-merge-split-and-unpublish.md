---
title: '已发布热点的合并、拆分与下线重发布 (1.10)'
type: 'feature'
created: '2026-07-10'
status: 'in-progress'
baseline_revision: 'e130483c00e48f821cfe0adc56348a6b0793d096'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-9-published-event-copy-and-tag-corrections.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-6-review-queue-and-publication-gate.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-aguhot-2026-07-09/ARCHITECTURE-SPINE.md'
warnings: ['oversized', 'multiple-goals']
---

<intent-contract>

## Intent

**Problem:** 1.6 落地发布闸门（`candidate→published`、`published→taken_down`）、1.9 落地 `published→published` 重发布（修订后刷新）。但已发布热点仍有三类运营动作无路径：(1) **合并**——两个本应是一个的热点无法合一（`event-assembly` 虽有候选级 `clusterEvents` 合并原语，但无运营驱动的「已发布事件合并」命令）；(2) **拆分**——一个热点混入了不相关证据时无法把子集拆成新事件；(3) **下线重发布**——`taken_down`/`rejected` 在 `transitions.ts` 中被显式标为终态（注释「re-publish of a taken_down/rejected event is 1.10, deferred」），运营下线或误拒后无法再上线。1.9 defer 明示「从 taken_down/rejected 重发布归 1.10」。

**Approach:** 三类动作**复用而非重建**发布闸门（epic cross-story 依赖明示 1.10 reuse the publish gate），全部落地为追加式决策（AD-5），不新增 `PublicationStatus` 值、不新增 `ReviewOutcome`、不新增表/迁移：
- **下线重发布（最小块）**：`transitions.ts` 加两条转换 `taken_down+republish→published/publish`、`rejected+republish→published/publish`，复用既有 `ReviewOutcome.Republish` 与 `decideReview`（同一事务 append 决策 + `refreshPublishedReadModel(publish)` 重投影）。零 `decideReview` 逻辑改动。
- **合并**：`event-assembly` 新增 `mergeHotEvents({sourceId, targetId})`——把 source 的 `hot_event_evidence` 链搬到 target（共享证据 P2002 吞掉、不重复），用 `signatureOf` 重算 target `cluster_signature`；运营台 server action 顺序编排：`mergeHotEvents` → `decideReview(target, republish)`（刷新 target 读模型显合并后证据）→ `decideReview(source, takedown, note="merged into {target}")`（source 读模型删除、公开不可见、审计链留痕）。
- **拆分**：`event-assembly` 新增 `splitHotEvent({sourceId, evidenceRecordIds, title})`——新建 candidate `HotEvent`（`signatureOf` 取被选证据），把选中证据链 source→new 搬迁、重算双方 `cluster_signature`；server action 编排：`splitHotEvent` → `decideReview(source, republish, note="split")`（刷新 source 读模型显剩余证据）。**新事件落地为 `candidate`**（尊重发布闸门不变量；运营经既有 1.6 复核队列 approve 后才公开）。
- **UI**：`/console/[eventId]` published 分支增「合并」（选另一 published 事件作 source 吸收进当前事件）+「拆分」（勾选证据子集）表单；`taken_down`/`rejected` 分支增「重新发布」按钮（`outcome=republish`）。新增 `@merge-split` e2e 与 `verify:merge-split`，扩 `transitions.selfcheck`。本 story 不做按标签筛选（Epic 2.2）、不做真实 LLM、不做运营台鉴权（沿用 1.6 占位）——均记 defer。

## Boundaries & Constraints

**Always:**
- 复用发布闸门、决策追加式（AD-5）：合并 = `decideReview(target, republish)` + `decideReview(source, takedown)`；拆分 = `decideReview(source, republish)`；下线重发布 = `decideReview(source, republish)`。每个动作在 `decideReview` 单事务内 append `ReviewDecision`+`PublicationDecision`+`refreshPublishedReadModel`。`note` 字段结构化记录意图（`"merged into {id}"` / `"split: moved N to {id}"` / `"re-publish from taken_down"`）。绝不 in-place 覆盖历史；历史决策链完整可审计。
- 写归属（AD-2/AD-6 字段级）严格不变：`event-assembly` 写 `hot_event_evidence`（搬迁/新建/删除链——本 story 首次引入链删除，属合法的聚类重组）+ `hot_events`（新建 candidate、`update` `cluster_signature`，**仅** signature 字段）；**不**写 `hot_events.title`（标题仍是聚类派生 / 1.9 revision overlay）、**不**写 `publication_status`、**不**写 `published_*`、**不**写决策表。`review-workflow` 写决策 + `publication_status` + 驱动 refresh。`publish-orchestrator` 写 `published_*`。模块间不跨边界写。
- 公开只读发布态读模型（AD-3）：合并/拆分/重发布**不改公开页一行代码**——公开 `/`、`/events/[id]` 仍只经 `listPublishedHotEvents`/`getPublishedHotEventDetail` 读 `published_*`。合并/拆分改变的是「某 hotEvent 挂了哪些证据」，由 `refreshPublishedReadModel(publish)` 重投影 `published_hot_event_evidence`（deleteMany + 按 `publishedAt ASC` 重插，沿用 1.8 既有 `projectEvidenceTimeline`，零改动）体现到公开。运营台可读工作表（与 1.6 `getCandidateDetail` 跨聚合读同型）。
- 合并语义（单一来源）：合并后 target 持有 source ∪ target 的证据（共享证据去重，不重复挂）；target `cluster_signature` = `signatureOf(target 全部成员记录)`（重算）；source 的全部 `hot_event_evidence` 链清空、status `published→taken_down`、`published_*` 删除。target 标题/解释**不由合并自动改**（合并只搬证据；运营要改标题/解释走 1.9 修订表单 + republish）。source 不能 = target。
- 拆分语义：新事件 B = `candidate`（`id: newTraceId()`、`title` 运营提供、`clusterSignature = signatureOf(被选证据)`、`publicationStatus: Candidate`）；被选证据链 source→B 搬迁（删 source 链、建 B 链）；source `cluster_signature` 按剩余成员重算；source 读模型经 republish 刷新显剩余证据。被选集必须非空且**非全部**（留至少 1 条给 source，否则那是 takedown 不是 split）。
- 下线重发布语义：`refreshPublishedReadModel(action="publish")` 对 taken_down（`published_*` 行已被 takedown 删除）/rejected（从未有 `published_*` 行）均走 upsert `create` 分支 → `publishedAt = now()`（重发布即新的首次公开时刻；原历史在 `PublicationDecision` 链保留）。effective 标题/标签/解释投影沿用 1.9。
- 转换图锁定（`transitions.selfcheck`）：新增 `taken_down+republish→published/publish`、`rejected+republish→published/publish` 合法用例；新增 candidate+republish、published+takedown（既有）、taken_down+approve/reject/takedown 非法用例（锁终态非终态边界）。
- `next build` 保持无 `DATABASE_URL`（1-6…1-9 不变量延续）：新增/改动运营台路由仍 `export const dynamic = "force-dynamic"`，`getPrisma()` 仅请求期求值；`(public)/layout.tsx`、`/daily`、`/topics`、`/favorites`、`/design` 保持静态、不 import `@aguhot/core`（动态公开路由仍仅 `/` 与 `/events/[hotEventId]`，本 story 不新增动态公开路由）。
- token 安全（沿用 1-9 警告）：新增运营台 UI 用**真实解析** token（`bg-surface-raised`/`bg-surface-base`/`bg-surface-muted`/`border-border-hairline`/`rounded-lg`/`ink-*`/`bg-brand`/`bg-accent-warm`）；**不得**复制 1-6 漂移的未定义 token（`bg-surface`/`border-line-subtle`/`bg-brand-strong`）。
- 不变性约定（沿用 1-4…1-9）：状态/种类/结果用 `const … as const` + union（禁 TS `enum`）；`import type` 用于类型；相对导入带 `.js`；camelCase `@map("snake_case")`；每调带 `traceId`；PK UUIDv7（`newTraceId()`）。
- 合并/拆分/重发布均不新增 BullMQ job：运营触发（同步，server action 顺序调各模块），`refreshPublishedReadModel` 仍在 `decideReview` 事务内同步（与 1.6/1.8/1.9 一致）。编排非跨模块事务（沿用 1.9 `submitRevision` 非原子约定；追加式 + server action 顺序调兜底，部分失败可重提，记 defer）。

**Block If:**
- 本地 PG `aguhot_dev` 不可达（`verify:merge-split` seed/断言或 `@merge-split` e2e seed 连接失败）→ HALT，不得跳过集成/e2e 验证。
- 引入新路由/新 import 导致 `pnpm --filter web build`（无 `DATABASE_URL`）失败 → HALT。
- `pnpm -r typecheck`/`lint` 因新模块/新转换回归 → HALT。
- `pnpm --filter core verify:review-logic`（`transitions.selfcheck` 含新重发布用例）失败 → HALT。

**Never:**
- 不新增 `PublicationStatus` 值（仍 candidate/published/rejected/taken_down）；不新增 `ReviewOutcome`（仍 approve/reject/takedown/republish）；不新增审计表（合并/拆分/重发布复用 `ReviewDecision`/`PublicationDecision`，意图入 `note`）。不新增 Prisma 迁移（零 schema 改动——全部复用既有表）。
- 不自动发布拆分出的新事件（尊重发布闸门不变量；B 落地 `candidate`，运营经既有 1.6 队列 approve。auto-publish defer 至「低风险自动发布」未决项）。不把合并/拆分结果直接写 `published_*`（必经 `decideReview`→`refreshPublishedReadModel`）。
- 不做按标签的 feed 筛选 / 分类维度（归 Epic 2.2）。不接真实外部 LLM（沿用 1.8 defer）。不做运营台鉴权（沿用 1.6 占位 `/console` 公开可达）。
- 不让 `event-assembly` 写 `publication_status`/决策/`published_*`；不让 `mergeHotEvents`/`splitHotEvent` 改 `hot_events.title`（标题归聚类派生 + 1.9 revision overlay）。不让合并后的 target 自动 append `HotEventRevision`（改标题是 1.9 运营动作，不在合并内）。
- 不改 1-6/1-7/1-8/1-9 既有 verify/seed/spec 断言（console/feed/detail/revision seed/spec 零改动保持绿）；`decideReview`/`refreshPublishedReadModel`/`projectEvidenceTimeline` 既有逻辑零改动（仅 `transitions.ts`/`transitions.selfcheck.ts` 加用例）。
- 不渲染投资建议措辞（NFR）；不伪造证据/解释（NFR 空态不假数据）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 合并两 published（AC1） | A、B 均 published；运营在 `/console/{A}` 提交合并 source=B | `mergeHotEvents(B→A)` 搬证据（共享去重）、重算 A signature；`decideReview(A, republish)` 刷新 A 读模型（证据数=并集）；`decideReview(B, takedown, note)` B 读模型删除；公开 `/events/{B}` 404、`/events/{A}` 显并集证据；B 审计链 `published→taken_down` | 无错误预期 |
| 合并共享证据 | A、B 有共同 evidence_record | 该记录在 A 仅一条链（unique 不重复）；B 链清空；A 证据数=去重并集 | P2002 吞掉（沿用 createLinks） |
| 合并非法：source 非 published | B 为 candidate/rejected/taken_down | server action 校验拒绝，不调任何模块，revalidate+redirect 回详情，显错误提示 | 校验前置阻断 |
| 合并非法：source=target | 提交 B=A | 校验拒绝，零写入 | 校验前置阻断 |
| 拆分 published（AC2） | A published；运营勾选证据子集（非空、非全部）+新标题，提交拆分 | `splitHotEvent` 建 candidate B（signature=被选证据）、搬选中链 source→B、重算双方 signature；`decideReview(A, republish)` 刷新 A 读模型显剩余证据；B 出现在复核队列（status=candidate） | 无错误预期 |
| 拆分非法：选全部证据 | 勾选 A 的全部证据 | 校验拒绝（留至少 1 条；那是 takedown 不是 split），零写入 | 校验前置阻断 |
| 拆分非法：选空集 | 未勾选任何证据 | 校验拒绝，零写入 | 校验前置阻断 |
| 下线重发布（AC3） | 某 hotEvent status=taken_down（曾 published 后下线）；运营点「重新发布」 | `decideReview({outcome:"republish"})` 经新转换 `taken_down→published/publish`；append `ReviewDecision(republish)`+`PublicationDecision(taken_down→published)`+refresh；公开 `/events/{id}` 重新可见（显 effective 标题/标签/解释 + 当前证据）；`publishedAt=now()`（重发布即新首次公开） | 无错误预期 |
| 误拒后重发布（AC3） | status=rejected（从未 published）；运营点「重新发布」 | 经新转换 `rejected→published/publish`；upsert `create` 分支建 `published_*`；公开 `/events/{id}` 可见 | 无错误预期 |
| 重发布非法状态 | candidate 的 hotEvent，`decideReview({outcome:"republish"})` | `resolveTransition` 抛 `IllegalTransitionError`（事务零写入）；server action revalidate+redirect 回详情 | IllegalTransitionError |
| 追加式不变量（AD-5） | 合并后查 B、拆分后查 A 的决策链 | 旧 `ReviewDecision`/`PublicationDecision` 行不 update/delete；新增行 append（takedown/republish）；链含 from→to 与 note | 无错误预期 |

</intent-contract>

## Code Map

- `packages/core/src/modules/review-workflow/transitions.ts` -- MODIFY：`resolveTransition` 加 `taken_down+republish→published/publish` 与 `rejected+republish→published/publish` 两条分支；`LEGAL_TRANSITIONS` 追加对应两条。`decideReview` 本身零改动（generic 已覆盖）
- `packages/core/src/modules/review-workflow/transitions.selfcheck.ts` -- MODIFY：加 taken_down/rejected+republish 合法用例 + candidate+republish、taken_down+approve/reject/takedown 非法用例（锁转换图）
- `packages/core/src/modules/event-assembly/merge-split-service.ts` -- NEW：`mergeHotEvents({prisma, traceId, sourceId, targetId, reviewer})`（读 source 链→逐条搬 target，P2002 吞掉→清空 source 链→重算 target `signatureOf` 并 `hotEvent.update` signature；校验 source≠target；返回 `{movedLinks, dedupedLinks, targetSignature}`）与 `splitHotEvent({prisma, traceId, sourceId, evidenceRecordIds, title, reviewer})`（校验子集非空且非全部→建 candidate HotEvent【title、signature=被选证据 signatureOf、Candidate】→搬选中链 source→new→重算双方 signature；返回 `{newHotEventId, movedLinks}`）。仅写 `hot_event_evidence`+`hot_events`（signature/新建），不写 title/status/读模型
- `packages/core/src/modules/event-assembly/types.ts` -- MODIFY：加 `MergeHotEventsOptions`/`MergeHotEventsResult`/`SplitHotEventOptions`/`SplitHotEventResult`
- `packages/core/src/modules/event-assembly/index.ts` + `packages/core/src/index.ts` -- MODIFY：桶导出 `mergeHotEvents`/`splitHotEvent` + 类型
- `apps/web/app/(operator)/console/[eventId]/page.tsx` -- MODIFY：published 分支（`<RevisionBranch>` 或新增 `<PublishedActions>` section）增「合并」（`<select>` 列其它 published 事件作 source + 提交）与「拆分」（证据列表 `<input type=checkbox name=evidenceRecordId>` + 新标题 + 提交）表单；`taken_down`/`rejected` 分支增「重新发布」`<button name="outcome" value="republish">`（复用 submitReview）。真实 token，零公开页改动
- `apps/web/app/(operator)/console/[eventId]/actions.ts` -- MODIFY：新增 `submitMerge(formData)`（解析 target=当前 eventId、source、note；校验 source≠target 且 source 为 published——调 `listPublishedHotEvents` 比对；顺序 `mergeHotEvents`→`decideReview(target,republish,note)`→`decideReview(source,takedown,note)`；revalidate `/console`+`/console/{target}`+`/console/{source}`+`/events/{target}`+`/events/{source}`；redirect 回 target 详情）与 `submitSplit(formData)`（解析 source=当前 eventId、evidenceRecordIds[]、title、note；校验子集非空非全部；顺序 `splitHotEvent`→`decideReview(source,republish,note)`；revalidate `/console`+`/console/{source}`+`/events/{source}`；redirect 回 source 详情）
- `apps/worker/src/verify-merge-split.ts` -- NEW：镜像 `verify-revision.ts`（resetEnvCache→requireEnv DATABASE_URL→getPrisma→resetPrisma；BASE_MS 固定）；seed source+records→cluster 产 2 候选→各自 explain→各自 approve 产 A、B 两 published；断言：合并后 A 证据数=并集、A signature 重算、B `published_*` 删除、`getPublishedHotEventDetail(B)` 返 null、B 决策链 `published→taken_down`+`published→published`(republish on A) 旧行不删；再 split A 子集→新 candidate B2、A 证据数减少、A signature 重算、B2 status=candidate；下线重发布：approve→takedown→republish 公开重现、`publishedAt`=重发布时刻、`rejected→republish` 建 published_*；candidate+republish 抛 `IllegalTransitionError` 零写入；打印 PASS。无需 Redis
- `apps/worker/package.json` -- MODIFY：加 `verify:merge-split`（`tsx src/verify-merge-split.ts`）
- `apps/web/e2e/seed-merge-split.ts` -- NEW：镜像 `seed-revision.ts`；cluster→explain→approve 产 2 published（返回两 hotEventId + 初始证据集）；不改既有 seed
- `apps/web/e2e/merge-split.spec.ts` -- NEW（describe 标题含 `@merge-split`）：前置 `tsx e2e/seed-merge-split.ts`；断言：`/console/{A}` 渲染合并/拆分表单；提交合并 source=B → `/events/{B}` 404、`/events/{A}` 显并集证据数、`/console/{B}` 审计链含 takedown(merged)；提交拆分勾选子集 → `/console` 复核队列出现新 candidate、`/events/{A}` 显剩余证据；taken_down 事件详情显「重新发布」按钮，提交后 `/events/{id}` 重现
- `apps/web/package.json` -- MODIFY：加 `e2e:merge-split`（`tsx e2e/seed-merge-split.ts && NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 playwright test --grep @merge-split`）与 `seed:merge-split`；**改 `e2e` 的 `--grep-invert` 为 `"@console|@feed|@detail|@revision|@merge-split"`**；既有 `e2e:*` 不动
- `_bmad-output/implementation-artifacts/deferred-work.md` -- MODIFY：追加 1-10 defer（拆分自动发布/auto-publish 未决、合并时同步改标题、合并/拆分跨模块非原子、运营台鉴权、按标签筛选归 Epic 2.2、真实 LLM 沿用 1.8 defer）

## Tasks & Acceptance

**Execution:**
- `packages/core/src/modules/review-workflow/{transitions.ts,transitions.selfcheck.ts}` -- 加 `taken_down/rejected+republish→published/publish` 两条转换 + selfcheck 用例（合法 + 非法）-- 下线/误拒重发布闸门复用（零 decideReview 改动）
- `packages/core/src/modules/event-assembly/{merge-split-service.ts,types.ts,index.ts}` + `src/index.ts` 桶 -- `mergeHotEvents`（搬证据+共享去重+重算 target signature）+ `splitHotEvent`（建 candidate+搬子集证据+重算双方 signature）+ 类型 + 桶导出 -- 合并/拆分域逻辑（event-assembly 写归属内，仅写 evidence 链 + signature）
- `apps/worker/src/verify-merge-split.ts` + `package.json:verify:merge-split` -- 集成自检（合并并集/source 下线/拆分 candidate/双方 signature 重算/下线重发布/误拒重发布/非法转换）-- 锁合并+拆分+重发布读契约（surface = 查询返回 + 读模型行）
- `apps/web/app/(operator)/console/[eventId]/{page.tsx,actions.ts}` -- published 分支合并/拆分表单 + taken_down/rejected 分支重发布按钮 + `submitMerge`/`submitSplit`(submitReview 复用) server action -- AC1/AC2/AC3 运营主面（零公开页改动）
- `apps/web/e2e/{seed-merge-split.ts,merge-split.spec.ts}` + `package.json:e2e:merge-split/seed:merge-split` + `e2e` grep-invert 加 @merge-split -- 独立 seed（产 2 published）+ @merge-split e2e（合并后 source 404/target 并集、拆分后新 candidate/source 剩余、重发布后重现）-- AC1/AC2/AC3 surface-anchored 验证；console/feed/detail/revision seed/spec 零改动
- `_bmad-output/implementation-artifacts/deferred-work.md` -- 追加 1-10 defer 项 -- 诚实登记

**Acceptance Criteria:**
- Given 本地 PG 可达且 A、B 两候选经 cluster→explain→`decideReview(approve)` 均已 published，When 运营在 `/console/{A}` 选 source=B 提交合并，Then `mergeHotEvents` 把 B 的证据链搬到 A（共享去重）、重算 A `cluster_signature`，And `decideReview(A, republish)` 刷新使公开 `/events/{A}` 显**并集**证据数，And `decideReview(B, takedown)` 使公开 `/events/{B}` 返回 404（读模型删除），And B 的决策审计链含 `published→taken_down`（note 载 merged into A）且旧行不删（AD-5），And A、B 的既有 `review_decisions`/`publication_decisions` 历史完整保留。
- Given A 已 published 且证据数 ≥2，When 运营在 `/console/{A}` 勾选证据子集（非空、非全部）+ 新标题提交拆分，Then `splitHotEvent` 新建 candidate `HotEvent`（`signatureOf`=被选证据）、把选中链 source→new 搬迁、重算双方 `cluster_signature`，And `decideReview(A, republish)` 刷新使公开 `/events/{A}` 显**剩余**证据，And 新事件以 `candidate` 出现在 `/console` 复核队列（未自动发布，尊重闸门），And 运营可经既有 approve 把新事件发布到公开。
- Given 某 hotEvent status=taken_down（曾 published 后下线），When 运营在 `/console/{id}` 点「重新发布」(`outcome=republish`)，Then `decideReview` 经新转换 `taken_down→published` 单事务 append `ReviewDecision(republish)`+`PublicationDecision(taken_down→published)`+刷新读模型，And 公开 `/events/{id}` 重新可见（显 effective 标题/标签/解释 + 当前证据），And `publishedAt` 为重发布时刻；And 同样适用于 status=rejected（从未 published，经 `rejected→published` 首次建 `published_*` 行）。
- Given 某 hotEvent status=candidate，When `decideReview({outcome:"republish"})`，Then `IllegalTransitionError`（事务零写入）；And server action revalidate+redirect 回详情（不静默状态漂移）。
- Given 合并提交 source=target 或 source 非 published，或拆分勾选空集/全集，When `submitMerge`/`submitSplit`，Then 校验前置阻断、零模块调用、零写入、显错误提示。
- Given 详情路由 force-dynamic 且 1-10 仅改运营台，When 执行 `pnpm --filter web build`（无 `DATABASE_URL`），Then 构建成功（公开动态路由仍仅 `/` 与 `/events/[hotEventId]`，本 story 不新增），And `pnpm -r typecheck` / `pnpm -r lint` 通过，And `pnpm --filter core verify:review-logic` 打印 PASS（含新 taken_down/rejected republish 用例 + candidate republish 非法），And `pnpm --filter core verify:cluster-logic` 不回归，And `pnpm --filter worker verify:merge-split` 打印 PASS（合并并集/source 下线/拆分 candidate/双方 signature 重算/下线+误拒重发布/追加式），And `pnpm --filter worker verify:publish`/`verify:revision` 不回归。
- When 执行 `pnpm --filter web e2e:merge-split`（seed + `@merge-split`），Then 合并后 source 404/target 显并集、拆分后新 candidate 入队/source 显剩余、重发布后公开重现；And `pnpm --filter web e2e`（home/navigation/design）/ `e2e:console` / `e2e:feed` / `e2e:detail` / `e2e:revision` 全绿不回归。

## Spec Change Log

<!-- 空，直至首次 bad_spec 回路。 -->

## Review Triage Log

<!-- 空，直至首次评审。 -->

## Design Notes

**为何不新增 status/outcome/表/迁移（ponytail 最小）：** 合并/拆分/重发布全部可由既有原语组合：重发布 = 新两条转换（复用 `ReviewOutcome.Republish` + `decideReview`）；合并 target 的证据刷新 = `decideReview(target, republish)`；合并 source 退役 = `decideReview(source, takedown)`；拆分 source 刷新 = `decideReview(source, republish)`；新事件 = `candidate`（既有）。意图审计入 `ReviewDecision.note`/`PublicationDecision.reason`（既有字段），无需新表。`published_*` 由既有 `refreshPublishedReadModel`+`projectEvidenceTimeline`（deleteMany+重插）重投影，零改动。零 schema 变更 = 零迁移 = 比 1.9 更轻。

**为何合并/拆分域逻辑放 event-assembly 而非 review-workflow：** AD-2 明定 event-assembly 是 `hot_events`+`hot_event_evidence` 唯一写主（含 `cluster_signature`）。搬证据链、重算 signature、建 candidate 是聚类重组，属 event-assembly 域。`clusterEvents` 已有候选级合并原语（搬链 + `signatureOf` 重算），本 story 的 `mergeHotEvents`/`splitHotEvent` 是其「运营显式驱动、对已发布事件」版，同型。review-workflow 只负责状态流转决策（不碰证据/signal）。两模块经 server action 顺序协作（同 1.9 `submitRevision` 编排 revise+saveExplanation）。

**为何拆分新事件落地 candidate 而非自动发布：** 架构 spine 明确「operator review is the publish gate」「the review gate stays mandatory until real operator load is observed」（auto-publish 为未决 defer）。拆分出的子集是新内容面向公开，必经闸门。落地 candidate → 运营在既有 `/console` 队列 approve（1.6 既有流程）→ 公开。这非 intent gap：发布闸门不变量在 intent（epic「viewable+trustworthy」+ spine defer）中选定「必经复核」读法；「拆分即自动发布」是未来 auto-publish 未决项的另一读法，记 defer。

**为何合并后 publishedAt 重置而非保留原值：** taken_down 时 `refreshPublishedReadModel(takedown)` 已删除 `published_*` 行（含 publishedAt），故重发布 upsert 走 `create` 分支 = `now()`。重发布即「新的首次公开时刻」，语义自洽；原历史在 `PublicationDecision` 链（published→taken_down→published）完整保留。保留原 publishedAt 需读历史决策反推，超 V1 最小（ponytail：接受 row 重建语义）。

**为何用 takedown+republish 表达合并/拆分而非新 outcome：** 合并 target/拆分 source 状态不变（仍 published），仅证据变 → 自然是 `republish`（published→published 刷新）；合并 source 退役 = published→taken_down → 自然是 `takedown`。新 outcome（merge/split）会重复事务/决策/refresh 编排（反 DRY）且 merge/split 不映射到 (from,outcome)→(to,action) 单一状态模型。意图经 `note` 结构化（`"merged into {id}"`/`"split: moved N to {id}"`）保留可审计性。

## Verification

**Commands:**
- `pnpm -r typecheck` -- expected: 全 workspace 通过（event-assembly merge-split-service + review-workflow 新转换 + web 合并/拆分/重发布 UI）
- `pnpm -r lint` -- expected: 无错误
- `pnpm --filter core verify:review-logic` -- expected: selfcheck PASS（含 taken_down/rejected+republish 合法 + candidate+republish、taken_down+非republish 非法用例）；无 infra
- `pnpm --filter core verify:cluster-logic` -- expected: 不回归（聚类逻辑零改动）
- `pnpm --filter worker verify:merge-split` -- expected: 集成脚本打印 PASS（合并并集/source 下线/共享去重/拆分 candidate/双方 signature 重算/taken_down 重发布/rejected 重发布/追加式/非法转换）；仅需 live PG、无 Redis
- `pnpm --filter worker verify:publish` / `verify:revision` -- expected: 不回归（既有逻辑零改动）
- `pnpm --filter web build` -- expected: 无 `DATABASE_URL` 下构建成功（公开动态路由仍仅 `/` 与 `/events/[hotEventId]`；运营台 force-dynamic；本 story 不新增公开动态路由）
- `pnpm --filter web e2e:merge-split` -- expected: seed 后 `@merge-split` 通过（合并 source 404/target 并集 + 拆分新 candidate 入队/source 剩余 + 重发布重现）
- `pnpm --filter web e2e` / `e2e:console` / `e2e:feed` / `e2e:detail` / `e2e:revision` -- expected: 不回归（console/feed/detail/revision seed/spec 零改动）

**Manual checks (if no CLI):**
- 合并：`/console/{A}` 选 published B 提交 → `/events/{B}` 404、`/events/{A}` 显并集证据、`/console/{B}` 审计链含 takedown(merged)、`/console/{A}` 含 republish；source=target/非 published 被拒。
- 拆分：`/console/{A}` 勾选子集+标题提交 → `/console` 队列出现新 candidate、`/events/{A}` 显剩余证据、新 candidate 经 approve 后公开；空集/全集被拒。
- 下线重发布：taken_down/rejected 事件 `/console/{id}` 显「重新发布」按钮，提交后 `/events/{id}` 重现（effective 标题/标签/解释 + 证据）；candidate 重发布被拒（IllegalTransition）；历史决策链旧行不删。
