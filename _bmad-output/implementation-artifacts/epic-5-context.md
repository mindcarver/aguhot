# Epic 5 Context: AI 分析层

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

为时间流卡、事件详情页、日报/主题页分别落地三类 AI 生成内容——`AI 解读`（一句话卡面解读）、`AI 深读`（详情页深读）、`趋势研判`（跨事件研判），三者统一带 AI 标识、可追溯、受运营抽检。Epic 5 同时引入 `LLMAdapter` 端口（六边形适配器），让真实 LLM provider 可插拔、Stub 可跑通生成链，为后续 AI 能力建立骨架。

## Stories

- Story 5.1: 列表卡 AI 解读生成（首个 dev 任务 = 落地 LLMAdapter 端口骨架）
- Story 5.2: 事件级 AI 深读
- Story 5.3: 日报页 AI 趋势研判
- Story 5.3b: 主题页 AI 趋势研判（延后 v1.1）
- Story 5.4: AI 生成内容运营抽检

## Requirements & Constraints

**三类内容范围**
- AI 解读：每条时间流条目挂一句话解读（上限 40 字），用于不点开即可判断动态价值。
- AI 深读：详情页"为什么重要"区块下生成（影响面/受益方/风险点三段），快速理解事件影响。
- 趋势研判：日报页生成跨事件研判段落（MVP 仅日报；主题页研判延后 v1.1，需日报 SM-6 连续 2 周达标且主题页生成方式定案后启动）。

**标识与合规（NFR-3）**
- 所有 AI 生成内容必须同时具备：显式标识（用户可见的 `AiLabel`）+ 隐式元数据标识（provider 名/码，供审计/监管检索）。
- 对齐《人工智能生成合成内容标识办法》（2025.9.1 生效）。

**版本与溯源（NFR-7 / AD-5 / NFR-2）**
- 每个 AI 内容版本 append-only，保留 model id + prompt 版本 + 生成时间戳 + 保留期限，审计可查。
- AI 内容不得编造无来源结论，必须与证据时间线一致；高不确定性事件须显示"未确认"态，不得强填确定性结论。
- 下线/重生成/修订一律写入新版本或新决策，禁止原地覆盖。

**措辞黑名单（PRD §10）**
- 以正向可枚举常量承载（非自由文本规则），覆盖六类：动作类（买入/卖出/建仓等）、收益预测类（必涨/翻倍等）、操纵框架类（主力/庄家/洗盘等）、推荐强度类（强烈推荐/首推等）、时点建议类（抄底/逃顶/目标价区间等）、过度确定类（必将/一定等）。
- 命中即拒绝→重试，或落缺失态。生成时 fail-fast 校验（参照 digest 的 noInvestAdvice 关键词检查先例）。
- AI 解读视觉权重须 <= 事实摘要，不得比事实标题/摘要更醒目。

**发布与可见性（AD-6 发布门）**
- AI 解读/深读在事件聚合产出候选 HotEvent 后即生成（候选阶段），供运营复核，但仅在 `publication_status = published` 后对外可见。
- 高风险子集（个股向、研报/公告类、暗示收益/目标的）须发布前运营签字；低风险由正向白名单定义，歧义默认拒绝。
- 趋势研判随日报/主题页生成 job 发布。

**监控指标**
- SM-7：AI 解读覆盖率 >= 95%（剩余仅可为显式缺失态，绝不留空）。
- SM-6：误导占比 < 10%（含解读/深读/研判，运营复核后判定）。
- 合规三项（算法推荐备案 / AI 标识 / 金融信息服务备案）阻断 GA 与商业化但不阻断开发；算法备案 + 隐式标识须进入 Epic 5 验收。

## Technical Decisions

**LLMAdapter 端口（Story 5.1 首个任务）**
- 端口尚未实现（codebase 现状：仅 5 端口就位，`explain-service.ts` 明文 deferred）。照抄 `DigestAdapter` 先例：`types.ts`（领域类型 + 端口接口）+ `*-adapter.ts`（薄 re-export，注释说明 resolve-at-call-site 与诚实降级契约）+ `stub-*-adapter.ts`（TEST-ONLY 确定性 Stub，`apps/worker` 不得 import）+ service（`adapter === undefined` 时返回 null、不写库）+ `index.ts` barrel。
- 真实 LLM provider 注入点留好；本 story 用 Stub 跑通生成链，provider 落地仅改 worker 一行 resolve。
- AD-7：领域/发布模块禁止直接 import 第三方 LLM SDK，provider 切换只发生在 adapter 层与 worker 装配层。

