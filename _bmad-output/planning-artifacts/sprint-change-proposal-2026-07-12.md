---
title: "AGUHOT Sprint Change Proposal — 视觉对齐参考站（编辑型纵栏）"
status: approved
created: 2026-07-12
updated: 2026-07-12
approved_at: 2026-07-12
scope: Moderate
trigger: 视觉执行层缺口 — Epic 4/5 交付后对照参考站 aihot.virxact.com 发现渲染形态不符
approved: true
approved_by: Carver
visual_spec: _bmad-output/demo-ui-redesign.html
design_basis: ui-ux-pro-max design-system 对账（Magazine/Blog editorial + Banking/Traditional Finance 配色）
---

# Sprint Change Proposal — AGUHOT 视觉对齐

> 触发：Epic 4（时间流首页）+ Epic 5（AI 分析层）交付后，事后对照参考站 AI HOT (`aihot.virxact.com`)，发现**信息架构已对、视觉形态未对**——当前仍是 V1「暖底边框卡片金融编辑台」，参考站是「无边框编辑型纵栏」。用户判断「太不像」。
>
> 变更分类：**Moderate**（UX 视觉处理返工 + 新增实现 epic，不触 PRD 定位层 / 不动 architecture / 不动 design token）→ 路由 **UX Designer + Developer**。

---

## Section 1: Issue Summary

### 问题陈述

AGUHOT 在 2026-07-11 的 Major Sprint Change Proposal 中已完成定位转向：首页从「优先级热点流」改为「时间流 + AI 解读」（Epic 4/5，commit `0c47a6d`、story 5-4 已完成）。**信息架构层面已对齐参考站**：分钟级时间流、同事件精选折叠、AI 解读钩子、盘前/盘中/盘后筛选均已落地。

但**渲染出来的视觉形态仍是 V1 的「边框卡片」语言**，与参考站的「无边框编辑型纵栏」根本不同。具体九处差距（代码级证据）：

| # | 维度 | 参考站 aihot | aguhot 现状（代码） | 差距 |
|---|---|---|---|---|
| G1 | 首页顶部 | 编号式「当前热点」紧凑排行（1. 2. 3…） | `MainLineBand`「今日重点/市场主线」卡片带 (`page.tsx:215`) | 缺编号排行 |
| G2 | 流容器 | 无边框、hairline 分隔的纵栏 | `rounded-lg border-border-hairline bg-surface-raised space-y-3` 边框卡 (`timeline-card.tsx:113`) | 视觉形态根本不同 |
| G3 | 日期分组 | 「7月11日」分节标题 | 无，扁平列表 | 缺日期分节 |
| G4 | 时间戳 | 每条 HH:mm 领头，醒目 | `font-mono text-xs text-ink-tertiary`，完整 UTC，被弱化 (`timeline-card.tsx:136`) | 时间戳未领头 |
| G5 | 来源 | 来源名一等扫描元素 | `sourceName` 在 `text-sm text-ink-secondary`，次要 (`timeline-card.tsx:145`) | 来源未提级 |
| G6 | 分数 | 「精选 82」编辑评分 | 「近期升温/多源覆盖」排序 chip | 缺精选分（aguhot 无此数据，见护栏） |
| G7 | 编辑点评 | 「推荐理由：…」每卡一段，分隔线签名式 | 「AI 解读」内联，无分隔，视觉弱 (`timeline-card.tsx:173`) | 推荐理由未成签名块 |
| G8 | 关联来源 | 「关联讨论 N 条」+ 来源 chips 内联 | 「同事件精选」`<details>` 折叠 (`timeline-card.tsx:211`) | 关联来源未 chip 外显 |
| G9 | 密度 | 多句长摘要 | 单行 summary | 密度太低 |

### 发现上下文

- 非实现期问题。Epic 4/5 全部交付（见 `sprint-status.yaml`）。
- 触发来自事后竞品视觉对照，属 **Strategic pivot (visual benchmark)**，非技术限制、非需求误解。
- 与 2026-07-11 Major 提案的区别：那次是**定位 + IA** 转向（PRD Vision/FR-1/AD-3b 重写）；这次是**视觉处理**返工（UX 组件规格 + 实现），不动定位层。

### 证据

