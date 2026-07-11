# 代码评审报告 · bmad-loop 抢救故事

- **日期**：2026-07-11
- **评审范围**：bmad-loop run `20260709-234338-14b3` 中 **5 颗"抢救"故事**（dev 会话超时/中断后手动提交、跳过 loop review）
- **评审对象 commit**：`8724e9a`(1-6) · `a3afebc`(1-7) · `e130483`(1-9) · `7d85b65`(1-10) · `a2842ff`(2-1)
- **方法**：5 个 code-reviewer 子代理并行深审（各审一颗 commit diff + 读源码），主审汇总；严重度分 CRITICAL / HIGH / MEDIUM / LOW
- **背景**：本次 run 因两个根因（glm-5.2@xhigh 思考延迟、dev session 无 DATABASE_URL）反复触发 90min 超时，5 颗故事在超时/中断后由人工 commit 成果并标记 done，**未经过 loop 自带 review**，故做本次专项评审。

---

## 一、评审摘要

| 故事 | commit | 判定 | 首要问题 |
|---|---|---|---|
| 1-6 review-queue-and-publication-gate | `8724e9a` | 🟡 SHIP-WITH-FIXES | operator 写路径无 auth；`decideReview` TOCTOU 竞态 |
| 1-7 public-hot-event-feed | `a3afebc` | 🟡 SHIP-WITH-FIXES | 信任边界干净；AC3 日期窗过滤 e2e 未覆盖 |
| 1-9 copy-and-tag-corrections | `e130483` | 🟡 SHIP-WITH-FIXES | operator 侧 AiLabel 源判定近似（公开侧正确） |
| 1-10 merge-split-and-unpublish | `7d85b65` | 🔴 **BLOCK** | merge/split 未包事务，与文档承诺矛盾 |
| 2-1 market-reaction | `a2842ff` | 🟡 SHIP-WITH-FIXES | 干净；缺复合索引 + 一处重复查询 |

**最关键的积极结论**：5 颗的**信任边界（公开/运营隔离）全部干净**。公开页只读 `published_*` 读模型，靠**结构性隔离**（`listPublishedHotEvents` 无 `WHERE`、行存在即已发布；投影仅 5 列无 operator 字段），不泄漏 candidate/rejected/taken_down 或内部状态。AD-3 / AD-8 在 5 颗中均成立。这是整个系统最重要的安全属性，经评审确认成立。

**整体评价**：5 颗中 4 颗可发（修建议项后）、1 颗（1-10）需先修阻塞性缺陷。核心域逻辑与项目约定基本正确，问题集中在**事务原子性、auth 闸、若干测试覆盖缺口**，而非根本性设计错误。抢救故事的质量优于预期。

---

## 二、横切性发现（跨故事共性问题）

### 1. 多步写操作未包事务（最严重，1-10 达 BLOCK）

`decideReview`（review-service.ts:68）示范了正确的 `$transaction` 写法，但多处多步写未遵循：

- **1-10 `merge-split-service.ts:92-160, 211-286`**：`mergeHotEvents`/`splitHotEvent` 是 ~N+N+2 条**自动提交**语句，**无 `$transaction`**。文件 doc-comment（9-13 行）却明文承诺"单事务原子性、非法转移不改状态（无部分写）"。实现与承诺不符：崩溃在循环中途 → evidence 部分搬迁、source 被抽干但状态未变、`cluster_signature` 过期。
- **1-6 `decideReview`（review-service.ts:68-135）**：事务内 `findUniqueOrThrow`（无锁）→ `resolveTransition` → `update`，默认 Read Committed。两个并发运营提交（如 approve + takedown 撞同一 candidate）可都读到 `candidate`、都过校验、都写 → 留下矛盾 `PublicationDecision` + 终态取决于谁后落。
- **1-6 / 1-9 / 1-10 server action**：split+republish、merge+republish+takedown 多步无补偿动作。已在 `deferred-work.md` 记为 V1 已知项，但崩溃窗口会让公开读模型**过期**（非损坏）直到人工重发。

### 2. operator 写路径无 auth（1-6，部署闸）

`(operator)/layout.tsx:22-28` **无任何 auth 检查**；`console/[eventId]/actions.ts` 的 server action（publish/takedown/merge/split/revise）直接写库，`reviewer:"operator"` 硬编码。spec 承认 V1 推迟真实 auth，但这是**真实信任边界缺口**：一旦部署，`/console/*` 及其写 action 对任何未认证请求开放。`robots:noindex` 不能缓解写权限。

