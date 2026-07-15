---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - /Users/carver/workspace/mindcarver/aguhot/_bmad-output/planning-artifacts/prds/prd-aguhot-2026-07-09/prd.md
  - /Users/carver/workspace/mindcarver/aguhot/_bmad-output/planning-artifacts/architecture/architecture-aguhot-2026-07-09/ARCHITECTURE-SPINE.md
  - /Users/carver/workspace/mindcarver/aguhot/_bmad-output/planning-artifacts/ux-designs/ux-aguhot-2026-07-09/DESIGN.md
  - /Users/carver/workspace/mindcarver/aguhot/_bmad-output/planning-artifacts/ux-designs/ux-aguhot-2026-07-09/EXPERIENCE.md
---

# aguhot - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for aguhot, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: 用户打开首页后可以直接看到当日按优先级排序的热点事件流，而不是原始文章列表。
FR2: 用户可以按时间范围和类别筛选热点事件流，并且能看到和清除当前筛选条件。
FR3: 用户可以看到每个热点事件的大致排序理由，如多源覆盖、近期升温或市场反应明显。
FR4: 用户进入热点事件详情页后可以快速看到事件摘要、为什么重要以及当前不确定点。
FR5: 用户可以按时间阅读支撑该热点事件的证据时间线，每条证据源包含来源、时间、摘要和原始链接。
FR6: 用户在热点事件详情页中可以区分已确认事实、系统解释和待确认判断。
FR7: 用户可以看到某个热点事件主要关联的概念、行业和代表性个股。
FR8: 用户可以查看该热点事件已出现的市场反应信号，至少包含价格/成交维度和板块/涨停维度信号。
FR9: 用户可以判断当前热点事件是一次性噪音还是某个连续主线的一部分，并可跳转到主题页或历史相关事件。
FR10: 用户可以查看一个交易日的结构化日报，并从日报跳转到对应热点事件详情页。
FR11: 用户可以通过主题页跟踪某个热点主题的连续演化，并查看多个时间上的相关热点事件。
FR12: 用户可以搜索热点事件、主题页或相关关键词，结果覆盖标题、解释摘要和主题名称。
FR13: 用户可以将热点事件或主题页加入关注列表，并在独立页面查看。
FR14: 内部运营人员可以对热点事件的归组、标题和标签做人工修正，包括合并、拆分和修改标签。
FR15: 内部运营人员可以检查解释内容和证据时间线完整性，并将热点事件标记为待复核、已复核或需下线。

### NonFunctional Requirements

NFR1: 进入 V1 重点范围的证据源，从系统采集到出现在公开热点事件流的目标延迟应控制在 10 分钟以内。
NFR2: 所有公开展示的热点事件都必须能回溯到至少一个有效证据源。
NFR3: 所有 AI 生成的摘要、解释或衍生内容都必须做显式标识。
NFR4: V1 作为 Web 首发产品，必须在桌面端和移动端浏览器上可正常使用。
NFR5: 当市场反应信号或部分外部数据不可用时，产品仍可展示热点事件和证据时间线，并明确缺失状态。
NFR6: 与运营复核相关的关键变更必须保留审计记录。

### Additional Requirements

- 架构采用 modular monolith with event-driven ingest pipeline，V1 保持单仓、单域模型、双运行时（web + worker），不提前拆微服务。
- 公开站与运营后台共用同一领域核心，但 Web 进程只提供请求响应，Worker 进程承担采集、归一化、聚类、解释、日报生成和发布链路。
- 热点内容必须有单一写拥有者：source-ingest 只拥有原始证据源；event-assembly 只拥有热点事件聚类；theme-linking 只拥有主题关联；market-reaction 只拥有市场反应快照。
- 所有公开页面与公开 API 只能读取 published_* 发布态读模型或等价读模型，不能直接读取原始采集表、处理中间表或运营工作表。
- 采集、正文抽取、去重、聚类、解释生成、市场信号汇总、日报生成、主题回填必须全部走 BullMQ 异步任务，Web 请求路径不得同步等待抓取或 LLM。
- ExplanationVersion、ReviewDecision、PublicationDecision 必须采用追加式记录，公开页只展示当前 published 版本。
- 高影响动作（公开展示、下线、合并、拆分、解释修订、来源屏蔽）必须经过 review-workflow 的 publication_status 闸门。
- 外部财经源、公告源、行情源、LLM 供应商必须通过 SourceAdapter、MarketDataAdapter、LLMAdapter 端口接入，领域模块不得直接依赖第三方 SDK。
- 公共内容浏览、搜索、详情阅读、日报阅读、主题追踪默认匿名可用，用户身份不能成为公共内容路径依赖。
- 统一约定：主键使用 UUIDv7；时间存 UTC；公开 API 使用 data/meta/error 三段式响应；请求和 job 都带 trace_id。
- 运行时基础栈已固定为 Next.js App Router + React + PostgreSQL + Prisma + Redis + BullMQ，适合作为 Epic 1 Story 1 的初始脚手架与基础设施基线。
- 当前 deferred 决策包括具体云厂商、具体数据供应商、是否引入专用搜索引擎、是否引入 WebSocket/SSE、是否允许低风险事件自动发布、是否提供机构 API。

### UX Design Requirements

