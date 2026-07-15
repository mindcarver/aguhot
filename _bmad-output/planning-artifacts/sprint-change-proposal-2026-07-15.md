---
title: "Sprint Change Proposal — 投资相关性打分与分级发布闸门"
date: 2026-07-15
scope: Moderate
status: approved (2026-07-15, Carver)
trigger: 运营反馈——"什么新闻都往里拉，垃圾新闻也上首页"
route_to: Product Owner / Developer（Architect 点评 AD-2 写拥有者）
decisions_locked:
  - 信号范围: V1 只用现有数据（多源覆盖 + 升温速度 + 市场反应 + 板块关联），社交热度列 deferred
  - 闸门力度: 高分自动发 / 中分进运营复核 / 低分相关性不过则拦截
  - 交付模式: Batch
---

# Sprint Change Proposal — 投资相关性打分与分级发布闸门

## Section 1 — Issue Summary（问题摘要）

### 触发
Carver 在 sprint 执行中发现：**公开时间流里混入大量低质量/与投资无关的新闻**，提出"要有投资价值的或会影响投资的新闻才会展示"，并要求构建打分系统。

### 核心问题（精确陈述）
**当前 pipeline 没有任何质量闸门，是纯"来者不拒 → 全自动发布"。** 这不是"打分系统需要调参"，而是"打分系统从零不存在"。代码证据：

| 环节 | 文件:行 | 现状 |
|---|---|---|
| 采集 | `source-ingest/ingest-service.ts:105` | 每条 RSS item 仅按 `contentHash` 去重，无任何"值不值得收"判断；缺字段的也归档保留 |
| 聚类 | `event-assembly/cluster-events.ts:139` | overlap 0.7 + 72h 窗口做并查集，**每条**归档记录都进候选 HotEvent，无最小源数/相关性门槛 |
| 发布闸门 | `apps/worker/src/run-pipeline.ts:89-108` | dev runner 对**每个** candidate 调 `decideReview({outcome:"approve"})` 自动过审 |
| 排序 | `publish-orchestrator/publish-service.ts:742` | 写死 `evidenceCount DESC, latestEvidenceAt DESC`，纯展示序 |

全仓 grep `salien|score|rank|weight|priority|relevance|importance|quality`：**evidence/hotevent/timeline 三个读模型上没有任何数值分字段**。架构 spine 里提到的 "saliency read model" 是**写了从未实现**。

### 关键证据 / 约束
1. **社交热度信号（评论/转发/热度）当前完全不存在**：ingest 只接 RSS（`rss-adapter.ts`），只读 title/link/pubDate/description。要用这类信号需新建微博/雪球 adapter，触发 §10 合规面（社交数据采集 + 算法推荐备案）。**V1 不引入，列 deferred。**
2. **`MarketReactionSnapshot`（涨停数、板块涨跌幅）已在库里，却只用于展示、从不参与排序/打分**——这是"市场到底有没有反应"的硬证据，PRD 自己把它列为三大差异化之一，却被浪费。本提案的核心抓手之一就是把它回灌进打分。

---

## Section 2 — Impact Analysis（影响分析）

### 2.1 Epic 影响
- **新增 Epic 7：投资相关性打分与分级发布闸门**（承载本提案的主体工作）。
- **Epic 1 微调**：Story 1.5（聚类生成候选）需注明"现在多了相关性准入闸门"；Story 1.6（复核队列）需注明"saliency 成为复核台排序依据，中分事件进队列"。
- **不 invalidate 任何现有 epic**：Epic 4/5/6 的视觉与 AI 层不动；本提案是给他们提供"更干净的上游输入"。

### 2.2 Story 影响（新 Epic 7 全部为新增 story）

| Story | 标题 | 说明 |
|---|---|---|
| 7.1 | 投资相关性判定（准入闸门） | 关键词白/黑名单 + 板块/个股关联命中 → relevance label（pass / suspicious / fail） |
| 7.2 | 显著度打分 saliency | 加权公式 + Prisma 迁移（`saliency` + `saliencyBreakdown`）|
| 7.3 | 分级发布闸门 | 高分自动发 / 中分留 candidate 进复核 / 低分或相关性 fail → `reject` |
| 7.4 | 市场反应回灌 saliency | publish 时读 `MarketReactionSnapshot` magnitude 进 saliency 重算 |
| 7.5 | 排序与展示接入 | timeline / listPublishedHotEvents 改 `saliency DESC`；FR-3 排序理由 chip 读 breakdown |
| 7.6 | 运营台 saliency 可见 + 阈值可调 + 观测 | 复核台显示分数/breakdown；阈值常量运营可调；新增 SM-9 观测 |
| 7.7 (deferred) | 社交热度信号占位 | V1 不实现，公式留 0 分位，待微博/雪球 adapter + 合规 |

### 2.3 PRD 冲突
- **不冲突核心定位**，反而**落地 PRD 已有但未实现的要求**：
  - PRD §12 Q8 已收口"低风险由正向白名单定义，模糊项默认拒绝放行"——本提案的 relevance gate 就是它的实现。
  - PRD §6 红线"不做脱离证据溯源的纯资讯搬运 / 不做无人工闸门的完全自动发布"——本提案强化而非弱化。
