# Epic 5 Context: AI 分析层

<!-- Generated from planning artifacts (Sprint Change Proposal 2026-07-11). Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 5 adds three layers of AI-generated analysis to aguhot: a one-line `AI 解读` hook on each timeline card (event-level "why this is worth looking at"), an event-level `AI 深读` (impact / beneficiaries / risk) on the detail page, and a cross-event `趋势研判` on the daily digest and theme pages. All three are AI-labeled, traceable to evidence, versioned, and subject to operator sampling. This is the AI half of the Sprint Change Proposal 2026-07-11 pivot — it is what differentiates aguhot's timeline from a raw news feed. Success is measured by `AI 解读` coverage >= 95% (SM-7) and AI-misleading rate < 10% (SM-6), with AI copy kept short (SM-C3) and never optimized for length.

## Stories

- Story 5.1: 列表卡 AI 解读生成（首个 dev 任务 = 建 `LLMAdapter` 端口骨架）
- Story 5.2: 事件级 AI 深读
- Story 5.3a: 日报页 AI 趋势研判
- Story 5.3b: 主题页 AI 趋势研判（延后 v1.1，待 Q3 定案 + 日报 SM-6 连续 2 周达标）
- Story 5.4: AI 生成内容运营抽检

## Requirements & Constraints

- Each timeline entry gets a one-line (≤40 char) `AI 解读` with AI label; generation failure shows a missing-state, never blank; coverage >= 95%. (FR-1 AI 解读, SM-7, NFR-3)
- `AI 解读` is bound by the wording blacklist (禁 "涨停必看" / "明日机会" / "目标价" etc.); "AI 解读" itself is a compliance-sensitive term in financial context — PM neutralizes copy to "AI 点评" / "为何关注". (PRD §10, Sprint Change Proposal §10 risk)
- Detail page "为什么重要" block gets an AI `深读` (impact / beneficiaries / risk, three segments, AI-labeled); content must be consistent with the evidence timeline, never fabricating sourceless conclusions. (FR-4, NFR-2)
- Daily digest and theme pages get a cross-event AI `趋势研判`; it must cite the event set it relies on, never forging causality. (FR-10, FR-11)
- All AI-generated content (AI 解读 / 深读 / 研判 / summary / digest) carries the unified AI label and is operator-reviewable. (NFR-3, UX-DR8)
- Heavy compute and LLM calls run only as BullMQ jobs; the web request path never waits on an LLM. (AD-4)
- AI generations are versioned append-only records; the public side shows the current published version; the operator side sees the version chain. (AD-5)
- Operator sampling: operators can filter AI content by type, flag as misleading, trigger takedown or regeneration; misleading rate monitored by SM-6 (< 10%). (FR-15, Story 5.4)
- No fully-automatic publish without operator gate: timeline entries and AI content remain subject to `运营复核` sampling (PRD §6 red line).

## Technical Decisions