UX-DR1: 建立一套暖底色 + 深墨文字 + 市场红绿语义分离的视觉 token 体系，并将品牌主色与涨跌色彻底解耦。
UX-DR2: 实现 Source Han Serif SC / Source Han Sans SC / IBM Plex Mono 分工明确的字体层级，并确保标题、正文、数字三类内容各自稳定可读。
UX-DR3: 落地顶部窄条极简导航（桌面端单行水平导航条，移动端收敛为顶部菜单 + 抽屉），内容区为居中窄栏纵栏阅读流；去桌面左侧固定导航以释放横向空间，对齐参考站无 chrome 编辑型纵栏形态。保证首页、详情、日报、主题页在三档断点下结构稳定。（2026-07-12 sprint-change-proposal 改写：原桌面左栏 → 顶部窄条）
UX-DR4: 实现热点条目组件（搜索结果等非流表面复用），采用与时间流条目一致的无边框 + hairline 分隔形态，保证全站视觉语言统一。固定阅读顺序：标题 → 一句话解释 → 来源数/更新时间 meta → 排序理由 chip；整条点击主路径不变。（2026-07-12 扩展：同步无边框化，对齐 UX-DR16）
UX-DR4b: 实现时间流条目（非「卡片」）组件，无边框、以 hairline 分隔线划分，区别于热点事件条目。三栏结构：左时间轨（HH:mm 加粗 ink-1 + 时段弱化）→ 海军蓝 1px 竖线（呼应 `evidence-row` 可追溯证据语义）→ 右正文（来源名提级为一等扫描元素 / 标题 / 多句摘要 / 来源数 chip + 关联讨论来源 chips / AI 解读实线签名块）。同事件精选条目带"同事件精选"标签可展开为来源 chip 列表（不伪造逐源时间线，`published_timeline` 仅 sourceName + count + ids）。按交易日分节（date-section-divider）。整条点击进入对应热点事件详情页；行 hover bg 微亮。时间戳优先级高于来源，不得用横向 carousel 承载（对齐 UX-DR15/DR16）。（2026-07-12 sprint-change-proposal 改写：边框卡 → 无边框纵栏条目，视觉规格见 `_bmad-output/demo-ui-redesign.html`）
UX-DR5: 实现筛选胶囊组件，支持清晰的默认态、激活态和清除路径。`时间流` 筛选维度为时间范围（盘前/盘中/盘后/全天）与类别（概念/行业/个股/公告/研报）；筛选条件在 URL 可分享，返回时不丢失。
UX-DR6: 实现证据时间线行组件，支持来源名称、时间、摘要、原始链接和必要的展开交互。
UX-DR7: 实现市场反应 chip 组件，仅表达单一市场信号维度，且不能依赖颜色作为唯一语义。
UX-DR8: 实现统一的 AI 标识组件与文案规范，确保所有 AI 生成内容（摘要、解释、日报、`AI 解读`、`AI 深读`、`趋势研判`）在公开页和运营侧均可识别。`AI 解读` 标识紧邻其文案，不得与事实性摘要视觉混淆；AI `AI 解读` 视觉权重 <= 事实摘要（PRD §10），不得在卡片上比事实标题/摘要更突出。`AI 解读` 以实线 hairline 独立成段（参考站「推荐理由」签名式），但字号/字色仍 ≤ 事实标题（body-sm + ink-secondary，不加粗）——分隔线仅做视觉分段，不做权重提升。命名保持「AI 解读」（不回退参考站「推荐理由」措辞，规避金融投资建议意味，对齐 PM P5 决策）。（2026-07-12 扩展：签名块与权重 reconciliation）
UX-DR9: 实现关注/收藏交互，支持延迟登录策略，不得在首次浏览路径上强制登录。
UX-DR10: 实现首页、详情页、搜索结果页、关注列表、日报页、主题页的空状态、缺失状态和下线状态文案与交互。
UX-DR11: 实现事实、解释、不确定性三类内容的可视化分区，避免在详情页中混成一个信息块。
UX-DR12: 实现稳定返回路径：用户从日报、主题页或搜索进入详情后，返回时必须回到原消费语境。
UX-DR13: 实现无障碍基础能力：键盘可达、结构化标题层级、红绿之外的文本辅助语义、移动端点击热区、减少动态效果支持。
UX-DR14: 实现运营复核状态标记组件，明确区分待复核、已复核、需下线，并与公开展示状态一致。
UX-DR15: 保持视觉和交互反模式约束：禁止横向 carousel 承载核心热点、禁止强干扰动画、禁止连续多层弹窗、禁止交易软件式满屏红绿。
UX-DR16: 公开时间流采用「编辑型纵栏」视觉形态：无边框、以 hairline 分隔线划分条目、按交易日分节、HH:mm 时间戳领头、来源名提级为一等扫描元素、AI 解读以实线 hairline 独立成段（签名式）。层级由字色 + 排版节奏 + 分隔线建立，不依赖卡片边框与阴影。与 UX-DR15 反模式兼容（仍禁 carousel / 满屏红绿 / 强干扰动画）。依据：ui-ux-pro-max `Magazine/Blog` editorial 方向 + 参考站 aihot.virxact.com 实测 + `_bmad-output/demo-ui-redesign.html`（方案 A，2026-07-12 锁定）。（2026-07-12 sprint-change-proposal 新增）

### FR Coverage Map

FR1: Epic 1 - 首页热点事件流
FR2: Epic 1 - 热点事件流筛选
FR3: Epic 1 - 热点事件排序理由
FR4: Epic 1 - 详情页摘要与关键结论
FR5: Epic 1 - 证据时间线
FR6: Epic 1 - 事实、解释与不确定性区分
FR7: Epic 2 - 概念、行业与个股关联
FR8: Epic 2 - 市场反应信号展示
FR9: Epic 2 - 主题延续性与历史关联
FR10: Epic 2 - 结构化日报
FR11: Epic 2 - 主题页连续追踪
FR12: Epic 3 - 热点与主题搜索
FR13: Epic 3 - 关注列表
FR14: Epic 1 - 运营修正归组、标题与标签
FR15: Epic 1 - 运营复核解释与来源完整性

## Epic List

### Epic 1: 可信热点发布闭环
让用户可以看到可公开展示的 `热点事件流`，进入详情页阅读摘要与 `证据时间线`，并且整个公开内容经过最小可用的 `运营复核` 与发布闸门，保证“能看”同时“可信”。
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR14, FR15

### Epic 2: 主线联动与日度复盘
让用户不仅能看单条热点，还能看它与 `概念`、`行业`、`个股`、`市场反应信号`、`主题页`、`日报` 之间的关系，形成“发现热点 + 解释热点 + 复盘热点”的完整主线体验。
**FRs covered:** FR7, FR8, FR9, FR10, FR11

### Epic 3: 搜索回访与轻留存
让用户能够通过搜索快速找回 `热点事件` 和 `主题页`，并通过 `关注列表` 建立最小可用的个人回访机制，而不把整个公共内容路径绑死在登录态上。
**FRs covered:** FR12, FR13

### Epic 8: 大跌日历与历史回顾
让用户在「大跌日历页」查看A股历史大跌日、当日领跌板块与大跌后历史实际表现，把"市场反应"从单点快照升级为历史序列回顾。排期 v1.1，不塞 V1 GA（行情数据为全新品类 + §12 Q9/Q10 合规未清）。
**FRs covered:** FR16

## Epic 1: 可信热点发布闭环

让用户可以看到可公开展示的 `热点事件流`，进入详情页阅读摘要与 `证据时间线`，并且整个公开内容经过最小可用的 `运营复核` 与发布闸门，保证“能看”同时“可信”。

### Story 1.1: 初始化公共站点脚手架与匿名首页壳层

As a 市场观察用户,
I want 团队先搭起可运行的公共站点壳层和匿名首页入口,
So that 我可以立即进入公共阅读路径，而不是先被登录或未完成站点阻断。

**Acceptance Criteria:**

**Given** 团队开始实现 AGUHOT V1  
**When** 使用约定的 Next.js App Router + React + Tailwind + shadcn/ui 基线脚手架初始化项目  
**Then** 仓库中存在可运行的公共 Web 应用骨架  
**And** 依赖、环境变量结构和基础目录与架构 spine 保持一致

**Given** 用户首次访问 AGUHOT  
**When** 首页加载完成  
**Then** 用户可以看到公共页面骨架和默认首页入口  
**And** 首页不强制登录才能浏览核心内容

### Story 1.2: 基础导航与响应式公共页面壳层

As a 市场观察用户,
I want 在桌面端和移动端都能通过稳定导航进入主要公共页面,
So that 我可以在不同设备上保持一致的浏览起点。

