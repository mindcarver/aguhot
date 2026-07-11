---
title: "AGUHOT Sprint Change Proposal — 时间流首页与 AI 分析层"
status: pending-approval
created: 2026-07-11
updated: 2026-07-11
scope: Major
trigger: post-V1 参考站对照 (https://aihot.virxact.com/all)
approved: false
---

# Sprint Change Proposal — AGUHOT

> 触发：Epic 1-3 全部交付后，对照参考站 AI HOT (`/all`)，识别出 aguhot 缺少"站级时间流"与"前置 AI 编辑型分析"两类能力，用户决定把首页改为时间流并补三层 AI 分析。
>
> 变更分类：**Major**（定位级转向，触及 PRD Vision/Non-Goals/Metrics 红线）→ 路由 **PM / Architect**。

---

## Section 1: Issue Summary

### 问题陈述

AGUHOT V1（Epic 1-3）已按"优先级排序的热点事件流 + 证据时间线 + 市场反应 + 运营复核"定位交付。用户在交付后对照参考站 AI HOT (`https://aihot.virxact.com/all`)，判断 aguhot 存在两类缺失：

1. **站级时间流**：AI HOT `/all` 是按天分组、分钟级时间倒序的逐条资讯/推文流，含"同事件精选"折叠。aguhot 首页是优先级排序的事件流（FR-1 明确"而不是原始文章列表"），无站级时间流 surface。
2. **AI 层面分析**：AI HOT 每张精选卡正面挂一句 AI `推荐理由`编辑型点评。aguhot 已有 AI 摘要/解释/排序理由 + AI 标识（FR-3/4/6, NFR-3），但缺少挂在列表卡正面的"一句话编辑型点评钩子"、事件级"为什么重要"AI 深读、以及跨事件 AI 趋势研判。

### 发现上下文

- 非实现期问题。Epic 1-3 全部 `done`（见 `sprint-status.yaml`）。
- 触发来自事后竞品对照，属 **Strategic pivot / market change**，非技术限制、非需求误解。

### 证据

- AI HOT `/all` 实测内容（2026-07-11 抓取）：分钟级时间流 + 同事件精选 + 每卡 AI `推荐理由` + 分类筛选（模型/产品/行业/论文/观点）+ RSS + 日报。
- aguhot PRD §1："它不是财经资讯门户"；FR-1："而不是原始文章列表"——定位红线。
- aguhot NFR-3 已要求 AI 生成内容显式标识，AI 分析层有落地基础。

### 用户决策（已在 correct-course 对齐中确认）

| 维度 | 决策 |
|---|---|
| 时间流 | 把首页改成时间流（非新增独立页面、非不做） |
| AI 分析 | 三项全补：列表卡"推荐理由"钩子 + 事件级"为什么重要"AI 深读 + 跨事件 AI 趋势研判 |
| 协作模式 | Incremental 逐条精修（已完成 13 条提案审阅） |

---

## Section 2: Impact Analysis

### Epic Impact

- **Epic 1-3**：全部 done，不回滚。事件详情/证据时间线/市场反应/运营复核机器仍服务于详情页，是时间流的"深读后盾"。
- **Story 1.7（公开热点事件流）**：首页职责被 Epic 4 替换。AC 被 Epic 4 覆盖，但 done 记录保留（不抹写历史）。
- **Story 1.8（详情页）**：增加 AI 深读区块（Epic 5 Story 5.2）。
- **Story 2.3（主题页）/ 2.4（日报）**：AC 追加 AI 趋势研判区块（Epic 5 Story 5.3）。
- **新增 Epic 4：时间流首页与同事件精选**（4 个 story）。
- **新增 Epic 5：AI 分析层**（4 个 story）。
- **Epic 3 搜索**：需覆盖时间流条目（Epic 4 Story 4.4 落地）。
- **重排**：Epic 4 先于 Epic 5（AI 推荐理由挂在时间流卡上，依赖卡片新形态）。

### Artifact Conflicts

**PRD（MAJOR）**
- §1 Vision：与"不是财经资讯门户""先看到最值得看的热点事件"直接冲突 → 已改写（提案 1）。
- §6 Non-Goals：隐含"不做资讯门户"被打开 → 新增两条红线（提案 2）。
- FR-1：与"而不是原始文章列表"直接矛盾 → 改写为时间流（提案 3）。
- FR-3：排序理由在时间序下语义弱化 → 收窄为"同事件精选/置顶理由"（提案 4）。
- §8 Metrics：SM-1 分母变化、SM-C1 受压 → 重设 + 新增 SM-7/SM-8（提案 5）。
- §7 MVP Scope：时间流 + 三项 AI 进 In Scope（提案 6）。
- §12 Open Questions：Q5 时间粒度收口 + 新增 Q6-Q9（提案 7）。
- §10 合规：时间流资讯聚合靠近报备线 → 新增待复核红线 + AI 推荐理由措辞黑名单（提案 8）。

**Architecture**
- AD-3 保留；新增 **AD-3b**（`published_timeline` 读模型，时间序投影 + 同事件折叠）（提案 9）。
- 数据模型新增：`RecommendationReason` / `DeepRead` / `TrendBriefing`，均纳入 `ExplanationVersion` 版本化（AD-5）。
- AI 生成走 worker explain jobs + `LLMAdapter`（AD-4 异步 + AD-7 端口隔离）。
- Capability Map 新增"时间流""AI 分析层"两行。

**UX**
- 新增 **UX-DR4b**（时间流卡组件，区别于热点事件卡）（提案 10）。
- UX-DR5 改写：筛选维度 = 盘前/盘中/盘后 + 概念/行业/个股/公告/研报，URL 可分享。
- UX-DR8 扩展：三种 AI 生成物纳入统一标识，推荐理由标识与事实摘要视觉分离。
- 全部遵守 UX-DR15 反模式（无 carousel、无满屏红绿、无强干扰动画）。

**其他产物**
- `sprint-status.yaml`：新增 epic-4/epic-5 backlog（提案 13）。
- Playwright e2e：首页时间流新场景（Epic 4 落地时补）。
- `deferred-work.md`：记录 pivot 决策与合规复核待办（交接后补）。
- 运营复核：AI 生成内容纳入抽检（Epic 5 Story 5.4），不全自动发布。

### Technical Impact

- 新增 `published_timeline` 读模型 + publish-orchestrator 刷新职责。
- 新增 3 类 BullMQ explain job（推荐理由/深读/研判）。
- 新增 LLMAdapter prompt 策略 + 措辞黑名单校验。
- 首页 IA 变化：左侧导航"首页=热点事件流" → "首页=时间流"。
- 合规报备边界复核（待办，阻塞商业化但非阻塞开发）。

---

## Section 3: Recommended Approach

### 选定路径：Hybrid = Option 1（新增 Epic）+ Option 3（PRD MVP 重审）

既新增 Epic 4/5 落地工作，又重写 PRD 定位层。**分类 Major → 路由 PM/Architect。**

### 理由

- 既是新增工作（epic 4/5），又是定位重写（PRD Vision/Non-Goals/Metrics），单一选项无法覆盖。
- 已完成 story 不回滚——事件详情/证据/市场反应机器仍有价值。
- 三项 AI 能力与时间流首页有明确依赖链（Epic 4 → Epic 5），可顺序落地。

### 工作量评估

- **High**：首页重做 + 3 个 AI 能力 + 新读模型 + 3 类 explain job + 合规复核。
- Epic 4：中高（读模型 + 首页 + 筛选 + 搜索打通，4 story）。
- Epic 5：中高（3 类 AI 生成 + 运营抽检，4 story）。

### 风险评估（High）

| 风险 | 等级 | 缓解 |
|---|---|---|
| 定位转向，放弃"事件解释层"差异化护城河 | High | §6 新增两条红线保留"可追溯 + 运营闸门"底色；fallback 方案（共存）记录于下 |
| 时间流拉高 PV、压低深度阅读 | High | SM-8 + SM-C1 量化对冲；AI 深读/研判守住详情页深度 |
| A 股金融信息服务报备边界 | High | §10 待复核红线：合规结论未出前不商业化、不宣传为投资精选 |
| "推荐理由"措辞在金融语境有诱导风险 | Medium | 纳入措辞黑名单；文案建议用"AI 点评"/"为何关注"等中性词（PM 定稿） |
| AI 生成内容误导 | Medium | Epic 5 Story 5.4 运营抽检 + SM-6 监控 |

### Fallback（共存方案，留档）

若 Major 重规划在 PM/Architect 评审中被否，备选：保留首页优先级热点流不变，另开 `/feed` 时间流页面作为补充入口，AI 推荐理由先在 `/feed` 卡上试水。此方案冲突最小，但用户已明确否决，仅作 fallback。

---

## Section 4: Detailed Change Proposals

以下 13 条提案已在 Incremental 模式下逐条通过用户 Approve。

### PRD 编辑提案（提案 1-8）

#### 提案 1：§1 Vision 重写
- **OLD**: "AGUHOT 是一个 A 股优先的热点发现与解释产品。它不是财经资讯门户…产品的核心价值不是'告诉用户今天发生了很多事'，而是'帮助用户更快判断市场正在交易什么'…先看到最值得看的热点事件…"
- **NEW**: "AGUHOT 是一个 A 股优先的市场动态时间流与 AI 解释产品…以分钟级时间流形态呈现在首页，并对每条动态附以 AI 生成的推荐理由，对关键事件提供 AI 深读与跨事件趋势研判…先在时间流中按时间倒序扫描当日动态与 AI 推荐理由…"
- **Rationale**: 用户决定首页改时间流，原 Vision 两句话与新方向直接冲突；保留"判断市场正在交易什么"核心价值，承载形态改为时间流 + AI 解释；显式保留证据时间线/市场反应/不确定性三件套。

#### 提案 2：§6 Non-Goals 边界调整
- **NEW 新增两条红线**：
  - 不做脱离证据溯源的纯资讯搬运：时间流每条动态必须可回溯到至少一个证据源，AI 推荐理由/深读/研判不得编造无来源结论。
  - 不做无人工闸门的完全自动发布：时间流条目与 AI 生成内容仍受运营复核抽检。
- **Rationale**: 原 Non-Goals 隐含"不做资讯门户"被打开，需显式重述边界；与 AI HOT 拉开差异——形态可借，可信度护城河不能丢。

#### 提案 3：FR-1 首页形态改写
- **OLD**: "默认展示当日热点事件流…按优先级排序…而不是原始文章列表。"
- **NEW**: "默认展示当日市场动态时间流…按时间倒序排列…同一热点事件的多条证据源折叠为'同事件精选'…每条动态至少展示时间戳、来源、标题、一句话摘要、AI 推荐理由（带 AI 标识）、证据源数量…"
- **Rationale**: 直接矛盾需整段改写；保留事件级聚合（同事件精选）避免退化成纯逐条堆叠；类别筛选用 aguhot 域。

#### 提案 4：FR-3 排序理由 → 同事件精选理由
- **OLD**: "展示热点事件的排序理由概览…为何排在当前位置。"
- **NEW**: "展示同事件精选与置顶理由…时间流主排序仍为时间倒序；精选/置顶理由只在偏离时间序时出现。"
- **Rationale**: 时间序无需解释，排序理由收窄为"为何折叠/置顶"；与 AI 推荐理由职责区分（FR-3 解释排列，推荐理由解释值得看）。

#### 提案 5：§8 Success Metrics 重设
- **NEW**: SM-1 改为"时间流首页→详情页点击率"；新增 SM-7（AI 推荐理由覆盖率 >= 95%）、SM-8（时间流 DAU 中位会话时长 >= 5 分钟且深度阅读不降）；SM-C1 强化为"不以时间流 PV/刷新最大化"；SM-6 纳入三种 AI 生成物误导率。
- **Rationale**: 时间流拉高 PV、拉低深度，指标体系必须重设对冲。

#### 提案 6：§7 MVP Scope 调整
- **NEW In Scope**: 时间流（含同事件精选）、AI 推荐理由、AI 深读、AI 趋势研判、搜索覆盖时间流条目、运营复核含 AI 内容抽检。
- §7.2 Out of Scope 不变。

#### 提案 7：§12 Open Questions 收口
- Q5 [已收口]: 时间流按交易日分组，组内分钟级倒序；盘前/盘中/盘后三段标签可筛选；自然日为非交易日 fallback。
- 新增 Q6（折叠阈值）、Q7（AI 生成时机）、Q8（闸门策略）、Q9（合规报备）。

#### 提案 8：§10 Compliance 合规复核标注
- **NEW**: 时间流条目与热点事件均需保留证据源；AI 推荐理由纳入措辞黑名单；新增待复核红线——合规结论未出前时间流不商业化、不宣传为投资精选。

### Architecture 编辑提案（提案 9）

#### 提案 9：新增 AD-3b + 数据模型 + Capability Map
- **AD-3b**: `published_timeline` 读模型，按交易日分组、分钟级倒序、同事件折叠，由 publish-orchestrator 刷新，只读。
- **ER 新增实体**: TIMELINE_ENTRY、RECOMMENDATION_REASON、DEEP_READ、TREND_BRIEFING（后三者纳入 EXPLANATION_VERSION 版本化）。
- **Capability Map 新增**: 时间流行、AI 分析层行。
- **Deferred 新增**: 折叠阈值数值、AI 模型/prompt 策略（待 Epic 5 story 化时定）。

### UX 编辑提案（提案 10）

#### 提案 10：UX-DR4b + UX-DR5 改写 + UX-DR8 扩展
- **UX-DR4b**: 时间流卡组件，时间戳/来源/标题/摘要/AI 推荐理由钩子为核心阅读顺序；同事件精选可展开；整卡点击进详情；不得用 carousel。
- **UX-DR5**: 筛选维度 = 时间范围（盘前/盘中/盘后/全天）+ 类别（概念/行业/个股/公告/研报）；URL 可分享。
- **UX-DR8**: 三种 AI 生成物纳入统一标识；推荐理由标识紧邻文案，与事实摘要视觉分离。

### Epic 编辑提案（提案 11-12）

#### 提案 11：新增 Epic 4 — 时间流首页与同事件精选
- Story 4.1 时间流读模型与发布刷新
- Story 4.2 时间流首页与时间流卡组件
- Story 4.3 盘前/盘中/盘后与类别筛选
- Story 4.4 时间流条目与搜索打通
- **FRs**: FR-1(改), FR-2, FR-3(改), FR-12

#### 提案 12：新增 Epic 5 — AI 分析层
- Story 5.1 列表卡 AI 推荐理由生成（上限 40 字，黑名单约束，覆盖率 >= 95%）
- Story 5.2 事件级 AI 深读（影响面/受益方/风险点三段，版本化）
- Story 5.3 日报与主题页 AI 趋势研判（标注依据事件集合，版本化）
- Story 5.4 AI 生成内容运营抽检（SM-6 监控）
- **FRs**: FR-1(推荐理由), FR-4(AI 深读), FR-10(研判), FR-11(研判), NFR-3
- **依赖**: Epic 4 + 现有 review-workflow

### sprint-status 编辑提案（提案 13）

#### 提案 13：新增 Epic 4/5 backlog 条目
- epic-4 + 4 个 story（backlog）+ retrospective(optional)
- epic-5 + 4 个 story（backlog）+ retrospective(optional)
- last_updated 更新为本次时间。
- 不删除 1-7 done 记录；其 AC 被 Epic 4 覆盖的关系记录于本提案。

---

## Section 5: Implementation Handoff

### 变更范围分类：Major

路由：**Product Manager / Solution Architect**。

### 交接对象与职责

| 角色 | 职责 |
|---|---|
| **PM** | 1) 审批 PRD Vision/Non-Goals/Metrics 改写（提案 1-8）；2) 收口 §12 新增 Q6-Q9（折叠阈值、AI 生成时机、闸门策略）；3) 文案定稿——"推荐理由"在金融语境的中性化措辞（建议"AI 点评"/"为何关注"）；4) 合规报备复核启动（§10 待复核红线）。 |
| **Architect** | 1) 审批 AD-3b 与 `published_timeline` 读模型设计；2) 界定时间流读模型拥有权（event-assembly vs source-ingest）；3) 三类 explain job 与 LLMAdapter prompt 架构；4) 数据模型（RecommendationReason/DeepRead/TrendBriefing）落入 Prisma schema。 |
| **Developer** | Epic 4/5 story 实现（PM/Architect 审批后），沿用现有 modular monolith + BullMQ + AD-1~AD-8 约束。 |