- **需新增**：
  - **NFR-8（内容质量分级）**：所有公开展示的事件必须带投资相关性判定结果与 saliency 分；低于阈值的不得进公开流。
  - **FR-3 增强**：排序理由 chip 改为读 `saliencyBreakdown`（多源覆盖/升温/市场反应/板块关联），仍是可读文案、不暴露内部权重。
  - **SM-9（新增 Success Metric）**：低分拦截率 + 公开流高分占比可观测；对齐并**操作化 SM-C2**（"不以条目数量最大化为目标"——现在第一次有了硬手段）。

### 2.4 Architecture 冲突
- **AD-2（单一写拥有者）需补充 AD-2b**：`saliency` 数值与 relevance label 的**写拥有者归 `event-assembly` 模块**（它已拥有 HotEvent 聚类与候选准入）。`market-reaction` 模块只暴露 snapshot 的只读查询，不跨边界写。这维持 AD-2 不破。
- **AD-3 / AD-3b（只读发布态读模型）需补字段**：`PublishedHotEvent` / `PublishedTimelineEntry` 增 `saliency Float` 列，由 `publish-orchestrator` 在刷新投影时写入（与 `evidenceCount` 同源同流程）。
- **AD-6（运营复核是发布闸门）增强**：发布闸门现在带数值门槛——不是绕过 AD-6，而是给"低风险自动发 / 高风险签核"分层（PRD §12 Q8 已预留）。
- **Capability Map 增一行**：`打分与分级闸门 → event-assembly + publish-orchestrator + review-workflow → AD-2, AD-3, AD-6, NFR-8`。
- **合规（§10）**：relevance gate + saliency 排序**属于"排序精选类算法"**，但这**不是新增合规面**——它落在 §10 已认的算法推荐备案义务内，反而强化其必要性。GA 前律所意见窗口不变。

### 2.5 UX 影响
- 首页时间流条目形态**零改动**（Epic 6 的纵栏形态不动）。
- FR-3 排序理由 chip 的**数据来源**从"写死文案"改为读 `saliencyBreakdown`，文案规则不变（非公式化、不暴露权重）。
- 运营复核台（Epic 1 Story 1.6）增加 saliency 分 + breakdown 展示与按分排序。

---

## Section 3 — Recommended Approach（推荐路径）

### 选定：Option 1 — Direct Adjustment（新增 Epic + 少量 story 微调 + schema 迁移）

**为什么不选 Rollback**：现有 epic 都是对的、不冲突，没有需要回退的失败工作；问题是"缺一层"，不是"做错了"。
**为什么不选 MVP Review**：不改 PRD vision，不砍 scope，反而补齐 PRD 自己预留的口子（§12 Q8、SM-C2）。

### 打分系统设计（两层）

#### 第一层：相关性闸门（gate，决定"要不要"）
判定"这条到底跟投资/市场有没有关系"，过滤娱乐/八卦/社会噪音：
- **板块/个股关联命中**：theme-linking 能挂上 `concept/industry/stock` 关联 → 大概率 pass；挂不上 → suspicious。
- **投资关键词白名单/黑名单**：白名单（政策/财报/并购/涨跌停/加息/产能/订单…）命中加分；黑名单（明星/综艺/纯社会新闻）→ fail。
- **方式**：V1 用**确定性规则**（便宜、可复现、可审计，符合 AD-5）；模糊项后续可丢 LLM 兜底（deferred，不阻塞 V1）。

#### 第二层：显著度打分（saliency，0–100 加权，决定"排第几 / 发不发"）

| 信号 | 分值上限 | 数据来源 | V1 可用 |
|---|---|---|---|
| 多源覆盖 breadth | ~40 | `evidenceCount` + 去重 sourceId 数 | ✅ 现有 |
| 升温速度 velocity | ~20 | N 个源在 1h/6h 窗口内涌入 | ✅ 现有 |
| 市场反应强度 | ~25 | `MarketReactionSnapshot` | ✅ 现有（白用） |
| 板块关联密度 | ~15 | `EventAssociationSet` 数量 | ✅ 现有 |
| 社交热度（预留） | +future | 微博/雪球 adapter | ❌ V1 占位 0 分 |

**处置规则（锁死决策）**：
- relevance = fail **或** saliency < `LOW_THRESHOLD` → `decideReview({outcome:"reject"})`，**不进公开流**。
- `LOW_THRESHOLD` ≤ saliency < `HIGH_THRESHOLD` → 留 `candidate`，**进运营复核队列**。
- saliency ≥ `HIGH_THRESHOLD` 且 relevance = pass → 自动 `approve`（V1 dev；prod 仍可设为需签核，对齐 §12 Q8 高风险子集）。
- 阈值与权重为 **event-assembly 模块配置常量**（不进全局 env），运营后台可调，不写死（照搬 `TIMELINE_FOLD_THRESHOLD` 先例）。