**Acceptance Criteria:**

**Given** 用户在桌面端浏览器访问公共站点  
**When** 页面渲染  
**Then** 页面展示左侧一级导航  
**And** 首页、日报、主题、收藏等入口都可访问

**Given** 用户在移动端浏览器访问公共站点  
**When** 页面渲染  
**Then** 页面展示顶部导航入口与抽屉导航  
**And** 与桌面端相同的一级入口都可访问

**Given** 用户在三档断点间切换  
**When** 公共页面重新布局  
**Then** 首页、详情、日报和主题页保持单一主阅读流  
**And** 不出现内容重叠、导航丢失或无法滚动的问题

### Story 1.3: 视觉 token 与排版基础落地

As a 市场观察用户,
I want 公共页面具备稳定一致的视觉与排版基础,
So that 我能快速分辨导航、事实、解释和市场语义层次。

**Acceptance Criteria:**

**Given** 设计系统初始化  
**When** 页面组件加载  
**Then** 暖底色、深墨文字、品牌色与市场红绿分离的视觉 token 已落地  
**And** 标题、正文、数字三类文本层级稳定可读

**Given** 页面展示 `AI 标识`、筛选胶囊或市场反应 chip  
**When** 组件渲染  
**Then** 它们使用统一的语义样式来源  
**And** 不在页面内各自硬编码颜色或字体规则

### Story 1.4: 证据源采集与归档

As a 运营人员,
I want 系统先把配置好的证据源稳定采集并归档,
So that 候选热点生成有可追溯、可复核的原始证据基础。

**Acceptance Criteria:**

**Given** 已配置的首批 `证据源` 可访问  
**When** Worker 执行采集与归一化任务  
**Then** 原始证据会以可追溯记录写入系统  
**And** 每条记录保留来源、时间、原始链接和采集状态

**Given** 新采集到的证据进入处理链路  
**When** 异步任务完成去重、初步聚类和候选事件生成  
**Then** 系统会生成待复核的候选 `热点事件`  
**And** 候选事件不会直接出现在公开页面

**Given** 外部源异常或部分字段缺失  
**When** 处理任务运行  
**Then** 系统会记录失败或缺失状态  
**And** 不会因为单个源异常阻塞其余证据的归档

### Story 1.5: 候选热点聚类与待复核生成

As a 运营人员,
I want 系统把已归档证据聚成待复核候选热点,
So that 我可以在后台处理事件级候选，而不是逐条手工拼接资讯。

**Acceptance Criteria:**

**Given** 系统中已存在可追溯的证据记录
**When** 异步任务完成去重、初步聚类和候选事件生成
**Then** 系统会生成待复核的候选 `热点事件`
**And** 候选事件与关联证据保持可追溯关系

**Given** 某个候选热点尚未经过发布决策
**When** 公共用户访问首页或详情
**Then** 该候选不会出现在公开页面
**And** 只会出现在运营复核路径中

**Given** 候选 HotEvent 生成（2026-07-15 sprint-change-proposal 追加，对齐 Epic 7）  
**When** event-assembly 聚类产出一个候选  
**Then** 该候选必须附带投资相关性 `relevanceLabel`（pass/suspicious/fail）与 `saliency` 分  
**And** `relevance=fail` 的候选不进入发布流程，落 `reject` 审计（AD-2b / NFR-8）

### Story 1.6: 运营复核队列与发布闸门

As a 运营人员,
I want 在后台查看候选热点并做发布决策,
So that 只有经过复核的热点才会进入公开流。

**Acceptance Criteria:**

**Given** 系统已生成候选 `热点事件`  
**When** 运营人员进入复核台  
**Then** 可以看到待复核列表、候选标题、来源数、最近更新时间和当前状态  
**And** 每条候选都可以进入详情复核

**Given** 运营人员正在复核某个候选热点  
**When** 执行通过、驳回或下线决定  
**Then** 系统会写入 `ReviewDecision` 和 `PublicationDecision` 记录  
**And** 公开展示状态只由 `publication_status` 控制

**Given** 某个候选未被发布
**When** 公共用户访问首页或详情
**Then** 该内容不会出现在公开页
**And** 后台仍能看到完整审计轨迹

**Given** 运营人员进入复核台（2026-07-15 sprint-change-proposal 追加，对齐 Epic 7）  
**When** 查看待复核列表  
**Then** 列表默认按 `saliency DESC` 排序，每条显示分数与 `saliencyBreakdown`  
**And** 中分（`LOW ≤ saliency < HIGH`）候选默认进复核队列，运营可手动覆盖阈值处置（阈值模块配置常量，可调）

### Story 1.7: 公开热点事件流

As a 市场观察用户,
I want 在首页扫描已发布的热点事件流,
So that 我能快速知道今天市场正在交易什么。

**Acceptance Criteria:**

**Given** 系统中存在 `published` 状态的热点事件  
**When** 用户打开首页  
**Then** 首页展示的是按优先级排序的 `热点事件流`，而不是原始文章流  
**And** 每张热点卡片至少展示标题、一句话解释、来源数、最近更新时间和排序理由概览

**Given** 用户使用时间或类别筛选  
**When** 切换筛选条件  
**Then** 列表结果会随之更新  
**And** 当前筛选条件清晰可见且可清除

**Given** 当前没有可公开展示的热点  
**When** 用户访问首页  
**Then** 页面显示明确空状态与最近更新时间说明  
**And** 不显示占位假数据

### Story 1.8: 热点事件详情、证据时间线与解释分区

As a 市场观察用户,
I want 打开单个热点事件并看到摘要、证据时间线和不确定性说明,
So that 我能判断这条热点是否站得住，而不是只看二次加工结论。

**Acceptance Criteria:**

**Given** 某个热点事件已发布  
**When** 用户进入详情页  
**Then** 首屏至少展示“发生了什么”“为什么重要”“当前仍不确定什么”三个信息块  
**And** 事实、解释、不确定性必须视觉分区

**Given** 用户查看 `证据时间线`  
**When** 浏览单条证据  
**Then** 每条证据至少展示来源名称、时间、摘要和原始链接  
**And** 若原始链接失效，页面必须明确标注而不是静默消失

**Given** 详情页中的摘要或解释由 AI 生成  
**When** 页面渲染  
**Then** 所有 AI 生成内容都必须带统一标识  
**And** 该标识在公开页和后台复核页保持一致

### Story 1.9: 已发布热点的文案与标签修正

As a 运营人员,
I want 对已发布热点的标题、标签和解释进行修正,
So that 我可以纠正公开文案，同时保留完整审计历史。

**Acceptance Criteria:**

**Given** 某个热点事件已经公开发布  
**When** 运营人员修改标题、标签或解释  
**Then** 系统会生成新的版本记录，而不是覆盖历史内容  
**And** 公开页只展示当前已发布版本

**Given** 某次修正尚未通过重新发布  
**When** 公共用户访问首页或详情  
**Then** 用户看到的仍是上一个已发布版本  
**And** 后台能看到待发布修改与版本差异

