---
name: AGUHOT
description: A股热点发现与解释产品。像一份高频金融编辑台，而不是一个喧闹资讯门户。
status: draft
updated: 2026-07-12
sources:
  - /Users/carver/workspace/mindcarver/aguhot/_bmad-output/planning-artifacts/briefs/brief-aguhot-2026-07-09/brief.md
  - /Users/carver/workspace/mindcarver/aguhot/_bmad-output/planning-artifacts/prds/prd-aguhot-2026-07-09/prd.md
colors:
  canvas: '#F5F1E8'
  surface-base: '#FBF8F2'
  surface-raised: '#FFFFFF'
  surface-muted: '#EEE6D8'
  ink-primary: '#151A22'
  ink-secondary: '#5D6470'
  ink-tertiary: '#8A909A'
  border-hairline: '#DDD4C4'
  brand-primary: '#213B63'
  brand-primary-foreground: '#FFFFFF'
  accent-warm: '#B86633'
  accent-warm-foreground: '#FFF8F1'
  market-up: '#C43C32'
  market-up-soft: '#F8E0DD'
  market-down: '#0E8B5B'
  market-down-soft: '#DDF2E9'
  market-flat: '#8E7759'
  market-flat-soft: '#EFE7DA'
  focus-ring: '#335A91'
  overlay: 'rgba(21,26,34,0.42)'
typography:
  display-lg:
    fontFamily: 'Source Han Serif SC'
    fontSize: 34px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  display-md:
    fontFamily: 'Source Han Serif SC'
    fontSize: 28px
    fontWeight: '600'
    lineHeight: '1.25'
  headline:
    fontFamily: 'Source Han Sans SC'
    fontSize: 22px
    fontWeight: '700'
    lineHeight: '1.35'
  title:
    fontFamily: 'Source Han Sans SC'
    fontSize: 18px
    fontWeight: '600'
    lineHeight: '1.45'
  body:
    fontFamily: 'Source Han Sans SC'
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.65'
  body-sm:
    fontFamily: 'Source Han Sans SC'
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.6'
  label:
    fontFamily: 'IBM Plex Sans'
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1.4'
    letterSpacing: 0.08em
  numeric:
    fontFamily: 'IBM Plex Mono'
    fontSize: 13px
    fontWeight: '500'
    lineHeight: '1.4'
rounded:
  sm: 6px
  md: 10px
  lg: 14px
  xl: 20px
  full: 9999px
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 24px
  '6': 32px
  '7': 48px
  gutter-mobile: 16px
  gutter-desktop: 28px
  content-max: 1200px
  detail-max: 860px