### 成功标准

- Epic 4 完成：首页展示时间流，同事件精选折叠生效，盘前/盘中/盘后 + 类别筛选可用，搜索覆盖时间流条目。
- Epic 5 完成：AI 推荐理由覆盖率 >= 95%（SM-7），AI 深读与趋势研判上线且带标识，运营抽检通路可用（SM-6 < 10%）。
- 合规：§10 待复核红线在时间流商业化前出具结论。
- 反指标：SM-8 守住深度阅读不降，SM-C1 时间流 PV 不被单追。

### 阻塞项（交接后须先解）

1. §12 Q6-Q9 四个新 Open Questions（PM/Architect）。
2. §10 合规报备复核（PM，阻塞商业化非阻塞开发）。
3. "推荐理由"措辞中性化定稿（PM 文案）。

---

## 附录：决策记录

- **用户决策来源**：correct-course 对齐问答（2026-07-11），用户明确选择"把首页改成时间流"+ 三项 AI 分析全补 + Incremental 模式。
- **Fallback 否决记录**：共存方案（保留首页 + 新增 /feed）被用户否决，仅作 Major 评审失败时备选。
- **13 条提案审阅**：全部 Approve，无 Edit/Skip。
- **lazy senior dev 风险提示**（已向用户明示）：此路径把 aguhot 从"事件级解释层"转向"时间流 + AI 点评"，基本等于做 A 股版 AI HOT；整个 PRD/brief/architecture 围绕"不做原始资讯流"构建的重机器（evidence-timeline/market-reaction/operator-review）在新定位下价值重心转移。用户已知悉并坚持决策。