### 3. verify 脚本部分未被实跑（抢救期 PG 问题所致）

抢救期间 dev session 无 DATABASE_URL，多个 `verify:*` 脚本在 dev 阶段从未成功连库跑过（1-10 的 commit 自述 40 次连库失败）。**评审期已用 `aguhot_dev` 库实跑**：
- `verify:merge-split` → **PASS 30/30**（功能 AC 已验证通过）
- `verify:publish`、`verify:review-logic` → 此前已通过

故"功能正确性"有经验证据；但**原子性/并发缺陷**（上述第 1 点）是 verify 脚本不触发的场景（不会崩溃中途、单线程），需单独评估。

### 4. 测试覆盖缺口

- **1-7**：`feed.spec.ts` **未覆盖 AC3 日期窗过滤**（头条过滤 UX 零测试）；`来源数` 断言偏弱（只查文案不查数值）。
- **1-10**：selfcheck 未**显式**断言 `taken_down+approve` / `rejected+approve` 抛错（仅隐式覆盖，建议显式锁定边界）。

### 5. 规模化索引天花板（V1 可延后）

- `published_hot_events`：`listPublishedHotEvents` 按 `(evidenceCount DESC, latestEvidenceAt DESC)` 排序，无对应复合索引。
- `MarketReactionSnapshot`（2-1）：热读路径 `WHERE hotEventId ORDER BY createdAt DESC` 缺复合索引 `@@index([hotEventId, createdAt])`。
- `explanation_versions`（1-9）：`(hotEventId)` + `(hotEventId, createdAt DESC)` 索引需确认存在。

V1 数据量极小，均非缺陷，记为规模化前补。

---

## 三、逐故事详评

### 1-6 · review-queue-and-publication-gate（`8724e9a`）— 🟡 SHIP-WITH-FIXES

核心状态机 + selfcheck（22 断言：6 合法转移 + 穷举非法 + 状态漂移检测）优秀；read-model 单写者（AD-3）干净；SQL 注入干净（Prisma 参数化）。

| 严重度 | 位置 | 问题 | 修法 |
|---|---|---|---|
| HIGH | `review-service.ts:68-135` | `decideReview` TOCTOU 竞态（见横切 1） | 条件 update `where:{id, publicationStatus: fromStatus}`，Prisma P2025 → 映射 `IllegalTransitionError`（零迁移） |
| HIGH | `(operator)/layout.tsx:22-28` | 写路径无 auth（见横切 2） | 至少 `if (NODE_ENV==='production' && !session) redirect()` 或 env-flag 闸 |
| MEDIUM | `schema.prisma:197,222` | `outcome`/`fromStatus`/`toStatus` 无 DB CHECK 约束 | 加 `CHECK (outcome IN (...))` 防御纵深 |
| MEDIUM | `actions.ts:337-360` | split+republish 非原子，崩溃留过期读模型 | 记为已知；或包进核心编排器单事务 |
| LOW | `schema.prisma:269` | `published_hot_events` 无复合索引 | 量化前补 `@@index([evidenceCount, latestEvidenceAt])` |
| LOW | `verify-publish.ts:680-684` | 写隔离断言被弱化为 `>=`（illegal-setup 播种污染基线） | 基线移到断言前 / 播种用独立变量 |
| INFO | `page.tsx:28` | commit 捆绑了 1.9/1.10 的 operator UI | salvage 情有可原；spec 标 1-6 |

### 1-7 · public-hot-event-feed（`a3afebc`）— 🟡 SHIP-WITH-FIXES

信任边界**结构性干净**（`listPublishedHotEvents` 无 `WHERE`、5 列投影无 operator 字段）。`force-dynamic` 演进（公开 build 仍 DB-free）三处文档到位。App Router 约定（async searchParams、server component、`_components/` 共置）一致。

| 严重度 | 位置 | 问题 | 修法 |
|---|---|---|---|
| HIGH | `feed.spec.ts` | **AC3 日期窗过滤零覆盖**（`?window=today/7d/30d`、active pill 态、"筛选无结果"分支均未断言） | 补 e2e |
| HIGH | `feed-filters.tsx:53`、`page.tsx:101` | filter-pill/空态链接用裸 querystring，会冲掉未来 `concept/industry` 参数 | 改 `pathname+searchParams` 合并；空态链接用 `href="/"` |
| MEDIUM | `feed.spec.ts:50` | `来源数` 断言只查文案不查数值 | 断言 `来源数 1`（seeded evidenceCount） |
| LOW | `seed-feed.ts:75-76` | `recentAgo`/`olderAgo` 时间戳完全相同，命名误导 | 重命名或真正区分 |