- 参考站实测（2026-07-12）：无边框纵栏 + 编号热点 + 交易日分节 + HH:mm 领头 + 来源提级 + 多句摘要 + `* * *` 分隔的推荐理由。
- 代码级引用：`apps/web/app/(public)/page.tsx`、`_components/timeline-card.tsx`、`_components/event-card.tsx`、`app/globals.css`、`ux-designs/.../DESIGN.md`。
- **ui-ux-pro-max 设计智能对账**（2026-07-12）：`--design-system` 推荐 `Magazine/Blog` editorial 字体情绪（Newsreader 衬线 + Roboto 正文）+ `Banking/Traditional Finance` 配色（trust navy `#0F172A` + premium gold `#A16207` 暖白底）——与 aguhot 现有 token（Source Han Serif/Sans + 海军蓝 `#213B63` + 暖琥珀 `#B86633` + 暖纸底 `#F5F1E8`）**几乎一对一**。结论：**token 本身正确，缺口在视觉处理方式**。
- 锁定视觉规格：`_bmad-output/demo-ui-redesign.html`（方案 A，用户 2026-07-12 确认「更舒服」）。

### 用户决策（已在 correct-course 对齐中确认）

| 维度 | 决策 |
|---|---|
| 顶部结构 | 编号式「当前热点」排行替换 MainLineBand |
| 左侧导航 | 改为顶部窄条极简导航（UX-DR3 改写） |
| 流形态 | 无边框编辑型纵栏（时间轨 + 海军蓝竖线 + 正文） |
| AI 解读 | 实线 hairline 签名块，命名保持「AI 解读」 |
| 精选分 | 不做（NFR-2 不造假，用「来源 N」chip 替代）→ scope 锁 Moderate |
| 协作模式 | Incremental（视觉用 demo 确认，已锁定方案 A） |

---

## Section 2: Impact Analysis

### Epic Impact

- **Epic 4（已交付）**：4.1 读模型 `published_timeline`（AD-3b）**不动**；4.2 `TimelineCard` *渲染* 改无边框纵栏条目；`MainLineBand` 被编号排行替换；4.3 筛选不动。done 记录保留，不回滚。
- **Epic 5（已交付）**：5.1 AI 解读生成链不动，仅前端渲染改为签名块。
- **新增 Epic 6「视觉对齐参考站」**（5 个 story），承载全部视觉返工。
- Epic 1-3 done 不受影响。

### Artifact Conflicts

**PRD（轻触）**
- FR-1：追加视觉形态约束句（顶部编号排行 + 无边框纵栏 + 交易日分节）。定位层不动。
- FR-3：追加「顶部编号式当前热点排行复用既有 saliency 读模型，非新读模型」。
- Vision / Non-Goals / Metrics / MVP Scope：**不动**（2026-07-11 Major 已定）。

**Architecture（N/A）**
- 无新读模型、无 schema 变更。编号排行复用 `listPublishedHotEvents`（既有 saliency 读）；纵栏复用 `published_timeline`（AD-3b 不动）；顶部导航复用既有路由。
- AD-3b / AD-1~AD-8 全部不变。

**UX（重写主体）**
- 新增 **UX-DR16**（编辑型纵栏视觉形态总则）。
- **UX-DR3** 改写：左栏 → 顶部窄条极简导航。
- **UX-DR4b** 改写：时间流卡 → 无边框纵栏条目（时间轨 + 海军蓝竖线 + 正文）。
- **UX-DR8** 扩展：AI 解读实线签名块 + 权重 reconciliation。
- **UX-DR4** 扩展：event-card 同步无边框化（搜索等非流表面）。
- DESIGN.md 组件规格：`timeline-card` / `main-line-band→numbered-hot-list` / `left-rail→top-nav` 改写；新增 `date-section-divider` / `source-chip-list` / `editorial-reason-block`。
- 全部遵守 UX-DR15（无 carousel / 无满屏红绿 / 无强干扰动画）、UX-DR1（红绿仅市场语义）、UX-DR13（a11y 基线）。

**其他产物**
- `sprint-status.yaml`：新增 epic-6 + 5 story（backlog）。
- E2E：`home.spec` / `design.spec` / `themes.spec` / `navigation.spec` / `a11y.spec` 会红（左栏没了、band 没了、卡结构变了）→ Epic 6 Story 6.5 统一翻修。
- `globals.css` token：**不动**（ui-ux-pro-max 印证 token 正确）。

### Technical Impact