## 附录2：PM/Architect 评审与修订应用（2026-07-11）

### 评审执行
用本地 `claude -p` headless 调起 bmad-agent-pm（John）与 bmad-agent-architect（Winston）两个 BMAD persona 技能并行评审，均 **Approve-with-conditions**。Architect 做代码级评审（file:line 证据），PM 做法规级合规核实。

### 架构阻塞（Architect，已应用）
- **A1 事务原子性**：`published_timeline` 刷新改为 `decideReview` 事务内增量 upsert/delete（method A）+ 周期性自愈 job；否决原独立 BullMQ job 方案（违背闸门原子范式）。
- **A2 版本化归属**：三实体（RecommendationReason/DeepRead/TrendBriefing）各自独立 append-only 表，不复用 ExplanationVersion（固定三段式 + NOT NULL hotEventId 不适用）；归 explanation / digest-theme-linking 模块。
- **A3 LLMAdapter 端口**：codebase 不存在，Story 5.1 首个 dev 任务 = 建端口骨架（照抄 DigestAdapter）。
- **A4 spec-4-1 Code Map 补齐**：listPublishedTimeline 读 fn、barrel re-export、session_tag/trade_date 派生纯函数、review-workflow 触发点、复合索引。
- **A5 重投影触发链**：method A 落地后，reason append 触发 per-hotEvent timeline 增量重投影。
- **折叠阈值归属**：归 event-assembly 模块配置（非全局 env）。

