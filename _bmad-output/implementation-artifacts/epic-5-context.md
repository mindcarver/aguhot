# Epic 5 Context: AI 分析层

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

在时间流、详情页、日报页三层分别落地三类 AI 生成内容：列表卡的 `AI 解读`（一句话钩子）、详情页的 `AI 深读`（事件级"为什么重要"三段）、日报页的 `趋势研判`（跨事件主线演化）。所有 AI 生成内容必须带显式+隐式标识、版本化可追溯、受运营抽检，使误导性内容不长期滞留公开页。本 epic 是产品差异化护城河的解释层落地，但产品定位严格保持"信息聚合与事件解释"，不得滑向荐股/投顾边界。

## Stories

- Story 5.1: 列表卡 AI 解读生成
- Story 5.2: 事件级 AI 深读
- Story 5.3: 日报页 AI 趋势研判
- Story 5.3b: 主题页 AI 趋势研判（延后 v1.1，MVP 不交付）
- Story 5.4: AI 生成内容运营抽检

## Requirements & Constraints

- **三类 AI 生成物**：`AI 解读`（列表卡，上限 40 字一句话）、`AI 深读`（详情页"为什么重要"区块下的影响面/受益方/风险点三段）、`趋势研判`（日报跨事件段落，标注其依据的事件集合，不伪造因果）。
- **标识合规（NFR-3）**：所有 AI 生成内容必须同时做显式标识（面向用户，复用统一 `{components.ai-label}`）和隐式元数据标识（面向审计/监管，含提供者名称/编码，对齐《人工智能生成合成内容标识办法》2025.9.1）。
- **溯源与不可编造（NFR-2）**：深读与研判内容必须与对应证据时间线/已发布事件集一致，不得脱离来源独立编造结论。
- **AI Provenance（NFR-7）**：每版 AI 内容必须保留 model id + prompt 版本 + 生成时间戳 + 留存期，审计可取。
- **措辞黑名单（合规红线）**：`AI 解读` 生成受正向可枚举常量约束，覆盖六类禁词：动作类（买/卖/增持/减持/建仓/清仓/加仓/减仓）、收益预测类（必涨/必跌/稳赚/暴涨/翻倍/连板）、操纵框架类（主力/庄家/拉升/出货/洗盘）、推荐强度类（强烈推荐/首推/首选/重点推荐）、时点建议类（抄底/逃顶/止损位/目标价区间/仓位）、过度确定类（必将/确定上涨/一定）。命中即拒绝重试或落缺失态。
- **覆盖率（SM-7）**：时间流每条动态的 `AI 解读` 覆盖率 >= 95%，剩余允许缺失态，不得留空。
- **误导率（SM-6）**：运营复核后被判定为"解释明显误导"的公开 AI 内容占比 < 10%。
- **发布可见性**：AI 内容随事件 `published` 自动上线（候选阶段即生成供运营复核审），但纳入强制抽检；高风险子集（个股-facing、研报/公告类、含收益/目标暗示）需发布前运营签核。
- **视觉权重约束**：`AI 解读` 视觉权重 <= 事实摘要，不得在卡片上比事实标题/摘要更突出（等同编辑背书/投资指向风险）。
- **范围排除（V1）**：主题页 AI `趋势研判` 出 MVP 范围（延后 v1.1）；`重生成` action 出 V1 范围（仅 suppress/takedown，待真实 LLM provider 落地后另开 story）；研判（TrendBriefing）V1 不可标记/下线（运营台仅只读 browse）。

## Technical Decisions