- 首页 IA：左侧导航 → 顶部窄条；MainLineBand → 编号排行；边框卡 → 无边框纵栏。
- 新增组件：`NumberedHotList` / `TopNav` / `DateSectionDivider` / `SourceChipList` / `EditorialReasonBlock`。
- `TimelineCard` 重构为「时间轨 + 竖线 + 正文」三栏。
- 时间格式：弃 `YYYY-MM-DD HH:mm UTC`，改相对时间（热点列表）+ `HH:mm`（纵栏）。
- 无新依赖、无新读模型、无 schema 迁移。

---

## Section 3: Recommended Approach

### 选定路径：Option 1（Direct Adjustment）— 新增 Epic 6

新增 Epic 6 承载视觉返工，不回滚 Epic 4/5（数据 + AI 层有效），不触 PRD 定位层 / architecture / token。**分类 Moderate → 路由 UX Designer + Developer。**

### 理由

- ui-ux-pro-max 对账证明 token 正确 → 视觉缺口纯粹是处理方式，无需改设计系统。
- 2026-07-11 Major 已定 IA 与定位 → 本次只动渲染层。
- 数据/AI 链有效 → 不回滚。
- 视觉规格已用 demo 锁定（方案 A），实现有据可依。

### 工作量评估

- **Medium**：1 个新 epic / 5 story / 5 个新组件 + 1 个重构 / E2E 翻修。

### 风险评估（Medium）

| 风险 | 等级 | 缓解 |
|---|---|---|
| 刚交付的 Epic 4 `TimelineCard` / `MainLineBand` 被重构/替换 | Medium | done 记录保留；读模型与 AI 链不动，仅渲染层返工 |
| E2E 大面积红（navigation/a11y/home/design/themes） | Medium | Story 6.5 专责翻修，逐 spec 对齐新 IA |
| 无边框纵栏在低对比度下分隔感不足 | Low | 海军蓝竖线 + hairline 分隔 + 行 hover bg 三重锚定；WCAG AA 已验 |
| 视觉返工与未来真实流量基线冲突 | Low | SM-8 基线已冻结为 pre-launch（2026-07-11），本次不触指标层 |

### Fallback

若 Epic 6 评审中发现「无边框纵栏」在真实数据密度下可读性不达标，备选：保留 `TimelineCard` 边框形态，仅替换 MainLineBand 为编号排行 + 加日期分节。此方案冲突最小但视觉对齐度低，仅作 fallback。

---

## Section 4: Detailed Change Proposals

> 视觉规格以 `_bmad-output/demo-ui-redesign.html`（方案 A）为准。以下提案已在该 demo 中可视化验证。

### UX 编辑提案（提案 1-5）

#### 提案 1：新增 UX-DR16 — 编辑型纵栏视觉形态总则
- **NEW**：公开时间流采用「编辑型纵栏」形态：无边框、hairline 分隔线划分条目、按交易日分节、HH:mm 时间戳领头、来源名提级、AI 解读以实线 hairline 独立成段。层级由字色 + 排版 + 分隔线建立，不依赖卡片边框/阴影。与 UX-DR15 反模式兼容。
- **Rationale**：统摄后续组件改写的上位原则。依据：ui-ux-pro-max `Magazine/Blog` editorial 方向 + 参考站实测。

#### 提案 2：UX-DR3 改写 — 左栏 → 顶部窄条极简导航
- **OLD**：桌面左侧导航 + 移动抽屉。
- **NEW**：顶部窄条极简导航（桌面单行水平条 / 移动顶部菜单 + 抽屉），内容区居中窄栏纵栏阅读流，去桌面左栏释放横向空间。
- **Rationale**：用户决策。IA 不变（首页/日报/主题/收藏/搜索入口都在）。触 `(public)/layout.tsx` + `navigation.spec` + `a11y.spec`。

#### 提案 3：UX-DR4b 改写 — 时间流卡 → 无边框纵栏条目
- **OLD**：时间流卡，边框，时间戳弱化。
- **NEW**：时间流**条目**（非卡），无边框，三栏结构 = 左时间轨（HH:mm 加粗 ink-1 + 时段弱化）→ **海军蓝 1px 竖线**（呼应 `evidence-row` 可追溯证据语义）→ 右正文（来源提级 / 标题 / 多句摘要 / 来源数 chip + 关联来源 chips / AI 解读实线签名块）。同事件精选可展开为来源 chip 列表（不伪造逐源时间线，`published_timeline` 仅 sourceName + count + ids）。按交易日分节。整条点击进详情。行 hover bg 微亮。
- **Rationale**：demo 方案 A 已验证。保留 UX-DR15 / UX-DR8。