components:
  page-shell:
    background: '{colors.canvas}'
    maxWidth: '{spacing.content-max}'
  top-nav:
    background: 'rgba(245,241,232,0.92)'
    backdropBlur: 'saturate(140%) blur(8px)'
    borderBottom: '1px solid {colors.border-hairline}'
    position: 'sticky'
  date-section-divider:
    titleColor: '{colors.ink-secondary}'
    fontFamily: 'Source Han Serif SC'
  event-card:
    background: '{colors.surface-raised}'
    border: '1px solid {colors.border-hairline}'
    radius: '{rounded.lg}'
    titleColor: '{colors.ink-primary}'
    metaColor: '{colors.ink-secondary}'
  timeline-card:
    background: 'transparent'
    border: 'none'
    divider: '1px solid {colors.border-hairline}'
    railTimeColor: '{colors.ink-primary}'
    railSessionColor: '{colors.ink-tertiary}'
    verticalLine: '1px solid {colors.brand-primary}'
    bodyPaddingLeft: '18px'
    titleColor: '{colors.ink-primary}'
    metaColor: '{colors.ink-secondary}'
    timestampColor: '{colors.ink-primary}'
    foldTagBackground: '{colors.surface-muted}'
    foldTagForeground: '{colors.ink-secondary}'
    hoverBackground: '{colors.surface-base}'
  numbered-hot-list:
    background: 'transparent'
    border: 'none'
    itemDivider: '1px solid {colors.border-hairline}'
    counterColor: '{colors.ink-tertiary}'
    titleColor: '{colors.ink-primary}'
    metaColor: '{colors.ink-tertiary}'
  source-chip-list:
    chipBackground: 'transparent'
    chipBorder: '1px solid {colors.border-hairline}'
    chipForeground: '{colors.ink-tertiary}'
    countChipBackground: '{colors.surface-base}'
  editorial-reason-block:
    divider: '1px solid {colors.border-hairline}'
    labelBackground: '{colors.accent-warm}'
    labelForeground: '{colors.accent-warm-foreground}'
    textColor: '{colors.ink-secondary}'
  event-rank-chip:
    background: '{colors.surface-muted}'
    foreground: '{colors.ink-primary}'
    radius: '{rounded.full}'
  evidence-row:
    background: '{colors.surface-base}'
    borderLeft: '3px solid {colors.brand-primary}'
    radius: '{rounded.md}'
  reaction-chip-up:
    background: '{colors.market-up-soft}'
    foreground: '{colors.market-up}'
    radius: '{rounded.full}'
  reaction-chip-down:
    background: '{colors.market-down-soft}'
    foreground: '{colors.market-down}'
    radius: '{rounded.full}'
  reaction-chip-flat:
    background: '{colors.market-flat-soft}'
    foreground: '{colors.market-flat}'
    radius: '{rounded.full}'
  primary-button:
    background: '{colors.brand-primary}'
    foreground: '{colors.brand-primary-foreground}'
    radius: '{rounded.md}'
  filter-pill:
    background: '{colors.surface-base}'
    foreground: '{colors.ink-secondary}'
    activeBackground: '{colors.brand-primary}'
    activeForeground: '{colors.brand-primary-foreground}'
    radius: '{rounded.full}'
  ai-label:
    background: '{colors.accent-warm}'
    foreground: '{colors.accent-warm-foreground}'
    radius: '{rounded.full}'
---

## Brand & Style

AGUHOT 的视觉身份应当像一个“高频金融编辑台”，而不是一个喊单站、营销站或泛资讯门户。[ASSUMPTION] 这版设计把产品气质定义为“编辑感 + 终端感的混合体”：有足够强的结构和密度去承载市场信息，但仍然保持解释层产品需要的呼吸感与阅读秩序。

这个系统不是为“制造兴奋”服务，而是为“建立判断”服务。它应该让用户一眼分出：什么是事实、什么是解释、什么是市场反应、什么还不确定。视觉上要克制、安静、可信，允许少量市场颜色进入，但绝不让大面积红绿把整个界面拖回交易软件的噪音逻辑。

## Colors

配色的核心规则是：**背景为纸面，中性色负责结构，红绿只负责市场语义，不负责品牌。**

- **Canvas / Surface (`{colors.canvas}` / `{colors.surface-base}` / `{colors.surface-raised}`)** 构成主要阅读环境。底色略暖，避免纯白带来的“金融后台”生硬感，同时让长时间阅读热点解释和证据时间线时不刺眼。
- **Ink (`{colors.ink-primary}` / `{colors.ink-secondary}` / `{colors.ink-tertiary}`)** 负责层级。标题、事实、解释、元信息之间必须靠字色区分，而不是靠过量分割线。
- **Brand Primary (`{colors.brand-primary}`)** 是产品级导航与主要操作色，用于主 CTA、激活态过滤项、焦点边框。它不是市场颜色，因此不能拿来表示涨跌。
- **Accent Warm (`{colors.accent-warm}`)** 只用于 AI 标签和少量“解释层”强调。它表达“这是一层加工与整理”，但不能用于按钮泛滥。
- **Market Up / Market Down / Market Flat** 只用于 `{components.reaction-chip-up}`、`{components.reaction-chip-down}`、`{components.reaction-chip-flat}` 以及必要的行情信号场景。禁止把整张卡片染红或染绿。

避免：纯黑背景、炫彩渐变、金融 App 式满屏红绿、抢眼霓虹蓝、饱和紫色品牌化。

## Typography

AGUHOT 的排版应该体现“两层声音”：一层是解释与标题的编辑性，一层是数据与元信息的工具性。