### 1-9 · copy-and-tag-corrections（`e130483`）— 🟡 SHIP-WITH-FIXES

无 CRITICAL。核心域逻辑（append-only revisions、effective 投影、republish gate、公开读模型隔离）干净。`verify-revision.ts` **真实有意义**（9 条矩阵全覆盖，非 stub）——dev 的 PG 之痛是"跑不起来"而非"测试浅"。迁移 `tags TEXT[] DEFAULT ARRAY[]` + `hot_event_revisions ON DELETE RESTRICT` 正确。

| 严重度 | 位置 | 问题 | 修法 |
|---|---|---|---|
| HIGH | `console/[eventId]/page.tsx:223-227` | operator 侧 `<AiLabel>` 用 `pending.explanation===true` 启发式判定源，"刚 republish 人工编辑后刷新"会**误标**已发布的人工解释为 AI | 给 `PublishedEventRevisionView.published.explanation` 补 `source` 字段，直接判定 `source!=="human"`（公开侧已正确） |
| HIGH | `review-service.ts:388-389` | `pendingTitle`（比基线）/`pendingTags`（非空）判定标准不一致 | 统一两者的"pending"判据或文档说明差异（仅信息性，非 published 状态下不可 republish） |
| MEDIUM | `explain-service.ts:151-153` 等 3 处 | 内联 `import("...generated/client").PrismaClient` 类型，偏离同文件顶部导入约定 | 提到顶层 `import type { PrismaClient }` |
| MEDIUM | schema | `explanation_versions(hotEventId)` / `(hotEventId, createdAt DESC)` 索引需确认存在 | 核对迁移，缺失则补 |

### 1-10 · merge-split-and-unpublish（`7d85b65`）— 🔴 BLOCK

状态机图正确、selfcheck 扎实、`verify:merge-split` **30/30 已实跑通过**（功能 AC 已验证）。但实现与文档承诺的原子性矛盾，且并发场景未经测试——这是评审存在的意义要抓的那类问题。

| 严重度 | 位置 | 问题 | 修法 |
|---|---|---|---|
| **CRITICAL** | `merge-split-service.ts:92-160, 211-286` | `mergeHotEvents`/`splitHotEvent` 未包 `$transaction`，~N+N+2 条自动提交语句；doc-comment 承诺单事务原子性。崩溃中途 → evidence 部分搬迁、source 抽干但状态未变、`cluster_signature` 过期 | 整个函数体包 `prisma.$transaction(async tx => {...})`，内部全用 `tx.` |
| HIGH | `actions.ts:231-235` | `submitMerge` 用读模型（`listPublishedHotEvents`）而非状态表校验 source-published；读模型与状态表分歧时，source 可能已 taken_down 却仍在列表 → `mergeHotEvents` 抽干后 `decideReview(source,takedown)` 抛错，留 source 0 链接且非 taken_down | 直接读 `hotEvent.publicationStatus === "published"` |
| HIGH | `merge-split-service.ts:125-146, 255-275` | 逐链接 create-then-delete 无行锁；并发 merge/split 撞同一 target 会在 `clusterSignature` 重算上最后写赢；`movedLinks`/`dedupedLinks` 计数竞态 | 同 CRITICAL 事务包裹（serial 隔离或 `SELECT...FOR UPDATE`） |
| HIGH | `transitions.selfcheck.ts` | 未显式断言 `taken_down+approve` / `rejected+approve` 抛错（1-10 让 `taken_down+republish`/`rejected+republish` 合法后，这两个边界仅隐式覆盖） | 显式加 illegalCases 锁定边界 |
| MEDIUM | `actions.ts:241-262` | `submitMerge` 三步序列无补偿动作（已记 deferred-work） | V1 可接受；至少给 operator 失败信号 |
| MEDIUM | `merge-split-service.ts:241-247` | `splitHotEvent` 先建 candidate 再移链接，中途抛错留半成品 candidate | 候选创建移入事务（被 CRITICAL 修复涵盖） |
| LOW | `actions.ts:207-215, 348` | merge/split 序列用多个 `traceId`，审计链断裂 | 全序列透传单一 action 级 `traceId` |
| LOW | `types.ts:115-122` | `SplitHotEventOptions.reviewer` 死输入（仅 round-trip 进 result） | 移除或文档说明 |