#### 提案 4：UX-DR8 扩展 — AI 解读签名块与视觉权重 reconciliation
- **NEW 追加**：AI 解读以实线 hairline 独立成段（参考站「推荐理由」签名式），但字号/字色仍 ≤ 事实标题（body-sm + ink-secondary，不加粗）。命名保持「AI 解读」（不回退「推荐理由」，规避投资建议意味，对齐 PM P5 决策）。
- **Rationale**：解耦「视觉分段突出」与「权重 ≤ 事实」护栏。

#### 提案 5：UX-DR4 扩展 — event-card 同步无边框化
- **OLD**：热点卡片（边框）。
- **NEW**：热点条目，与时间流条目一致的无边框 + hairline 形态，全站视觉统一。阅读顺序与整条点击不变。
- **Rationale**：避免时间流无边框而搜索仍边框卡的割裂。搜索页 V1 可延后。

### DESIGN.md 组件规格提案（提案 6-10）

#### 提案 6：`main-line-band` → `numbered-hot-list`
- 编号式「当前热点」紧凑排行（ordered list，counter 编号），每项 = 标题（链接）+ 来源数 + 相对时间。复用 `listPublishedHotEvents` saliency 读。无卡片容器。

#### 提案 7：`left-rail` → `top-nav`
- 顶部 sticky 窄条（brand + 水平导航链接 + 激活态下划线），backdrop-blur + hairline 下边框。移动端收敛为菜单 + 抽屉。

#### 提案 8：`timeline-card` 重构为三栏纵栏条目
- 见提案 3。组件结构：`<li class="entry"><div class="e-rail">HH:mm + 时段</div><div class="e-body">来源/标题/摘要/chips/AI块/折叠</div></li>`，`e-body` 左 border 海军蓝。token 全复用。

#### 提案 9：新增 `date-section-divider` / `source-chip-list` / `editorial-reason-block`
- `date-section-divider`：交易日分节标题（serif ink-2）。
- `source-chip-list`：「关联讨论 N 条」+ 来源 chip 行 + 同事件精选展开 chip 列表。
- `editorial-reason-block`：AI 解读签名块（实线 hairline + AiLabel + body-sm ink-secondary）。

#### 提案 10：Elevation 原则调整
- 层级由「背景色差 + hairline 分隔 + 排版节奏」建立，不依赖卡片边框/阴影。阴影仅保留浮层/抽屉/hover 微移。

### PRD 编辑提案（提案 11，轻触）

#### 提案 11：FR-1 / FR-3 追加视觉形态约束
- **FR-1 追加**：首页以无边框编辑型纵栏呈现，按交易日分节，每条以 HH:mm 领头；顶部以编号式「当前热点」排行呈现 top-N。
- **FR-3 追加**：编号式当前热点排行复用既有 saliency 读模型（`listPublishedHotEvents`），非新读模型。
- **Rationale**：绑定实现的视觉契约。Vision/Non-Goals/Metrics 不动。

### Epic 编辑提案（提案 12）

#### 提案 12：新增 Epic 6 — 视觉对齐参考站：编辑型纵栏
- **Story 6.1**：顶部窄条极简导航替换左栏（UX-DR3）— `layout.tsx` + `TopNav` 组件 + e2e。
- **Story 6.2**：编号式「当前热点」排行替换 MainLineBand（UX-DR16 / 提案 6）。
- **Story 6.3**：时间流条目改无边框编辑型纵栏（UX-DR4b / 提案 3、8）— 时间轨 + 海军蓝竖线 + 交易日分节 + 来源提级 + 多句摘要 + 相对时间。
- **Story 6.4**：AI 解读实线签名块 + 来源 chip 外显（UX-DR8 / 提案 4、9）。
- **Story 6.5**：视觉对齐 E2E 与设计页同步（home/design/themes/navigation/a11y.spec 翻修）+ event-card 无边框化（提案 5）。
- **依赖**：Epic 4/5（已交付）；UX-DR16 / DR3 / DR4b / DR8 改写先行。

### sprint-status 编辑提案（提案 13）

#### 提案 13：新增 Epic 6 backlog
- epic-6 + 5 story（backlog）+ retrospective(optional)。
- `last_updated` 更新为 2026-07-12。
- 不删除 Epic 4/5 done 记录；其渲染层被 Epic 6 覆盖的关系记录于本提案。

### Architecture 注（提案 14，无编辑）