- **`{typography.display-lg}` / `{typography.display-md}`** 使用 `Source Han Serif SC`，仅用于大标题、专题页主标题和日报页标题。它提供“编辑解释层”的重量感。
- **`{typography.headline}` / `{typography.title}` / `{typography.body}` / `{typography.body-sm}`** 使用 `Source Han Sans SC`，承担绝大多数阅读和界面文本。它必须稳定、密实、长文可读。
- **`{typography.label}`** 用于过滤项、分组标签、栏位名和轻量操作，追求秩序感，而不是存在感。
- **`{typography.numeric}`** 专门用于时间、计数、涨跌幅、成交等数字密集区，避免正文数字在视觉上抖动。

[ASSUMPTION] V1 不需要追求强品牌广告感，因此不引入更戏剧化的展示字体，避免设计表达压过金融内容。

## Layout & Spacing

布局原则是：**首页高密度，详情页长阅读，结构必须先于装饰。**

- 桌面端采用 `content-max` 容器，主要内容区不超过 `{spacing.content-max}`，让首页多卡片列表和详情页都可控。
- 详情页正文宽度压到 `{spacing.detail-max}`，避免 `证据时间线` 与解释文本在超宽屏上变成长行。
- 桌面端采用 `[ASSUMPTION] 左侧导航 + 右侧内容` 的信息架构，移动端收敛为顶部导航与抽屉。
- 间距节奏用 `{spacing.2}` / `{spacing.3}` / `{spacing.4}` 管理紧密信息簇，用 `{spacing.5}` / `{spacing.6}` 分隔版块级内容。
- 热点卡片内部的结构优先垂直堆叠，避免为了“高级感”做复杂拼贴。

## Elevation & Depth

AGUHOT 不依赖强阴影制造层级。层级主要由背景色差、hairline 分隔线和排版节奏建立（UX-DR16，2026-07-12：时间流纵栏采用无边框形态，层级不再依赖卡片边框）。

- 主层使用 `{colors.surface-raised}`，次层使用 `{colors.surface-base}` 或 `{colors.surface-muted}`。
- 阴影只允许出现在浮层、抽屉和小范围 hover 抬升上，且必须非常轻。
- 证据与解释相关模块应更像“注释块”或“编辑夹注”，而不是会漂浮的营销卡片。

## Shapes

圆角应当克制，整体偏工具型。

- 小型标签、筛选胶囊和信号 chip 使用 `{rounded.full}`。
- 主要信息卡片使用 `{rounded.lg}`，让内容看起来有容器，但不软塌。
- 输入框、按钮、证据块等使用 `{rounded.md}` 或 `{rounded.sm}`，保证严肃感。
- 禁止大面积超圆角和拟物式卡片，避免产品气质从“金融解释层”滑向“消费内容 App”。

## Components