**解锁 1-10 的最低要求**：`mergeHotEvents`/`splitHotEvent` 包 `$transaction`；重跑 `verify:merge-split` 贴 PASS 输出；再评估 HIGH 项。

### 2-1 · market-reaction（`a2842ff`）— 🟡 SHIP-WITH-FIXES

尽管 dev session 混乱（subagent-launch stall + 3h51m），实现**连贯完整**：无 TODO/FIXME/placeholder，信任边界干净，约定贴合（module/queue 结构对齐 source-ingest/explain-queue），AC 覆盖强（6 verify + 3 e2e）。`const adapter = undefined` 是文档化的"V1 诚实降级"，非缺陷。

| 严重度 | 位置 | 问题 | 修法 |
|---|---|---|---|
| MEDIUM | `schema.prisma:443-444` | `MarketReactionSnapshot` 仅两个单列索引，热读路径 `WHERE hotEventId ORDER BY createdAt DESC` 需排序 | 补 `@@index([hotEventId, createdAt])`（V1 不写数据，规模化前补） |
| LOW | `market-reaction-service.ts:128-167,194` vs `publish-service.ts:389-439` | `getLatestMarketReaction` 已导出但零外部调用，`projectMarketReaction` 内联重复了相同查询（drift 风险） | 复用或删除导出 |
| LOW | `verify-market-reaction.ts:248` | `sleep(20)` 防 `createdAt` 同毫秒；但 UUIDv7 id desc 已是确定性 tiebreaker，sleep 技术上多余 | 可移除（非必须） |

---

## 四、优先修复清单（按影响）

1. **[BLOCK] 1-10 merge/split 包 `$transaction`** — 与文档承诺一致，消除崩溃/并发的半成品风险。最小改动：函数体包 `prisma.$transaction(async tx => {...})`，内部改 `tx.`。
2. **[HIGH] operator auth 闸（1-6，部署前必须）** — 写路径不能对未认证开放。最低：prod/env-flag `redirect()`。
3. **[HIGH] 1-6 `decideReview` 乐观锁** — 条件 update 防并发转移竞态（零迁移）。
4. **[HIGH] 1-7 补 AC3 日期窗 e2e** — 头条过滤 UX 当前零测试。
5. **[HIGH] 1-10 `submitMerge` 用状态表校验 source** — 读模型/状态表分歧下的安全网。
6. **[MEDIUM] 1-9 operator AiLabel 源判定** — 补 `source` 字段精确化（消除误标）。
7. **[MEDIUM] 1-10 selfcheck 显式锁定 `taken_down/rejected + approve` 非法边界**。
8. **[LOW] 复合索引**（published_hot_events / market_reaction_snapshots / explanation_versions）— V1 量级可延后。

---

## 五、结论

5 颗抢救故事整体质量**优于预期**：核心域逻辑（状态机、append-only 审计、读模型投影、公开/运营隔离）正确，项目约定（barrel 导出、snake_case `@map`、UUIDv7、`force-dynamic`、`import type`、相对 `.js` 导入）一致遵守，信任边界这一最关键安全属性全 5 颗成立。`verify:*` 脚本真实有意义（非 stub），功能 AC 经验验证通过。

主要风险集中在**两类工程性问题**而非设计错误：
- **事务原子性**（1-10 BLOCK、1-6 竞态、多步 server action）——文档承诺的原子性在 1-10 未实现，是必须修的阻塞项。
- **auth 闸缺失**（operator 写路径）——V1 推迟真实 auth 可接受，但需部署闸防开放写。

修复清单中前 5 项为建议在"依赖这批代码做信任边界/部署"之前处理；其余可作为后续迭代。**1-10 在事务包裹修复前不应作为发布基线**。

---

## 附录：评审验证记录

- `verify:merge-split`（DATABASE_URL=postgresql://aguhot:aguhot@localhost:5432/aguhot_dev）：**PASS 30/30**（评审期实跑，修正"dev 期从未跑过"的代理误判——功能 AC 已验证）。
- 本次评审未覆盖：16 颗 loop 自完故事（已过 loop review）、e2e 实跑（仅静态 + verify 脚本）、前端可访问性细节（3-5/3-6 范围）。
- 评审产物：本报告 + 5 份子代理详评（已并入上文）。
