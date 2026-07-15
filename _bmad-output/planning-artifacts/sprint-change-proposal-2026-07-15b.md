---
title: "Sprint Change Proposal — A股大跌日历与历史回顾（Epic 8）"
date: 2026-07-15
scope: Major
status: approved (2026-07-15, Carver)
trigger: Carver 提出"在左侧加入 A股大跌日历"，希望看大跌之后的表现、大跌涉及哪些板块，以及数据从哪来
route_to: Product Manager / Solution Architect（点评架构段）→ Developer（执行）
mode: Incremental（5 条提案逐条 a/e/s 通过）
decisions_locked:
  - 大跌定义: 三大宽基（上证综指 / 深证成指 / 创业板指）任一日跌幅 ≤ CRASH_THRESHOLD（默认 -2%，运营可调）
  - 数据源: AkShare + Python sidecar（apps/market-sidecar），Node 侧只读库，不直接调 AkShare
  - 形态: 独立公开页 /crash-calendar + 左侧栏 SideNav 入口（220px 左栏不动）
  - 排期: Epic 8 进 v1.1，不塞 V1 GA（行情数据为全新品类 + §12 Q9 合规未清）
  - 措辞护栏: "大跌后表现"为历史 T+N 实际收益统计，显式标注"非预测、非投资建议"，受 §10 黑名单约束
  - YAGNI: 仅做三大宽基 + 申万一级日线；不为个股/分钟级先建表
---

# Sprint Change Proposal — A股大跌日历与历史回顾

## Section 1 — Issue Summary（问题摘要）

### 触发
Carver 在 sprint 执行中提出：**在左侧加入一个 A股大跌日历**，并明确三个诉求——
1. 大跌之后市场的一些表现（前瞻）；
2. 大跌又是哪些板块（领跌板块）；
3. 这些数据哪里能搞到（数据源）。

### 核心问题（精确陈述）
**当前产品只有"per-HotEvent 单交易时段市场反应快照"，没有任何历史行情日线序列。** "大跌日历 / 大跌后表现 / 领跌板块"是三个都依赖**历史指数 + 行业日线序列**的能力，而该数据品类在库里完全不存在。代码证据：

| 环节 | 文件:行 | 现状 |
|---|---|---|
| 市场反应模型 | `packages/core/prisma/schema.prisma:498` | `MarketReactionSnapshot` 是 per-HotEvent 单时段快照（一个涨跌 tone + 涨停家数），不是历史序列 |
| 生产产出 | 同上注释 | "V1 prod: adapter resolves to none → never produced"——生产环境从未产出 |
| 行情适配器 | `packages/core/src/modules/market-reaction/stub-adapter.ts` | `MarketDataAdapter` 是 stub |
| 历史日线表 | 全库 grep | 无 `IndexDailyBar` / `SectorDailyBar` / 任何宽基或行业日线表 |
| 左栏布局 | `apps/web/app/(public)/_components/side-nav.tsx` | 220px sticky 左栏已存在（Epic 6），但放不下复合日历控件 |

全仓 `grep`：架构 spine 显式 defer 了"具体财经数据源采购名单"（Deferred 段），`MarketDataAdapter` 端口就位但未实现。

### 关键证据 / 约束
1. **本功能与产品定位不冲突，反而是差异化护城河的延伸**：PRD §4.3「市场反应与关联展示」+ §6「证据时间线 / 市场反应信号 / 运营复核 三件套」明确把"市场反应"列为差异化护城河。大跌日历把市场反应从"单点快照"升级为"历史序列回顾"，是 PRD 已有方向的落地，不是新方向。
2. **不进入交易/策略边界**（PRD §6 Non-Goals）：大跌后表现是历史 T+N 实际收益的**统计回顾**，不是预测、不是信号推送、不是抄底建议。措辞护栏见 §4。
3. **数据源是 Python 生态**：成熟免费源（AkShare / baostock / Tushare）均为 Python。本项目是纯 Node/TS。引入行情采集 = 架构层引入 Python 第三运行时（AD-7 决策点）。
4. **合规面**：行情数据采集 + 统计回顾仍属金融信息服务范畴，进 §12 Q9 既定合规复核队列；"大跌后表现"若被解读为"反弹规律暗示"有 advisory 风险，须措辞护栏。

### 数据源调研（Carver 直接提问项）