- **Page shell (`{components.page-shell}`)**：整体背景为 `{colors.canvas}`，内容区像一张金融周刊的工作页，而不是后台管理系统。
- **Top nav (`{components.top-nav}`)**：[ASSUMPTION] 桌面主导航采用顶部窄条极简导航（单行水平导航条，sticky + backdrop-blur + hairline 下边框），承载首页、日报、主题、收藏、搜索。移动端收敛为顶部菜单 + 抽屉。去桌面左侧固定导航以释放内容区横向空间（UX-DR3，2026-07-12 改写；原 `left-rail` 已弃用）。
- **Event card (`{components.event-card}`)**：产品最重要的视觉单元。采用与时间流条目一致的无边框 + hairline 分隔形态（UX-DR4/DR16，2026-07-12 扩展），全站视觉统一。每条必须先让用户读懂标题与一句话解释，再看标签、来源、热度与更新时间。本身不应被过多颜色污染。
- **Timeline card (`{components.timeline-card}`)**：首页 `时间流` 的条目单元（非「卡片」，无边框），区别于 event-card。三栏结构：左时间轨（HH:mm 加粗 ink-1 + 时段弱化）→ 海军蓝 1px 竖线（呼应 evidence-row 可追溯证据语义）→ 右正文（来源名提级 / 标题 / 多句摘要 / 来源数 chip + 关联讨论来源 chips / AI 解读实线签名块）。同事件精选可展开为来源 chip 列表。按交易日分节（`{components.date-section-divider}`）。时间戳以 HH:mm 领头（不再弱化为 ink-tertiary），AI 解读紧邻 `{components.ai-label}` 并以实线 hairline 独立成段，不得与事实摘要视觉混淆。整条点击进详情；行 hover bg 微亮。不得用横向 carousel 承载（对齐 UX-DR15/DR16）。视觉规格见 `_bmad-output/demo-ui-redesign.html`（2026-07-12 改写）。
- **Numbered hot list (`{components.numbered-hot-list}`)**：时间流顶部编号式「当前热点」排行（ordered list，counter 编号 1. 2. 3…），每项 = 标题（链接）+ 来源数 + 相对时间。复用既有 saliency 读模型（`listPublishedHotEvents`），非新读模型/字段。无数据时不渲染（NFR-2 不造假「精选分」）。常态启用，主动回答"市场正在交易什么"（2026-07-12 改写；原 `main-line-band` 卡片带已弃用）。
- **Date section divider (`{components.date-section-divider}`)**：交易日分节标题（serif + ink-2），划分纵栏阅读流的日期边界（2026-07-12 新增）。
- **Source chip list (`{components.source-chip-list}`)**：「关联讨论 N 条」+ 来源 chip 行；同事件精选展开后以 chip 列出各证据源代表来源（不伪造逐源时间线，`published_timeline` 仅 sourceName + count + ids）（2026-07-12 新增）。
- **Editorial reason block (`{components.editorial-reason-block}`)**：AI 解读实线签名块（实线 hairline + `{components.ai-label}` + body-sm ink-secondary）。分隔线仅做视觉分段，字号/字色 ≤ 事实标题（权重护栏，PRD §10 / UX-DR8）。命名保持「AI 解读」（2026-07-12 新增）。
- **Event rank chip (`{components.event-rank-chip}`)**：表示热点位置、来源数或热度维度，只能轻量使用，不可抢主标题。
- **Evidence row (`{components.evidence-row}`)**：`证据时间线` 中的每一行都应像编辑注脚，左侧用 `{colors.brand-primary}` 做细竖线，提示“这是可追溯证据，不是普通段落”。
- **Reaction chips**：市场反应只以 chip 进入视觉系统，不以整段红绿底展示，防止变成交易软件。
- **Primary button (`{components.primary-button}`)**：主按钮只用于真正的主动作，如“查看完整详情”“进入今日日报”，不能在首页泛滥。
- **Filter pill (`{components.filter-pill}`)**：筛选器默认轻，激活时才变成品牌色。
- **AI label (`{components.ai-label}`)**：AI 生成摘要或解释必须被明确标记，但这个标记只能表达“信息来源性质”，不能表达“更高级”。
- **Crash calendar page (`/crash-calendar`)**：大跌日历页（FR-16，v1.1），复用 event-card 无边框纵栏形态（UX-DR16）。三段结构：日历视图（大跌日高亮，海军蓝点标 + 跌幅 numeric 字体）→ 领跌板块榜（复用 `reaction-chip-down` 着色，守住"红绿只表达市场语义"红线，禁止整段红底）→ 前瞻收益表（`numeric` 字体 + T+1/T+5/T+20 列）。前瞻收益表上方必须显式 `editorial-reason-block` 标注「历史统计，非预测」（§10 advisory 护栏的视觉落地，非装饰）。新增表面，对齐 PRD §11.2。

## Do's and Don'ts

| Do | Don't |
|---|---|
| 让热点标题、解释、证据、市场反应形成清晰阅读顺序 | 把所有元信息堆成一个高密度信息墙 |
| 用红绿只表达涨跌与市场语义 | 把品牌主色做成行情红或行情绿 |
| 详情页像一篇可核查的编辑稿件 | 详情页像拼接资讯流或长截图拼盘 |
| 保持卡片结构稳定、重复、可扫描 | 每张热点卡片样式变化很大 |
| AI 标签明确但低调 | 用夸张高亮把“AI解读”做成营销卖点 |