### Story 1.10: 已发布热点的合并、拆分与下线发布

As a 运营人员,
I want 对已发布热点执行合并、拆分、下线和重新发布,
So that 我可以在发现归组问题或公开风险时修正结果并保持公开态一致。

**Acceptance Criteria:**

**Given** 某个热点事件已经公开发布  
**When** 运营人员执行合并或拆分  
**Then** 系统会保留新旧事件关系、来源链和审计记录  
**And** 修改后的公开结果与后台状态保持一致

**Given** 已发布热点需要临时撤下  
**When** 运营人员执行下线操作  
**Then** 公共页面不再展示该热点  
**And** 后台保留撤下原因、操作者和时间记录

**Given** 某次修正影响公开页内容  
**When** 发布态读模型刷新  
**Then** 首页和详情页都读取到更新后的已发布版本  
**And** 不会混用旧解释和新证据状态

## Epic 2: 主线联动与日度复盘

让用户不仅能看单条热点，还能看它与 `概念`、`行业`、`个股`、`市场反应信号`、`主题页`、`日报` 之间的关系，形成“发现热点 + 解释热点 + 复盘热点”的完整主线体验。

### Story 2.1: 市场反应信号生成与展示

As a 市场观察用户,
I want 在热点详情中看到结构化的市场反应信号,
So that 我能判断市场是否已经对这条热点作出响应。

**Acceptance Criteria:**

**Given** 某个热点事件已发布且存在可用行情数据  
**When** Worker 执行市场反应汇总任务  
**Then** 系统会生成关联的 `市场反应信号` 记录  
**And** 该记录进入公开读模型

**Given** 用户访问热点事件详情页  
**When** 页面展示市场反应区块  
**Then** 至少展示一种价格或成交维度信号和一种板块或涨停维度信号  
**And** 每个信号都带明确时间语境

**Given** 某个信号暂不可用  
**When** 页面渲染  
**Then** 区块显示缺失说明  
**And** 不留空误导用户

### Story 2.2: 概念、行业与个股关联视图

As a 市场观察用户,
I want 在热点详情中看到概念、行业与代表性个股关联,
So that 我能把消息和市场反应对象连起来看。

**Acceptance Criteria:**

**Given** 某个热点事件存在有效关联结果  
**When** 用户打开详情页  
**Then** 页面展示概念、行业和代表性个股中的至少一组关联  
**And** 每个关联项有明确跳转去向

**Given** 关联项来自系统映射  
**When** 公开页展示  
**Then** 关联结果必须基于明确映射依据  
**And** 不允许完全手工随意填写后直接公开

**Given** 某类关联信息尚不可得  
**When** 页面渲染  
**Then** 页面可以只展示已确认的关联组  
**And** 不会伪造“看起来完整”的关联内容

### Story 2.3: 主题页连续追踪

As a 市场观察用户,
I want 通过主题页追踪某个主线的连续演化,
So that 我能分辨一次性噪音和持续发酵的主题。

**Acceptance Criteria:**

**Given** 多个热点事件被归入同一主题  
**When** 用户进入 `主题页`  
**Then** 页面按时间顺序展示相关热点事件  
**And** 用户可以回到任一热点事件详情页

**Given** 某个热点事件存在主题归属  
**When** 用户浏览详情页  
**Then** 页面提供跳转到对应 `主题页` 的入口  
**And** 返回详情后不丢失原阅读上下文

**Given** 主题关联证据不足  
**When** 系统尝试建立主题页  
**Then** 该热点不会被强行挂入不可靠主题  
**And** 用户不会看到伪造的“历史相似”

### Story 2.4: 结构化日报生成与阅读

As a 轻研究用户,
I want 查看一个交易日的结构化日报,
So that 我能在短时间内完成当日热点复盘。

**Acceptance Criteria:**

**Given** 某个交易日存在已发布热点事件  
**When** Worker 执行日报生成任务  
**Then** 系统会生成当日 `日报`  
**And** 日报包含重点热点事件清单和每条事件的简要结论

**Given** 用户打开日报页  
**When** 页面渲染  
**Then** 页面清晰展示覆盖日期和生成时间  
**And** 用户可从日报直接跳转到对应热点事件详情页

**Given** 日报尚未生成完成  
**When** 用户访问日报页  
**Then** 页面显示当前覆盖范围或处理中状态  
**And** 不返回空白页

### Story 2.5: 跨首页、主题页、日报与详情页的主线浏览闭环

As a 市场观察用户,
I want 在首页、详情、主题页和日报之间稳定往返,
So that 我能连续理解主线而不丢失原消费语境。

**Acceptance Criteria:**

**Given** 用户从首页、主题页或日报进入详情页  
**When** 执行返回操作  
**Then** 页面返回到原入口语境  
**And** 不总是强制回到首页

**Given** 用户从首页带筛选条件进入详情页  
**When** 返回首页  
**Then** 页面恢复进入详情前的筛选条件  
**And** 列表滚动位置不重置到默认顶部

**Given** 用户从主题页或日报进入详情页  
**When** 返回原页面  
**Then** 页面回到此前浏览的位置或明确的对应区块  
**And** 不要求用户重新从页面开头查找刚才阅读的内容

**Given** 主题页、日报页或详情页处于空/缺失/部分数据状态  
**When** 用户浏览  
**Then** 各页面都展示清晰状态说明  
**And** 仍提供可继续浏览的退路

## Epic 3: 搜索回访与轻留存

让用户能够通过搜索快速找回 `热点事件` 和 `主题页`，并通过 `关注列表` 建立最小可用的个人回访机制，而不把整个公共内容路径绑死在登录态上。

### Story 3.1: 热点与主题搜索

As a 市场观察用户,
I want 搜索热点事件、主题页和相关关键词,
So that 我能快速回到我想看的主线或个别事件。

**Acceptance Criteria:**

**Given** 系统存在已发布的热点事件和主题页  
**When** 用户输入关键词搜索  
**Then** 搜索结果覆盖热点标题、解释摘要和主题名称  
**And** 结果按相关性与时间综合排序

**Given** 搜索无匹配结果  
**When** 用户提交关键词  
**Then** 页面给出明确无结果反馈  
**And** 提供返回首页或更换关键词的路径

**Given** 用户通过键盘或触控使用搜索  
**When** 与搜索框和结果列表交互  
**Then** 核心交互可达  
**And** 不依赖 hover 才能完成主路径

### Story 3.2: 延迟登录的收藏动作

As a 市场观察用户,
I want 在浏览热点或主题时直接执行收藏动作,
So that 我能先完成判断，再决定是否进入账户体系。

**Acceptance Criteria:**

**Given** 用户在热点卡片、详情页或主题页上执行收藏  
**When** 当前尚未登录  
**Then** 系统允许先展示轻量登录引导或延迟登录流程  
**And** 不会在首次浏览主路径上预先强制登录