### 落点（最小改动 + 对齐架构）
1. **Prisma 迁移**：`HotEvent` 增 `saliency Float?` + `saliencyBreakdown Json?` + `relevanceLabel`；`PublishedHotEvent` / `PublishedTimelineEntry` 增 `saliency Float?`。
2. **新 scoring 阶段**：插在 `cluster` 之后、`explain` 之前（`cluster-events.ts:139` 或 `event-cluster-queue.ts:70`）——补上架构 spine 写明却没实现的 saliency read model。
3. **发布闸门**：`run-pipeline.ts:95` 的自动过审循环改为按分三级处置；prod 侧 `review-service.ts:108` 前置分数门槛。
4. **排序**：`publish-service.ts:742`、`timeline-read-model.ts:578` 把 `evidenceCount DESC` 换成 `saliency DESC`。
5. **市场反应回灌**：publish-orchestrator 刷新读模型时，读 `MarketReactionSnapshot` 重算 saliency（只读 market-reaction，写归 event-assembly，AD-2 不破）。

### 评估
- **Effort**：Medium（一个迁移 + 一个新 scoring 模块 + 闸门三分支 + 两处 orderBy + 运营台展示）。
- **Risk**：Medium（触碰 AD-6 发布闸门不变式 + DB 迁移；但全部 additive，不破坏既有读路径）。
- **Timeline**：作为独立 Epic 7 并行推进，不阻塞 Epic 5/6。

---

## Section 4 — Detailed Change Proposals

### Story 变更（新增 Epic 7，见 2.2 表）

#### Epic 1 Story 1.5 修订（追加 AC）
```
Section: Acceptance Criteria（追加）
NEW:
- 候选 HotEvent 生成时必须附带 relevance label（pass/suspicious/fail）与 saliency 分
- relevance=fail 的候选不进入发布流程，落 reject 审计
```

#### Epic 1 Story 1.6 修订（追加 AC）
```
Section: Acceptance Criteria（追加）
NEW:
- 复核台列表默认按 saliency DESC 排序，每条显示分数与 breakdown
- 中分（LOW≤saliency<HIGH）候选默认进复核队列；运营可手动覆盖阈值处置
```

### PRD 变更
- §4.1 FR-3：排序理由 chip 数据源改为 `saliencyBreakdown`，文案规则不变。
- §5 新增 **NFR-8 内容质量分级**：所有公开事件必须带 relevance 判定 + saliency；低分不公开。
- §8 新增 **SM-9**：低分拦截率与高分占比可观测（操作化 SM-C2）。
- §12 新增 **Q10（已收口）**：saliency 公式与三级阈值由 event-assembly 模块配置拥有，运营可调，不进全局 env；社交热度信号 V1 占位、deferred。

### Architecture 变更
- 新增 **AD-2b**：saliency 与 relevance 的写拥有者 = event-assembly；market-reaction 仅暴露只读 snapshot 查询。
- AD-3b 投影补 `saliency` 列到 `PublishedHotEvent` / `PublishedTimelineEntry`。
- Capability Map 增一行：打分与分级闸门 → event-assembly + publish-orchestrator + review-workflow。

---

## Section 5 — Implementation Handoff

### Scope 分类：**Moderate**
需 backlog 重组（新增 Epic 7 + 2 个现有 story 追加 AC）+ PO/DEV 协调；架构层有 AD-2b 与读模型字段补充，需 Architect 点评写拥有者边界。

### 交接
| 角色 | 职责 |
|---|---|
| **Architect** | 点评 AD-2b（saliency 写拥有者 = event-assembly，market-reaction 只读）是否成立；确认读模型加字段符合 AD-3 |
| **Developer** | 实施 Epic 7 各 story：Prisma 迁移、scoring 阶段、闸门三分支、orderBy 接入、运营台展示；写 `run-pipeline` 三级处置 |
| **Product Owner** | 把 Epic 7 排入 sprint，确认 SM-9 口径与 NFR-8 措辞；定 `HIGH/LOW_THRESHOLD` 初始值 |

### 成功标准
- [ ] schema 迁移落地，`saliency`/`saliencyBreakdown`/`relevanceLabel` 字段就位
- [ ] scoring 阶段在 cluster 后、explain 前产出分数
- [ ] 发布闸门实现三级处置，低分/无关事件不再进公开流（手测：娱乐/八卦类被拦截）
- [ ] 首页与时间流按 `saliency DESC` 排序，FR-3 chip 读 breakdown
- [ ] 运营台显示分数 + 阈值可调，SM-9 读数可观测
- [ ] 现有 e2e（home/design/themes/navigation）保持全绿（视觉零回归）

---

## Deferred / Out-of-V1
- **社交热度信号**（评论/转发/热度）：需微博/雪球 adapter，触发 §10 合规新增面。V1 saliency 公式留 0 分位，单开 deferred story，与合规推进捆绑。
- **LLM 兜底相关性判定**：V1 用确定性规则；规则覆盖不全的模糊项后续丢 LLMAdapter 判定。
- **个性化 saliency**：V1 通用分，不做 per-user 个性化（对齐 PRD §6 non-goal）。