| 来源 | 覆盖 | 成本 | 栈适配 |
|---|---|---|---|
| **AkShare（选定）** | 上证/沪深300/创业板日线 + 申万一级行业日线 + 个股 | 免费、免 token | 需 Python sidecar |
| baostock | 宽基 K 线 + `query_sw_industry_daily` | 免费 | 需 Python sidecar |
| Tushare Pro | 指数日线 + 申万行业 + 积分制 | 免费 token 但额度上限 | 需 Python sidecar |
| 东方财富/新浪网页抓取 | 同上 | 免费 | Node 可抓但易被封、合规灰 |
| 自建 RSSHub | 无行情日线插件 | 不适用 | 不适合 |

**选定 AkShare + Python sidecar**：免费免 token、覆盖最全；代价是新增第三运行时。

---

## Section 2 — Impact Analysis（影响分析）

### 2.1 Epic 影响

| 现有 Epic | 影响 |
|---|---|
| Epic 2（主线联动/日报） | 轻改：Story 2.1 市场反应信号目前是 per-event tone；大跌日历把"市场反应"从单点升级为历史序列。不 invalidate，是补充。 |
| Epic 7（saliency 打分） | 无破坏；7.4 已想回灌 market reaction magnitude，大跌数据可作为更稳定来源，V1 不强耦合。 |
| Epic 1/3/4/5/6 | 不受影响。 |
| **新增 Epic 8** | 大跌日历主体工作（见 §4）。 |

### 2.2 Story 影响（新 Epic 8 全部为新增 story）

| Story | 标题 | 说明 |
|---|---|---|
| 8.1 | 行情历史日线采集 sidecar（Python + AkShare） | 三大宽基 + 申万一级日线 → `index_daily_bars` / `sector_daily_bars`；仅"翻译成行"写权限 |
| 8.2 | 大跌日判定 + 前瞻收益计算 | `crash-review` 模块写拥有 `CrashDay`；T+1/T+5/T+20 实际收益；阈值可调 |
| 8.3 | 大跌日历公开页 /crash-calendar | 日历视图 + 领跌板块榜 + 前瞻收益表；复用 published_* 范式 |
| 8.4 | 左栏 SideNav 入口 + 路由 | side-nav CONTENT 加项；220px 不动 |
| 8.5（deferred v1.2） | 大跌日 ↔ 当日 HotEvent 关联 | 复用 Epic 7 saliency；v1.1 不做 |

### 2.3 PRD 冲突
- 不冲突核心定位，落地 PRD §4.3「市场反应」已有方向。
- 新增 FR-16（序列级市场反应 + 大跌回顾）。
- §6 Non-Goals 护栏：大跌后表现须措辞约束（非预测、非建议、受 §10 黑名单）。
- §7.1 In Scope 不动（进 v1.1，不塞 MVP）。
- §11.2 Top-Level Surfaces 新增大跌日历页。
- §12 新增 Q10（行情数据源合规边界）。

### 2.4 架构冲突（重大）
- spine 是 Node 双运行时（web + worker）。Python sidecar = **第三运行时**。
- Stack 表新增 Python 3.12 + AkShare。
- AD-7 端口说明扩展：行情序列由 sidecar 写库，Node 侧只读。
- AD-1 约束：sidecar 是运行时不是微服务，不拥有领域聚合根，复刻 RSSHub 自建采集器既有先例。
- Capability map 新增"大跌日历与历史回顾"行。
- 新增 Prisma 表：`IndexDailyBar` / `SectorDailyBar` / `CrashDay` + 公开读模型 `published_crash_days`。

### 2.5 UI/UX 影响
- 左栏 220px 不动，仅 side-nav CONTENT 加导航项。
- 新增 `/crash-calendar` 路由 + crash-calendar 页组件。
- 复用 `reaction-chip-down` 着色领跌板块（不新增 token），守住"红绿只表达市场语义"红线。

### 2.6 其他制品
- sprint-status.yaml：补 Epic 8 backlog 条目 + 合规 action item。
- 既存漂移 flag：sprint-status.yaml 缺 Epic 7 追踪（2026-07-15 saliency proposal 遗留），非本次范围，建议 PM 补登。

---

## Section 3 — Recommended Approach（推荐路径）

**选定路径：Hybrid = Direct Adjustment（新 Epic 8）+ 排期降级（v1.1）**

- Option 1 Direct Adjustment：Viable，effort High / risk Medium。
- Option 2 Rollback：不适用（无已完成工作要回滚）。
- Option 3 MVP Review：不缩减 MVP，是增量；但排 v1.1 避免拖累 V1 GA。