**Given** 用户已登录  
**When** 执行收藏或取消收藏  
**Then** 收藏状态在当前账号会话中保持一致  
**And** 相同内容在不同页面中的收藏状态同步更新

**Given** 用户放弃登录  
**When** 关闭登录引导  
**Then** 用户仍可继续浏览公开内容  
**And** 页面不会因收藏未完成而崩溃或跳失

### Story 3.3: 关注列表与回访管理

As a 市场观察用户,
I want 进入单独的关注列表查看和管理已收藏内容,
So that 我能形成最小可用的回访机制。

**Acceptance Criteria:**

**Given** 用户已有至少一个已收藏的热点事件或主题页  
**When** 进入 `关注列表`  
**Then** 页面展示收藏内容列表  
**And** 用户可以进入对应详情页或主题页继续阅读

**Given** 关注列表为空  
**When** 用户进入该页面  
**Then** 页面展示明确空状态说明  
**And** 提供回到首页或探索主题的入口

**Given** 某个已收藏内容已下线或不可见  
**When** 用户查看关注列表  
**Then** 系统明确标示该内容状态变化  
**And** 不把失效项伪装成正常内容

### Story 3.4: 搜索结果到详情页的回访闭环

As a 市场观察用户,
I want 从搜索结果进入详情后还能稳定回到原结果列表,
So that 我可以沿着同一查询上下文继续寻找相关热点。

**Acceptance Criteria:**

**Given** 用户输入关键词并获得搜索结果  
**When** 从结果列表进入某个热点事件详情页后执行返回  
**Then** 页面回到原搜索结果列表  
**And** 原关键词、排序与结果上下文保持不变

**Given** 用户从搜索结果进入详情页  
**When** 浏览器返回状态不可恢复  
**Then** 页面提供明确的“返回搜索结果”入口  
**And** 该入口带回原查询词而不是空白搜索页

### Story 3.5: 公开页面语义与键盘可达基线

As a 市场观察用户,
I want 在首页、详情、主题、日报、搜索和关注列表中获得一致的语义与键盘可达性,
So that 我在不依赖鼠标的情况下也能稳定完成浏览。

**Acceptance Criteria:**

**Given** 用户使用键盘浏览公共页面  
**When** 焦点在导航、卡片、搜索、筛选、收藏和来源链接之间移动  
**Then** 所有核心交互都可达  
**And** 页面提供可见焦点状态和清晰的标题层级

**Given** 页面展示市场反应信号或涨跌语义  
**When** 用户仅依赖文本、图标或辅助技术理解界面  
**Then** 关键状态不只依赖红绿颜色表达  
**And** 对应语义有文本或等价辅助标识

### Story 3.6: 公开页面触控热区与减少动态效果支持

As a 市场观察用户,
I want 在移动端和低动态偏好场景下获得稳定的交互体验,
So that 我不会因为点击困难或多余动效而中断浏览。

**Acceptance Criteria:**

**Given** 用户在移动端或启用减少动态效果偏好  
**When** 页面渲染或状态切换  
**Then** 交互热区满足基础触控尺寸  
**And** 非必要动效被关闭或降级为即时切换

## Epic 4: 时间流首页与同事件精选

让用户打开首页即看到按交易日分钟级倒序排列的 `时间流`，同事件多源证据折叠为"同事件精选"，并支持按盘前/盘中/盘后与概念/行业/个股/公告/研报筛选，替代原优先级热点流首页。

**FRs covered:** FR-1(改), FR-2, FR-3(改), FR-12(搜索覆盖时间流)

### Story 4.1: 时间流读模型与发布刷新

As a 市场观察用户,
I want 首页时间流基于统一的发布态读模型刷新,
So that 我看到的时间序、同事件折叠与公开可见性始终一致。

**Acceptance Criteria:**

**Given** 已发布热点事件与证据源存在
**When** Worker 执行 publish-orchestrator 时间流刷新任务
**Then** `published_timeline` 读模型按交易日分组、组内分钟级倒序生成
**And** 同一 HotEvent 的多条证据源折叠为单条"同事件精选"条目
**And** Web 首页只读取该读模型，不直接拼时间序 SQL

### Story 4.2: 时间流首页与时间流卡组件

As a 市场观察用户,
I want 首页以时间倒序流形态展示当日动态,
So that 我能跟上市场节奏而不是看优先级列表。

**Acceptance Criteria:**

**Given** `published_timeline` 存在数据
**When** 用户打开首页
**Then** 首页展示时间流卡列表（时间戳/来源/标题/一句话摘要/AI 解读钩子/证据源数）
**And** 时间流顶部展示"今日重点/市场主线"置顶带（top-N saliency，常态启用，复用 FR-3 置顶机制）
**And** 同事件精选条目可展开查看各证据源
**And** 无数据时显示明确空状态与最近更新时间

### Story 4.3: 盘前/盘中/盘后与类别筛选

As a 市场观察用户,
I want 按交易时段和类别筛选时间流,
So that 我聚焦自己关心的时段与板块。

> **V1 范围裁决（2026-07-11，PM 决策，解 dev intent-gap HALT）：** 类别维度 V1 = `concept/industry/stock`（概念/行业/个股）三项，复用既有 `AssociationKind`，沿用 2.2 feed-filter 的内存过滤 V1 模式（服务端 SQL 筛选 + Json 列重构为子表属 scale-ceiling defer）。`announcement/research_report`（公告/研报）**出 V1 范围**——整个 codebase 无任何数据承载（无 enum/字段/source），强行实现违反「absence as absence」。待公告/研报真实数据源采购 + 数据模型落地后另开 story（已登 deferred-work）。时段维度（盘前/盘中/盘后/全天）无歧义、直接实现。

**Acceptance Criteria:**

**Given** 用户在时间流首页
**When** 切换盘前/盘中/盘后（时段维度）或 概念/行业/个股（类别维度，V1 三项）筛选
**Then** 列表实时更新，当前筛选可见且可清除
**And** 筛选条件在 URL 可分享，返回不丢失
**And** 类别筛选基于既有 `AssociationKind`（concept/industry/stock），公告/研报不渲染（无数据源，V1 out-of-scope，见 deferred-work）

### Story 4.4: 时间流条目与搜索打通

As a 市场观察用户,
I want 搜索结果覆盖时间流条目,
So that 我能按关键词回到某条历史动态。

**Acceptance Criteria:**

**Given** 用户输入关键词搜索
**When** 提交查询
**Then** 结果覆盖时间流条目标题与摘要、热点事件标题、主题页名称
**And** 从结果进入时间流条目后可跳转到对应热点事件详情页

## Epic 5: AI 分析层

让用户在时间流卡看到 `AI 解读`、在详情页读到 `AI 深读`、在日报与主题页读到跨事件 `趋势研判`，三种 AI 生成内容均带标识、可追溯、受运营抽检。

**FRs covered:** FR-1(AI 解读), FR-4(AI 深读), FR-10(趋势研判), FR-11(趋势研判), NFR-3

### Story 5.1: 列表卡 AI 解读生成