### PM 阻塞（已应用）
- **P1 §10 三合规面**：算法推荐备案 + AI 隐式元数据标识（《标识办法》2025.9.1）+ 金融信息服务管理；写入 §10/NFR-3/NFR-7，进 Epic 5 AC。
- **P2 SM-8 重定义**：深度阅读占比（触达证据时间线或 AI 深读 / 时间流 DAU）+ 基线冻结；5 分钟会话降为 secondary。
- **P3 NFR-7 AI Provenance**：每版 model id + prompt 版本 + 时间戳 + 留存期。
- **P4 视觉权重**：AI 解读 <= 事实摘要（§10 + UX-DR8）。
- **P5 文案定稿**："推荐理由" → "AI 解读"（全局改名）；黑名单扩展六类。
- **P6 趋势研判拆分**：Story 5.3 → 5.3a 日报 / 5.3b 主题页（延后 v1.1）。
- **P7 Q8/Q9 收口**：分层闸门 + 假设三合规义务均触发（阻塞 GA 不阻塞 dev）。
- **Vision 机制缺口**：首页加"今日重点/市场主线"置顶带 + 锚定句。

### 待 PM 执行（非文件编辑）
- SM-8 基线冻结（Epic 4 dev 启动前）。
- 启动外部律所书面意见（§10 三合规面，2 周窗口）。
- 算法推荐备案实操（GA 前）。

### 源文件已同步
prd.md / ARCHITECTURE-SPINE.md / epics.md / DESIGN.md / spec-4-1 / epic-4-context / epic-5-context / sprint-status.yaml 全部按评审修订同步。本 proposal 作为历史快照保留原 13 条提案措辞，修订以本附录为准。