**理由：**
1. 行情数据是全新品类 + Python 运行时是架构级引入，不应在 V1 合规面（§12 Q9）未清时塞进 GA。
2. 8.1（sidecar 回填历史）可与 V1 收尾并行，不阻塞 GA。
3. 与既有 RSSHub 自建采集器先例一致，不发明新模式，控制架构复杂度。

**Scope 分类：Major**（新数据品类 + 新运行时 + 新公开页 + 新读模型）。
**路由：Product Manager / Solution Architect** 点评架构段（spine 改动 B/C/D）→ **Developer** 执行。

**前置阻塞：** §12 Q10 合规复核未清前，`/crash-calendar` 不对外公开（dev 内测形态，同 V1 既定策略）。

**Success criteria：**
- 8.1：近 3 年三大宽基 + 申万一级日线入库，source 字段可追溯，缺失明确标记。
- 8.2：阈值不写死；前瞻收益为历史实际值非预测；缺失态不编造（NFR-5）。
- 8.3：三段视图齐备 +「历史统计，非预测」标注 + 空状态；移动端可用（NFR-4）。
- 8.4：桌面/移动端导航一致；active 态正确。

---

## Section 4 — Detailed Change Proposals（已逐条 a/e/s 通过）

### 提案 #1 — PRD
- §4.3 新增 **FR-16: 提供A股大跌日历与大跌后历史回顾**（大跌定义三大宽基阈值可调；领跌板块 Top-N；T+1/T+5/T+20 实际收益历史分布；NFR-2/NFR-5 可追溯不编造；显式「非预测非建议」+ §10 黑名单）。
- §11.2 新增表面：大跌日历页。
- §12 新增 Q10（行情数据源 + 合规边界，open）。
- §7.1 In Scope 不动（进 v1.1）。

### 提案 #2 — 架构 spine
- Stack 表新增 Python 3.12 LTS + AkShare 1.x。
- Design Paradigm 段补 `apps/market-sidecar`（Python）只写行情日线、不参与领域规则。
- AD-7 端口扩展：行情序列由 sidecar 写 `index_daily_bars` / `sector_daily_bars`，Node 只读；sidecar 受 AD-1 约束（第三运行时，复刻 RSSHub 先例）。
- Capability map 新增"大跌日历与历史回顾"行（governed by AD-2/AD-3/AD-4/AD-7）。
- 新增表：`IndexDailyBar` / `SectorDailyBar`（sidecar 写）/ `CrashDay`（crash-review 写拥有）/ `published_crash_days`（publish-orchestrator 投影）。`CrashDay` 用 Json 列（只读统计投影，无跨行查询需求）。

### 提案 #3 — epics.md
- Epic List 表新增 Epic 8 行（backlog / v1.1）。
- Epic 8 五个 story（8.1–8.5，8.5 deferred v1.2）。
- 观测：新增 SM-C4 对冲（不以"大跌后涨幅最大化"为展示目标）。
- 阈值 `CRASH_THRESHOLD` 走配置项不写死（对齐 `TIMELINE_FOLD_THRESHOLD` 范式）。

### 提案 #4 — UX DESIGN + side-nav
- DESIGN.md 新增 crash-calendar 组件描述（无边框纵栏 + 领跌板块 reaction-chip-down + 前瞻收益表 + 「非预测」editorial-reason-block）。
- side-nav CONTENT 加 `{ href: "/crash-calendar", label: "大跌日历", icon: "▿" }`，220px 不动。

### 提案 #5 — sprint-status.yaml
- development_status 追加 epic-8 + 8-1…8-5（backlog）。
- action_items 追加合规 action（owner PM，§12 Q9/Q10 外部律所意见）。

---

## Section 5 — Implementation Handoff

| 项 | 内容 |
|---|---|
| Scope | Major |
| 路由 | PM / Solution Architect 点评架构段 → Developer 执行 |
| 前置阻塞 | §12 Q10 合规复核未清前 `/crash-calendar` 不公开 |
| 可并行 | Story 8.1 sidecar 回填可与 V1 收尾并行 |
| flag | sprint-status.yaml 缺 Epic 7 追踪（既存漂移，建议 PM 补登） |
| success criteria | 见 §3 |

**下一步（Developer）：**
1. 起架构 ADR / spine 评审（Python 第三运行时 + AD-7 扩展）。
2. 合规侧启动 §12 Q10 律所意见（2 周窗口，对齐 Q9）。
3. Story 8.1 spec 化 → dev（可先行，不依赖合规解阻）。