As a 市场观察用户,
I want 每条时间流卡附带一句话 AI 解读,
So that 我不点开也能判断这条动态为什么值得看。

**Acceptance Criteria:**

**Given** `LLMAdapter` 端口尚未实现（codebase 现状）
**When** 5.1 dev 启动
**Then** 先落地 `LLMAdapter` 端口骨架（接口 + Stub + worker resolve，照抄 DigestAdapter 先例）
**And** 真实 LLM provider 注入点留好，本 story 可用 Stub 跑通生成链

**Given** 时间流条目对应的 HotEvent 已发布
**When** Worker 执行 AI 解读生成 job（经 `LLMAdapter`）
**Then** 生成一句话（上限 40 字）AI 解读，挂显式 + 隐式元数据标识（NFR-3）
**And** AI 解读受措辞黑名单约束，黑名单覆盖六类（动作/收益预测/操纵框架/推荐强度/时点建议/过度确定，详见 PRD §10），以正向可枚举常量承载，违反即拒绝重试或落缺失态
**And** 每版保留 model id + prompt 版本 + 时间戳（NFR-7）
**And** 生成失败时卡片显示缺失态而非留空，覆盖率 >= 95%（SM-7）

### Story 5.2: 事件级 AI 深读

As a 市场观察用户,
I want 在详情页读到一段 AI 深读,
So that 我能快速理解这件事的影响面、受益方与风险点。

**Acceptance Criteria:**

**Given** 热点事件详情页存在
**When** Worker 执行深读生成 job
**Then** 详情页"为什么重要"区块下生成 AI 深读（影响面/受益方/风险点三段，带 AI 标识）
**And** 深读内容必须与证据时间线一致，不得编造无来源结论（对齐 NFR-2）
**And** 深读作为 ExplanationVersion 版本化记录（AD-5）

### Story 5.3: 日报页 AI 趋势研判

As a 轻研究用户,
I want 在日报页读到跨事件 AI 趋势研判,
So that 我能跳出单事件看当日主线演化。

**Acceptance Criteria:**

**Given** 某交易日存在多个已发布热点事件
**When** Worker 执行趋势研判生成 job（日报生成时）
**Then** 日报页生成 AI 趋势研判段落（显式 + 隐式标识，NFR-3）
**And** 研判标注其依据的事件集合，不伪造因果
**And** 研判作为 TrendBriefing 独立 append-only 表版本化记录（归 digest 模块，AD-5）

### Story 5.3b: 主题页 AI 趋势研判（延后 v1.1）

延后到 §12 Q3 主题页生成方式定案、且日报研判 SM-6 误导率连续 2 周达标后启动。MVP 不交付（PRD §7.2 Out of Scope）。

### Story 5.4: AI 生成内容运营抽检

As a 运营人员,
I want 对 AI 解读/深读做抽检,
So that 误导性 AI 内容不长期滞留公开页。

> **V1 范围裁决（2026-07-12，PM 决策，解 dev intent-gap HALT 的 4 个 gap）：**
> - **Gap 1 下线粒度 = 外科式**：扩 review-workflow 加新 outcome `suppress_ai_content`（不新增 publication_status，不改 decideReview 的 HotEvent 状态机），事务内只重投影该条 AI 内容——reason 置 null（`refreshPublishedTimelineForEvent`）/ deepread 删行（`refreshPublishedReadModel`）。**不**核平整个事件。审计走既有 `ReviewDecision`（note 标注 misleading + target_type+target_id）。
> - **Gap 2 研判出 V1 范围**：TrendBriefing（coverageDate 键、无 publication_status、禁并行复核）V1 **不可标记/下线**。运营台研判仅 browse（只读），不可标记。待未来设计 coverageDate 复核 schema 后另开 story。SM-6 分子不含研判。
> - **Gap 3 重生成延后**：V1 **不做「重生成」action**（adapter 未接、prod 空转 = 死按钮、误导运营）。AC「下线**或**重生成」的「或」使延后成立。V1 只做 suppress/takedown。重生成待真实 provider 落地后另开 story。
> - **Gap 4 SM-6 口径**：运营 console 新增一个误导率读数 = 误导标记数（ReviewDecision where note misleading, target_type in {reason,deepread}）/ AI 内容总数（已生成的 reason+deepread 行数），**聚合分母**（reason+deepread 合计，不含研判），**滚动 7 日窗**。查 append-only `ReviewDecision` 审计表算。满足 SM-6 < 10% 可观测。

**Acceptance Criteria:**

**Given** AI 生成内容（reason / deepread）已上线
**When** 运营人员进入复核台
**Then** 可按类型筛选 AI 解读（reason）/ 深读（deepread）——研判（trend briefing）仅 browse 不可标记（V1 排除）
**And** 可标记某条 reason 或 deepread 为误导，触发**外科式下线**（扩 review-workflow 新 outcome `suppress_ai_content`，事务内只重投影该条 AI 内容、不改 HotEvent publication_status、不核平整个事件）
**And** **不做**「重生成」action（V1 延后，待真实 provider 落地）
**And** 运营 console 新增 SM-6 误导率读数（误导标记数 / reason+deepread 总数，聚合，滚动 7 日窗，查 ReviewDecision 审计表）——研判不计入分母/分子

## Epic 6: 视觉对齐参考站：编辑型纵栏

让 aguhot 公开站的视觉形态从 V1「暖底边框卡片金融编辑台」对齐参考站 aihot.virxact.com 的「无边框编辑型纵栏」：顶部窄条极简导航、编号式「当前热点」排行、时间流条目改无边框三栏（时间轨 + 海军蓝竖线 + 正文）、AI 解读实线签名块、来源 chip 外显。**不动 design token / architecture / PRD 定位层**（ui-ux-pro-max 2026-07-12 对账印证 token 正确，缺口在视觉处理方式）。视觉规格以 `_bmad-output/demo-ui-redesign.html`（方案 A）为准。

**触发：** sprint-change-proposal-2026-07-12（scope: Moderate，路由 UX Designer + Developer）。
**FRs covered:** FR-1(视觉形态), FR-3(编号排行复用 saliency 读), UX-DR3/4/4b/8/16。

### Story 6.1: 顶部窄条极简导航替换左栏

As a 市场观察用户,
I want 桌面端用顶部窄条导航而非左侧固定栏,
So that 内容区有更宽的居中纵栏阅读空间，更接近参考站无 chrome 形态。

**Acceptance Criteria:**

**Given** UX-DR3 已改写为顶部窄条导航
**When** 实现 `TopNav` 组件替换 `(public)/layout.tsx` 的左栏
**Then** 桌面端渲染单行水平导航条（brand + 首页/日报/主题/收藏/搜索 + 激活态下划线），sticky + backdrop-blur + hairline 下边框
**And** 移动端收敛为顶部菜单 + 抽屉，一级入口与桌面一致
**And** IA 不变（所有导航目的地保留），`navigation.spec` / `a11y.spec` 翻修通过