**数据模型（各自独立 append-only 表，不复用 ExplanationVersion）**
- `RecommendationReason`（AI 解读）→ `explanation` 模块，per-HotEvent，单行非三段。
- `DeepRead`（AI 深读）→ `explanation` 模块，per-HotEvent，三段（影响面/受益方/风险点）。
- `TrendBriefing`（趋势研判）→ `digest`/`theme-linking` 模块，按 coverageDate/Theme 键，多对多关联所依据的 HotEvent 集合（`TREND_BRIEFING }o--o{ HOT_EVENT : based_on`）。
- 三实体独立表的理由：`ExplanationVersion` 固定三段式 schema + NOT NULL `hotEventId`，不适配单行解读与按日期/主题键的研判。
- `source` 枚举（`template`/`ai`/`human`）承载溯源；AI 行的 `model id`/`prompt 版本` 为 story-time Prisma 新增列（架构 spine 未列字段，属 flagged Architect 任务）。

**Worker / Job（AD-4）**
- 所有 LLM 调用走 BullMQ 异步 job；Web 请求路径不得同步等待 LLM。
- Queue+Worker 同文件、lazy Queue 单例、`removeOnComplete:100`/`removeOnFail:500`、worker 动态 `await import("@aguhot/core")`。
- 承载 job：`explain-queue`（候选 HotEvent 无 ExplanationVersion 者处理，AI 深读挂这里）、`daily-digest-queue`（日报生成，趋势研判挂这里）。
- Job 幂等、按条隔离失败（单条失败不中止整批）。

**模块边界（无独立 ai-analysis 模块）**
- AI 内容按写所有权分布：解读/深读归 `explanation`，研判归 `digest`/`theme-linking`。
- AD-2：模块不得直接更新他模块聚合根，跨边界走 command/queue。
- 监控通过查询 append-only 审计表实现（SM-6 查 ReviewDecision，SM-7 查 published 读模型），无独立 telemetry 子系统。

**Timeline 重投影**
- AI 解读 append 到 HotEvent 后，须触发该 hotEventId 的 `published_timeline` 增量重投影（在 reason append job 内调 `refreshPublishedTimelineForEvent`，挂入事务或紧随其后 enqueue），否则首页 AI 解读 stale。

## UX & Interaction Patterns

**AI 标识组件（统一）**
- `AiLabel`：背景 `accent-warm`（#B86633 暖橙），前景 `accent-warm-foreground`，全圆角药丸；`accent-warm` 仅限 AI 标识与解读层强调，禁用于按钮/通用强调。
- 语义：仅表达"信息来源性质"，不得暗示"更权威/更高级"；不得把"AI 解读"做成营销卖点。
- 公开页与运营台标识规则一致。

**时间流卡（AI 解读）**
- 阅读序：时间戳 → 来源 → 标题 → 一句话摘要 → AI 解读 hook → 证据源数。
- AI 解读须与事实摘要视觉分区，不得合并为同一段落；卡片纵向堆叠，禁横向轮播。
- 卡片的 AI 解读 slot 由 Epic 4.2 渲染，5.1 填充内容。

**详情页（AI 深读）**
- 首屏结构：发生了什么 / 为什么重要 / 当前仍不确定什么；AI 深读落在"为什么重要"下，三段标注（影响面/受益方/风险点）。
- 证据时间线行每行可展开原文摘要 + 跳转源；核心解读/时间线不得进抽屉/弹窗。

**缺失态与降级**
- 解读缺失：显式缺失态 + 最后更新时间，绝不留空。
- 证据不足：保留事件摘要，标"来源不足/仍待确认"。
- 市场信号缺失：在区块内显示缺失说明，不让区块消失。
- 日报未生成：显示生成时间 + 覆盖范围，不空白。

**运营复核台（Story 5.4）**
- 内部入口，按 AI 内容类型（解读/深读/研判）筛选；可标记误导→触发下线或重生成；标记态（待复核/已复核/需下线）直接约束公开可见性。
- 复核动作走 `review-workflow` → `publication_status`，禁止旁路直写 published 读模型。
- 具体筛选/标记/重生成交互细节 UX 尚未设计，story-time 细化。

**语气基调**
- 克制、可证、不煽动。用"AI 生成摘要，已提供来源"/"为什么重要"/"当前仍不确定"，禁用"重磅利好"/"即将爆发"/"主力已进场"等。AI 文案长度受限（SM-C3）：解读一句话，深读/研判有上限。

## Cross-Story Dependencies

- Story 5.1 建 LLMAdapter 端口骨架，是 5.2/5.3 的前置（三者共用端口 + Stub + worker resolve 模式）。
- 5.2/5.3 的内容生成挂入既有 `explain-queue` / `daily-digest-queue`，依赖候选 HotEvent 已发布（AD-6 发布门）。
- 5.4 抽检依赖 5.1–5.3 内容已上线 + review-workflow 模块（复用 Epic 1 的 FR-15，不引入并行复核路径）；误导判定产出 ReviewDecision，反馈到 SM-6。
- 5.3b（主题页研判）阻塞于 5.3 SM-6 连续 2 周达标 + §12 Q3 主题页生成方式定案。
- 对外依赖：AI 解读 slot 由 Epic 4.2 渲染；深读挂详情页（Epic 1）；研判挂日报/主题页（Epic 2）。
- 算法推荐备案 + 隐式标识须进 Epic 5 验收（合规门），阻断 GA。