- **Where the code lives.** AI generation jobs live in `apps/worker` (explain jobs); LLM access via `LLMAdapter` port in `packages/core`; versioned records: `RecommendationReason` / `DeepRead` owned by `explanation` 模块（扩展职责），`TrendBriefing` owned by `digest`/`theme-linking` 模块；operator sampling in `apps/web/(operator)` + `review-workflow`. **`LLMAdapter` 端口当前 codebase 不存在**（仅 5 端口就位，`explain-service.ts` 明文 deferred），Story 5.1 首个 dev 任务 = 落地端口骨架（接口 + Stub + worker resolve，照抄 DigestAdapter 先例）。
- **Governed by AD-4, AD-5, AD-7, NFR-3/NFR-7.** AD-4: all three generations are BullMQ jobs. AD-5: 三实体各自独立 append-only 表（**不复用 `ExplanationVersion` 表**——其固定三段式 schema + NOT NULL `hotEventId` 不适用，`TrendBriefing` 甚至不挂 HotEvent）；版本链 = createdAt desc + id desc（沿用 `projectExplanation` tiebreaker）。AD-7: LLM access only through `LLMAdapter`（端口待建，见上）。NFR-3: 显式+隐式元数据标识；NFR-7: 每版保留 model id + prompt 版本 + 时间戳。
- **Single ownership boundary.** The explain module owns its generation records; it reads (never writes) `event-assembly`'s `HotEvent`, `source-ingest`'s `EvidenceSource`, `theme-linking`'s `Theme`, and the daily digest. Generated content attaches to these aggregates by id.
- **Data model.** `HOT_EVENT ||--o{ RECOMMENDATION_REASON`, `HOT_EVENT ||--o{ DEEP_READ`, `DAILY_DIGEST ||--o{ TREND_BRIEFING`, `THEME ||--o{ TREND_BRIEFING`, `TREND_BRIEFING }o--o{ HOT_EVENT : based_on`；三实体各自独立 append-only 表，自带版本链（不复用 `ExplanationVersion`，AD-5）。
- **Generation timing (PRD §12 Q7 closed).** `AI 解读` / `AI 深读` generate after event-assembly clusters evidence into a candidate `HotEvent` (candidate-stage generation, so operators can review AI content alongside the candidate); they are publicly visible only after `publication_status = published` (AD-6). Not generated on evidence ingest. `趋势研判` generates at daily-digest job / theme-page refresh time (depends on multiple published `HotEvent`s) and publishes with the digest/theme. Candidate-stage AI content is visible in the operator review console as review material but never enters public `published_timeline` pre-publish. **Timeline 重投影触发链**：`AI 解读` append 到 HotEvent 后，须触发该 hotEventId 的 `published_timeline` 增量重投影（method A：reason append job 内调 `refreshPublishedTimelineForEvent`，挂入事务或紧随其后 enqueue），否则首页 `AI 解读` stale。
- **Wording blacklist.** A shared blacklist constant enforces forbidden investment-advice phrasing across all three generation paths; generations violating it are rejected and retried or marked missing-state.
- **Stack & conventions.** BullMQ 5 + ioredis; LLM via `LLMAdapter` (provider deferred — adapter port only at spine level); UUIDv7; UTC; `trace_id` per job and record; `const … as const` unions; `import type`; `.js` relative imports.

## UX & Interaction Patterns

- **AI label (UX-DR8 revised).** All three AI content types carry the unified `{components.ai-label}`; `AI 解读` label is adjacent to its copy, visually separated from factual summary.
- **Timeline card slot (UX-DR4b).** The `AI 解读` hook renders in the timeline card (delivered by 4.2); 5.1 fills it. Missing-state shows a neutral placeholder, never blank.
- **Detail page deep-read block.** `AI 深读` sits under "为什么重要", three labeled segments (影响面 / 受益方 / 风险点), distinct from the factual summary and evidence timeline (UX-DR11 fact/explanation/uncertainty separation).
- **Digest/theme trend briefing.** `趋势研判` paragraph on daily digest and theme pages, citing the event set it synthesizes.
- **Operator sampling UI.** Review console filter by AI content type; flag-misleading action triggers takedown or regeneration; links back to the source event/digest/theme.
- **Voice and tone.** Restrained, verifiable, no hype. "AI 解读" copy neutralized to "AI 点评" / "为何关注" (PM finalization). Forbidden phrasing enforced by blacklist. AI copy kept short (SM-C3): `AI 解读` one line, `深读`/`研判` length-capped.

## Cross-Story Dependencies

- **Depends on Epic 4.** `AI 解读` (5.1) attaches to timeline entries produced by 4.1/4.2; the timeline card's `AI 解读` slot is rendered by 4.2 and filled by 5.1. Epic 4 must precede Epic 5.
- **Depends on Epic 1/2.** `AI 深读` (5.2) attaches to the hot-event detail page (Epic 1); `趋势研判` (5.3) attaches to the daily digest and theme pages (Epic 2).
- **Depends on existing review-workflow (Epic 1, FR-15).** Story 5.4 (operator sampling) reuses the `review-workflow` module and `publication_status` gate; it does not introduce a parallel review path (AD-6).
- **External gates.** Pending PM/Architect approval of Sprint Change Proposal 2026-07-11; pending PM "AI 解读" wording neutralization. (PRD §12 Q7 generation timing is now closed.) Both should be resolved before Epic 5 dev.