### Story 6.2: 编号式「当前热点」排行替换 MainLineBand

As a 市场观察用户,
I want 首页顶部是紧凑编号式热点排行,
So that 我能快速扫到 top-N 热点而非看卡片带。

**Acceptance Criteria:**

**Given** `listPublishedHotEvents` saliency 读模型存在
**When** 实现 `NumberedHotList` 组件替换 `MainLineBand`
**Then** 渲染 ordered list（counter 编号 1. 2. 3…），每项 = 标题（链接）+ 来源数 + 相对时间（如「2 小时前」）
**And** 复用既有 saliency 读，不新增读模型/字段（对齐提案 14）
**And** 无数据时不渲染（NFR-2 不造假「精选」），`home.spec` 翻修通过

### Story 6.3: 时间流条目改无边框编辑型纵栏

As a 市场观察用户,
I want 首页时间流是无边框纵栏而非边框卡片,
So that 阅读体验像编辑型专栏而非后台卡片墙。

**Acceptance Criteria:**

**Given** UX-DR4b 已改写 + `demo-ui-redesign.html` 为视觉规格
**When** 重构 `TimelineCard` 为三栏条目（时间轨 HH:mm + 时段 → 海军蓝 1px 竖线 → 正文）
**Then** 时间戳以 HH:mm 领头（ink-1 加粗），来源名提级为一等扫描元素
**And** 摘要允许多句密度，按交易日分节（`DateSectionDivider`）
**And** 无边框、hairline 分隔、行 hover bg 微亮（150ms，respect reduced-motion）
**And** 整条点击进详情不变，同事件精选展开为来源 chip 列表（不伪造逐源时间线）
**And** 时间格式弃 `YYYY-MM-DD HH:mm UTC`，改 HH:mm + 相对时间
**And** `home.spec` / `design.spec` / `themes.spec` 翻修通过

### Story 6.4: AI 解读实线签名块 + 来源 chip 外显

As a 市场观察用户,
I want AI 解读独立成分段签名块、关联来源以 chip 外显,
So that 我能一眼区分「事实摘要」与「AI 点评」，并看到关联讨论来源。

**Acceptance Criteria:**

**Given** UX-DR8 已扩展 + `recommendationReason` 字段（5.1）
**When** 渲染 AI 解读为实线 hairline 签名块（`EditorialReasonBlock`）
**Then** AiLabel + body-sm ink-secondary，实线 hairline 分隔，字号/字色 ≤ 事实标题（权重护栏）
**And** 命名保持「AI 解读」（不回退「推荐理由」）
**And** 关联讨论来源以 `SourceChipList` 外显（「关联讨论 N 条」+ 来源 chips）
**And** `recommendationReason` 为 null 时不渲染槽位（不留空占位，NFR-2）

### Story 6.5: 视觉对齐 E2E 与设计页同步 + event-card 无边框化

As a 市场观察用户,
I want 全站视觉语言统一且 e2e 覆盖新形态,
So that 改版后不出现视觉割裂与回归。

**Acceptance Criteria:**

**Given** Story 6.1-6.4 已落地
**When** 翻修 E2E（`home` / `design` / `themes` / `navigation` / `a11y` spec）对齐新 IA 与纵栏形态
**Then** 所有公开页 e2e 全绿
**And** `event-card`（搜索等非流表面）同步无边框化（UX-DR4 扩展），全站视觉统一
**And** `globals.css` token 零改动（ui-ux-pro-max 印证），architecture 零触碰
**And** 护栏守住：AI 解读权重 ≤ 事实、红绿仅市场语义、无 carousel / 满屏红绿

## Epic 7: 投资相关性打分与分级发布闸门

让系统在聚类后、发布前对每个候选 HotEvent 做**投资相关性判定 + 显著度打分（saliency）**，并按分数分级处置（高分自动发 / 中分进运营复核 / 低分或无关拦截），使公开时间流只承载有投资价值或会影响投资的高质量动态，而非"来者不拒"。打分全部基于现有数据（多源覆盖 + 升温速度 + 市场反应强度 + 板块关联密度），社交热度信号 V1 占位、deferred。

**触发：** sprint-change-proposal-2026-07-15（scope: Moderate，路由 Architect 点评 AD-2b + Developer 实施 + PO 排期/阈值）。
**FRs covered:** FR-1(质量准入), FR-3(排序理由读 saliencyBreakdown), FR-15(运营复核按分), 新增 NFR-8（内容质量分级）, 操作化 SM-C2, 新增 SM-9。

### Story 7.1: 投资相关性判定（准入闸门）

As a 市场观察用户,
I want 与投资无关的新闻（娱乐/八卦/纯社会噪音）在准入阶段就被挡下,
So that 公开流不被低相关性内容稀释。

**Acceptance Criteria:**

**Given** event-assembly 聚类产出一个候选 HotEvent
**When** scoring 阶段（cluster 之后、explain 之前）运行相关性判定
**Then** 候选附带 `relevanceLabel`（pass / suspicious / fail）
**And** 判定基于板块/个股关联命中（theme-linking `EventAssociationSet`）+ 投资关键词白名单/黑名单（正向可枚举常量承载，照搬 AI 措辞黑名单先例）
**And** V1 用确定性规则（可复现、可审计，AD-5）；模糊项 LLM 兜底 deferred

**Given** 某候选 `relevance = fail`
**When** 进入发布流程
**Then** 该候选落 `decideReview({outcome:"reject"})`，不进公开流
**And** 审计记录（`ReviewDecision`）标注 relevance-fail 原因

### Story 7.2: 显著度打分 saliency 与 schema 迁移

As a 市场观察用户,
I want 每个候选事件有一个可解释的显著度分,
So that 真正多源覆盖、升温快、市场已反应的事件排在前面。

**Acceptance Criteria:**

**Given** Prisma schema（`packages/core/prisma/schema.prisma`）
**When** 迁移落地
**Then** `HotEvent` 增 `saliency Float?` + `saliencyBreakdown Json?` + `relevanceLabel`
**And** `PublishedHotEvent` / `PublishedTimelineEntry` 增 `saliency Float?`（由 publish-orchestrator 投影写入，AD-3）

**Given** 一个候选及其证据集
**When** scoring 阶段计算 saliency（0–100）
**Then** 加权 = 多源覆盖（~40）+ 升温速度（~20）+ 市场反应强度（~25，Story 7.4 回灌）+ 板块关联密度（~15）+ 社交热度（V1 占位 0）
**And** 权重与阈值为 event-assembly 模块配置常量（不进全局 env，照搬 `TIMELINE_FOLD_THRESHOLD` 先例），运营可调

### Story 7.3: 分级发布闸门

As a 运营人员,
I want 发布闸门按 saliency 分级处置,
So that 高质量事件自动上线、可疑事件进复核、垃圾事件被拦截。

**Acceptance Criteria:**

