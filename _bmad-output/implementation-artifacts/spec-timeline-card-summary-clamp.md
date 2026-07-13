---
title: '时间流卡片摘要正文截断（line-clamp-3）'
type: 'bugfix'
created: '2026-07-13'
status: 'done'
route: 'one-shot'
---

# 时间流卡片摘要正文截断（line-clamp-3）

## Intent

**Problem:** 真实财经 / RSSHub 源下，RSS `<description>` 往往是整篇文章正文；它经 `EvidenceRecord.summary` → explain 投影 `deriveSummary`（标题＋最新一条记录的 summary）落到卡片 `summary` 字段，而卡片渲染处没有任何截断，导致时间流卡片把整篇新闻正文「全部贴出」，与参考站「只贴摘要、不贴全文」的形态不符。

**Approach:** 卡片摘要 `<p>` 加 Tailwind `line-clamp-3`——卡片只显示 3 行预览，全文仍在详情页 `/events/[hotEventId]`。纯显示层、不动数据、不动管线。项目已有同款用法（`ai-content/page.tsx:134`），Tailwind v4 内置、无需插件。源头真正的摘要生成（LLM digest 管线）是另一个 story，已登记 deferred-work，本次不做。

## Suggested Review Order

改动本体——摘要 `<p>` 加 `line-clamp-3`，3 行截断（空字符串守卫不变，长摘要才生效）：
- [timeline-card.tsx:132](../../apps/web/app/(public)/_components/timeline-card.tsx#L132)

为什么——数据链（RSS `<description>` → `EvidenceRecord.summary` → `deriveSummary` → 卡片）与「只贴预览」的理由写在 doc 注释里：
- [timeline-card.tsx:42](../../apps/web/app/(public)/_components/timeline-card.tsx#L42)