#### 提案 14：Architecture 无变更（记录性）
- 编号排行复用 `listPublishedHotEvents`；纵栏复用 `published_timeline`（AD-3b）；顶部导航复用既有路由。无新读模型、无 schema 变更、无 AD 增删。仅作记录，不编辑 ARCHITECTURE-SPINE.md。

---

## Section 5: Implementation Handoff

### 变更范围分类：Moderate

路由：**UX Designer + Developer**（PO/DEV）。PM 顾问（FR-3 措辞）、Architect 顾问（确认无 schema 触碰）。

### 交接对象与职责

| 角色 | 职责 |
|---|---|
| **UX Designer** | 1) 落地 UX-DR16 / DR3 / DR4b / DR8 / DR4 改写（提案 1-5）；2) DESIGN.md 组件规格改写（提案 6-10）；3) 以 `demo-ui-redesign.html` 为视觉规格基准。 |
| **Developer** | Epic 6 五个 story 实现（UX 改写审批后），沿用现有 modular monolith + Tailwind v4 + AD-1~AD-8 约束；token 零改动；E2E 翻修（Story 6.5）。 |
| **PM（顾问）** | FR-1 / FR-3 视觉形态约束句定稿（提案 11）。 |
| **Architect（顾问）** | 确认无 schema / 读模型触碰（提案 14）。 |

### 成功标准

- Epic 6 完成：首页展示无边框编辑型纵栏（时间轨 + 海军蓝竖线 + 交易日分节 + HH:mm 领头 + 来源提级 + 多句摘要）；顶部编号「当前热点」排行替换 band；顶部窄条导航替换左栏；AI 解读实线签名块；来源 chip 外显。
- 视觉与 `_bmad-output/demo-ui-redesign.html` 一致。
- E2E（home/design/themes/navigation/a11y）全绿。
- token 零改动（`globals.css` 不变）；architecture 零触碰。
- 护栏守住：AI 解读权重 ≤ 事实（UX-DR8）；红绿仅市场语义（UX-DR1）；NFR-2 不造假精选分（用「来源 N」chip）；「AI 解读」命名不回退（PM P5）。

### 阻塞项（交接后须先解）

1. ~~UX-DR16 / DR3 / DR4b / DR8 改写定稿（UX Designer）~~ → **已完成（2026-07-12）**：`epics.md` UX-DR 段（DR3/4/4b/8 改写 + DR16 新增）+ `DESIGN.md` 组件规格（top-nav / numbered-hot-list / timeline-card 无边框三栏 + date-section-divider / source-chip-list / editorial-reason-block 新增 + Elevation 原则）+ `EXPERIENCE.md` IA（左栏→顶部窄条 + 响应式表）全部同步。
2. ~~FR-1 / FR-3 视觉形态约束句定稿（PM 顾问）~~ → **已完成（2026-07-12）**：`prd.md` FR-1（置顶带→编号排行 + 视觉形态约束句）+ FR-3（编号排行复用 saliency 读、不造假精选分）追加。
3. Epic 6 五 story 已写入 `epics.md` + `sprint-status.yaml`（backlog），可进入 create-story → dev 流程。

---

## 附录：决策记录

- **用户决策来源**：correct-course 对齐（2026-07-12）。视觉用 demo 迭代确认，非逐条文字 a/e/s。
- **demo 迭代**：先出方案 A（编辑型纵栏）→ 加竖线 → ui-ux-pro-max 对账 → 3 方案对比（A/B/C）→ 用户试 C（极简纯文本）→ 回退确认 A「更舒服」。最终锁定方案 A = `demo-ui-redesign.html`。
- **ui-ux-pro-max 对账**：`--design-system` 推荐 editorial 字体 + Banking 配色，与 aguhot token 一对一印证 → 锁定「不动 token」。
- **saliency 精选分否决**：参考站「精选 82」是编辑质量分，aguhot 未算 → NFR-2 不造假，用「来源 N」chip 替代 → scope 不升 Major。
- **lazy senior dev 风险提示**（已向用户明示）：方案 A 比参考站多一层「海军蓝竖线 = 可追溯证据」语义表达，属 aguhot 护城河增量，不偏离参考站形态。用户已知悉。

## 附录2：视觉规格附件

- `_bmad-output/demo-ui-redesign.html` — 锁定的完整单页 demo（方案 A），实现基准。
- `_bmad-output/demo-variants.html` — 3 方案对比历史（A/B/C），留档。
- `_bmad-output/demo-c.html` — 方案 C 极简纯文本（用户试后否决），留档。