**Given** 候选已带 relevance + saliency
**When** 发布流程执行（dev: `run-pipeline.ts:95` 自动过审循环；prod: `review-service.ts:108`）
**Then** 三级处置：`relevance=fail` 或 `saliency < LOW` → `reject`；`LOW ≤ saliency < HIGH` → 留 `candidate` 进复核队列；`saliency ≥ HIGH` 且 `relevance=pass` → 自动 `approve`
**And** 高风险子集（个股-facing / 含收益·目标暗示）V1 仍走人工签核（对齐 PRD §12 Q8）
**And** AD-6 发布闸门不变式不破——只是给闸门加了数值门槛

### Story 7.4: 市场反应强度回灌 saliency

As a 市场观察用户,
I want "市场已经反应"的事件显著度更高,
So that 排序反映真实市场动作而非纯文本热度。

**Acceptance Criteria:**

**Given** `MarketReactionSnapshot`（涨停数、板块涨跌幅等）已存在
**When** publish-orchestrator 刷新读模型时
**Then** 只读查询 market-reaction snapshot，把 magnitude 折入 saliency 重算
**And** 写拥有权仍在 event-assembly（AD-2b：market-reaction 不跨边界写）

### Story 7.5: 排序与展示接入 saliency

As a 市场观察用户,
I want 首页与时间流按显著度而非纯源数排序,
So that 最值得看的事件排在前。

**Acceptance Criteria:**

**Given** `published_*` 读模型已带 `saliency`
**When** 刷新首页与时间流
**Then** `publish-service.ts:742`（listPublishedHotEvents）与 `timeline-read-model.ts:578`（listPublishedTimeline）排序键由 `evidenceCount DESC` 改为 `saliency DESC`
**And** FR-3 排序理由 chip 改读 `saliencyBreakdown`（多源覆盖/升温/市场反应/板块关联），文案规则不变（非公式化、不暴露权重）
**And** 时间流条目视觉形态零改动（Epic 6 纵栏不动）

### Story 7.6: 运营台 saliency 可见 + 阈值可调 + 观测

As a 运营人员,
I want 在复核台看到分数与 breakdown 并能调阈值,
So that 我能监控打分质量并校准。

**Acceptance Criteria:**

**Given** 复核台（Epic 1 Story 1.6）
**When** 运营查看
**Then** 列表按 saliency 排序，显示分数 + breakdown，中分候选进队列
**And** 阈值（HIGH/LOW）与权重在模块配置可调，不写死
**And** 新增 SM-9 读数可观测：低分拦截率 + 公开流高分占比（操作化 SM-C2）

### Story 7.7: 社交热度信号（deferred，V1 不实现）

社交热度（评论/转发/热度）需新建微博/雪球 adapter，触发 §10 合规新增面。V1 saliency 公式留 0 分位。待社交数据源采购 + 合规推进后另开 story，与 Epic 5 算法备案窗口捆绑。MVP 不交付。

## Epic 8: 大跌日历与历史回顾

status: backlog
target_release: v1.1
binds: 市场反应与关联展示 (FR-16)
depends_on: Epic 7 saliency（可选，大跌日 ↔ 热点关联用）
source: sprint-change-proposal-2026-07-15b（scope: Major）

把 PRD §4.3「市场反应」从 per-HotEvent 单点快照升级为历史序列回顾。新增行情历史日线数据品类（三大宽基 + 申万一级行业）与 Python 第三运行时（`apps/market-sidecar`，受 AD-1 约束，复刻 RSSHub 自建采集器先例）。措辞护栏：大跌后表现为历史 T+N 实际收益统计，显式标注「非预测、非投资建议」，受 §10 黑名单约束。排期 v1.1，不塞 V1 GA；§12 Q10 合规复核未清前 `/crash-calendar` 不对外公开。

### Story 8.1: 行情历史日线采集 sidecar（Python + AkShare）

- 新建 `apps/market-sidecar`（Python 3.12 + AkShare），定时 job 拉取三大宽基（上证综指 / 深证成指 / 创业板指）+ 申万一级行业日线，写入 `index_daily_bars` / `sector_daily_bars`（Postgres）。
- 仅"翻译成行"写权限，不含领域规则（AD-1 / AD-7）。Node 侧 `market-reaction` 与 `crash-review` 只读这些表。
- **Given** 近 3 年交易日 **When** sidecar 回填 + 每日增量 **Then** 三大宽基 + 申万一级日线入库，`source` 字段可追溯（NFR-2），数据缺失明确标记，不编造（NFR-5）。
- 风险面：行情数据采集属金融信息服务范畴 → 进 §12 Q9 / Q10 合规复核。

### Story 8.2: 大跌日判定 + 前瞻收益计算

- 新增 `crash-review` 模块（写拥有 `CrashDay`，AD-2）：任一宽基日跌幅 ≤ `CRASH_THRESHOLD`（默认 -2%，运营可调）即记大跌日；投影当日跌幅 Top-N 申万行业 + T+1/T+5/T+20 三大宽基实际收益。
- 计算走 BullMQ 异步 job（AD-4）；T+N 收益随交易日推进补全。`publish-orchestrator` 投影 `published_crash_days` 读模型（AD-3）。
- **Given** 已入库日线 **When** 计算大跌日 **Then** 阈值不写死（对齐 `TIMELINE_FOLD_THRESHOLD` 范式，运营可调）；前瞻收益为历史实际值非预测；缺失态不编造（NFR-5）。

### Story 8.3: 大跌日历公开页 /crash-calendar

- 日历视图（大跌日高亮 + 触发指数 / 跌幅）+ 领跌板块榜（复用 `reaction-chip-down`，不新增 token）+ 前瞻收益表（numeric 字体 + T+1/T+5/T+20）。
- 复用 `published_*` 读模型范式（AD-3），新增 `published_crash_days`。
- 文案显式标注「历史统计回顾，非预测、非投资建议」（`editorial-reason-block`），受 §10 措辞黑名单约束。
- **Given** published_crash_days 有数据 **When** 用户访问 **Then** 三段视图齐备；无数据时明确空状态；移动端可用（NFR-4）。

### Story 8.4: 左栏 SideNav 入口 + 路由

- `side-nav` CONTENT 加「大跌日历」导航项（220px 不动）；移动端抽屉同步可见。
- 新增 `/crash-calendar` 路由接入公开 layout。
- **Given** 桌面 / 移动端 **When** 导航 **Then** 双端一致；active 态正确（startsWith 匹配）。

### Story 8.5: 大跌日 ↔ 当日 HotEvent 关联（deferred，v1.2）

把大跌日历与现有热点事件流打通：大跌日高亮关联当日已发布 HotEvent，复用 Epic 7 saliency / market reaction。v1.1 不做，避免与 saliency 调参期耦合。

### Epic 8 观测 / 验收度量

- 新增 **SM-C4（对冲）**：大跌日历页不以"大跌后涨幅最大化"为展示目标，避免退化为"反弹规律的暗示"（对齐 §10 advisory 护栏）。
- 不立 V1 硬访问指标，v1.1 上线后观测再立。