- **LLMAdapter 端口须先落地**：codebase 现状无 `LLMAdapter`（仅 SourceAdapter/MarketDataAdapter/AssociationAdapter/ThemeAdapter/DigestAdapter 就位）。Story 5.1 首个任务 = 建端口骨架（接口 + Stub + worker resolve），照抄 DigestAdapter 先例；真实 LLM provider 注入点留好，story 内可用 Stub 跑通生成链。领域模块与发布模块不得直接 import 第三方 LLM SDK（AD-7）。
- **全异步生成（AD-4）**：三类生成物一律走 BullMQ explain job，Web 请求路径不得同步等待 LLM 返回。AI 生成时机：`AI 解读`/`AI 深读` 在 event-assembly 聚类完成、候选 HotEvent 生成后即生成；`趋势研判` 在日报生成 job 时生成（依赖多个已发布 HotEvent）。
- **数据模型 = 三实体各自独立 append-only 表（AD-5）**：`RecommendationReason`（AI 解读，归 explanation 模块）、`DeepRead`（深读，归 explanation 模块）、`TrendBriefing`（研判，归 digest/theme-linking 模块）。**不复用** `ExplanationVersion` 表（其固定三段式 schema + NOT NULL hotEventId 不适用）。
- **公开侧只读发布态读模型（AD-3/AD-3b）**：AI 内容随事件 `publication_status = published` 后经 `publish-orchestrator` 投影进 `published_timeline` / `published_hot_events` 等读模型；公开站不直接读原始生成表。
- **运营抽检下线 = 外科式（Story 5.4 V1 裁决）**：扩 review-workflow 加新 outcome `suppress_ai_content`（不新增 publication_status，不改 `decideReview` 的 HotEvent 状态机），事务内只重投影该条 AI 内容——reason 置 null（`refreshPublishedTimelineForEvent`）/ deepread 删行（`refreshPublishedReadModel`）。**不**核平整个事件。审计走既有 append-only `ReviewDecision`（note 标注 misleading + target_type/target_id）。
- **SM-6 误导率读数口径（Story 5.4）**：误导标记数（`ReviewDecision` where note misleading, target_type in {reason,deepread}）/ AI 内容总数（已生成的 reason+deepread 行数），**聚合分母**（reason+deepread 合计，**不含研判**），滚动 7 日窗。查 `ReviewDecision` 审计表算。
- **命名/格式约定**：主键 UUIDv7；时间存 UTC；公开 API 走 `data/meta/error` 三段式；每个 job 带 `trace_id`；领域事件过去式 PascalCase。
- **运行时栈固定**：Node.js 24.18 + TypeScript 5.9 + Next.js 16 App Router + BullMQ 5.79 + PostgreSQL 18 + Prisma 7.7。Worker 进程承担所有 explain job，Web 进程只读。

## UX & Interaction Patterns

- **统一 AI 标识组件（UX-DR8）**：所有 AI 生成内容（`AI 解读`/`AI 深读`/`趋势研判`/摘要/日报）在公开页与运营侧共用一套 `{components.ai-label}` 规则，避免同页出现不同说法。标识紧邻其文案，不得与事实性摘要视觉混淆，视觉权重 <= 事实摘要。
- **AI 标识低调**：标识只表达"信息来源性质"，不能表达"更高级"，禁止用夸张高亮把"AI 解读"做成营销卖点。
- **时间流卡阅读顺序（UX-DR4b）**：时间戳 > 来源 > 标题 > 一句话摘要 > `AI 解读` 钩子 > 证据源数。AI 解读紧邻 `{components.ai-label}`。
- **详情页分区（UX-DR11）**：事实、解释、不确定性三类内容必须视觉分区，避免混成一个信息块；`AI 深读` 落在"为什么重要"区块下，与事实摘要分块。
- **缺失态而非留空**：生成失败时卡片/区块显示缺失态（对齐 NFR-5 graceful degradation），不得留空误导用户。
- **运营复核状态标记（UX-DR14）**：抽检台明确区分待复核/已复核/需下线/已下线，与公开展示状态一致。
- **反模式约束（UX-DR15）**：禁止横向 carousel 承载核心热点、禁止强干扰动画、禁止交易软件式满屏红绿。

## Cross-Story Dependencies

- **Epic 4 → Epic 5 顺序依赖**：`AI 解读` 挂在时间流卡（Epic 4 新形态）上，必须 Epic 4 先落地；sprint 重排已确认此顺序。
- **5.1 解锁 5.2/5.3**：5.1 落地 `LLMAdapter` 端口骨架，是 5.2（深读）与 5.3（研判）共享的前置依赖；5.2/5.3 复用同一端口与 explain job 范式。
- **5.3 → 5.3b**：主题页研判（5.3b）延后 v1.1，启动前置 = §12 Q3 主题页生成方式定案 + 日报研判 SM-6 误导率连续 2 周达标。
- **5.4 依赖 5.1/5.2 已上线**：抽检（Story 5.4）的对象是已生成的 reason/deepread；研判 V1 仅 browse 不可标记（分母/分子均不含 trend briefing）。
- **依赖 Epic 1/2 已建模块**：复用 `event-assembly`（候选聚类）、`review-workflow`（ReviewDecision 审计）、`publish-orchestrator`（读模型刷新）、`source-ingest`（证据源）等既有模块边界，不新建跨域写拥有者。
