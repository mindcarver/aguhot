import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AiLabel, FilterPill, ReactionChip, TagChip } from "@/components/chips";
import {
  getPrisma,
  getPublishedHotEventDetail,
  isFollowing,
  FollowTargetKind,
  newTraceId,
  type AssociationItem,
} from "@aguhot/core";

import { readSession } from "@/lib/session";

import { BackLink } from "../../_components/back-link";
import { FollowButton } from "../../_components/follow-button";

export const metadata: Metadata = {
  title: "热点事件详情",
};

/**
 * Public hot-event detail page — Story 1.8 (detail + explanation + evidence
 * timeline) + Story 2.1 (market-reaction block).
 *
 * This is the first public DETAIL route to READ the published read models
 * (published_hot_events + published_hot_event_explanations +
 * published_hot_event_evidence + published_hot_event_reactions), via
 * getPublishedHotEventDetail. It completes the "read the summary, market
 * reaction, and evidence timeline" half of the epic's detail AC.
 *
 * Why force-dynamic + @aguhot/core import is safe for the build:
 *   - `export const dynamic = "force-dynamic"` marks the route dynamic so Next
 *     evaluates it at REQUEST time, not BUILD time. getPrisma() reads
 *     DATABASE_URL at runtime; that call is never reached during `next build`,
 *     so the public web build stays DATABASE_URL-free (same mechanism as the
 *     1.7 homepage and the (operator)/console route). (public)/layout.tsx and
 *     /design stay static (never import core); /daily /topics /favorites are
 *     also force-dynamic, so `/`, `/events/[hotEventId]`, `/daily`, `/topics`,
 *     `/topics/[slug]`, `/search`, and `/favorites` are all dynamic.
 *
 * Three first-screen partitions (AC1):
 *   - 发生了什么 (what happened): title + source count + time FACTS. Always
 *     rendered from the read model — facts never depend on the explanation.
 *   - 为什么重要 (why it matters): system-derived explanation, or an honest
 *     "系统解释生成中" degraded line when no explanation was projected yet.
 *   - 当前仍不确定什么 (what remains uncertain): same degraded-line rule.
 *   The system-derived explanation partitions carry the uniform <AiLabel/> (AC3,
 *   same component as the operator console — public/operator identical).
 *
 * Market-reaction block (Story 2.1, AC2/AC3): two <ReactionChip/>s (price/
 * volume + sector/limit-up) plus a shared tradingSession time context when a
 * snapshot was projected; an honest "市场反应数据暂不可用。" degraded line when no
 * snapshot exists (V1 prod: adapter resolves to none → prod degrades honestly).
 * UX-DR7: reaction enters ONLY as chips, never a full red/green card. NFR:
 * values are descriptive, never advisory.
 *
 * Evidence timeline (AC2): one row per source, chronological (publishedAt ASC,
 * nulls last — the projection already assigned `position` in that order). Each
 * row shows source name, time (font-mono), summary, and either "原文链接 ↗"
 * (url present → available) or an "无原始链接" badge (url missing → unavailable).
 * A row is NEVER silently dropped for a missing link (AC2: dead links keep the
 * record with a clearly marked status).
 *
 * AD-8: no auth, no /login redirect. Unpublished id (no published_hot_events
 * row) → getPublishedHotEventDetail returns null → notFound() (404). Candidate /
 * rejected / taken-down titles never leak.
 *
 * NFR: no investment-advice wording. The deterministic explanation text stays
 * descriptive (it is generated from real evidence, never fabricates). The page
 * renders only what the read model carries.
 */
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ hotEventId: string }>;
}

export default async function PublicEventDetailPage({ params }: PageProps) {
  const { hotEventId } = await params;

  // Request-time DB read. getPrisma() throws loudly if DATABASE_URL is missing
  // (DB is core infra; its absence is an incident, not graceful degradation).
  const prisma = getPrisma();
  const detail = await getPublishedHotEventDetail({
    prisma,
    traceId: newTraceId(),
    hotEventId,
  });

  // Unpublished id (candidate / rejected / taken_down / unknown): no summary
  // row in the read model → 404. The title/content of non-published events
  // never leaks (AD-8). notFound() throws Next's 404 — handled by the framework.
  if (detail === null) {
    notFound();
  }

  // Story 3.2: read the session (if any) + the follow state for this event.
  // Anonymous → no extra isFollowing DB read (initialIsFollowing stays false,
  // FollowButton renders 「收藏」 + the deferred-login dialog).
  const session = await readSession();
  const following =
    session !== null
      ? await isFollowing({
          prisma,
          traceId: newTraceId(),
          userAccountId: session.accountId,
          ref: { kind: FollowTargetKind.HotEvent, hotEventId },
        })
      : false;

  const hasExplanation = detail.explanation !== null;
  // AC3 + 1.8 defer: the uniform <AiLabel> marks SYSTEM-derived content only.
  // An operator-authored (source="human") explanation is NOT system-derived, so
  // it must NOT carry the AI label (gating: source !== "human"). template/ai
  // sources carry the label (uniform, identical on public and operator). When
  // there is no explanation (degraded state), no label is shown.
  const isAiSourced =
    detail.explanation !== null && detail.explanation.source !== "human";
  const hasTags = detail.tags.length > 0;
  // Story 2.1: the market-reaction block. Null when the worker has not produced
  // a snapshot (V1 prod: adapter resolves to none) → honest degraded state (AC3).
  const reaction = detail.reaction;

  // Story 2.2: the association block. Null/empty when generateAssociations has
  // not produced a set (V1 prod: no worker, no adapter) → honest degraded state
  // (AC3). When present, group items by kind (concept/industry/stock) and render
  // each as a FilterPill link to the filtered feed (AC1 non-dead-link).
  const associations = detail.associations;
  const associationItems = associations?.items ?? [];
  const conceptItems = associationItems.filter((i) => i.kind === "concept");
  const industryItems = associationItems.filter((i) => i.kind === "industry");
  const stockItems = associationItems.filter((i) => i.kind === "stock");
  const hasAssociations = associationItems.length > 0;

  // Story 2.3: the theme membership block. Null/empty when generateThemes has
  // not produced a set (V1 prod: theme-backfill worker resolves no adapter) →
  // honest degraded state (AC3). When present, each theme is a clickable
  // FilterPill link to /topics/{slug} (FR9, the theme-continuity jump).
  const themes = detail.themes;
  const themeItems = themes?.items ?? [];
  const hasThemes = themeItems.length > 0;

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      {/* Detail return path — UX-DR12 reading-context restoration (Story 2.5)
          + Story 3.4 source-aware explicit search-return entry (AC2).
          BackLink restores the originating list URL + scroll via sessionStorage
          (Story 2.5 infra, byte-identical). When the reader came from search
          (`/search?q=…`), BackLink renders the explicit 「返回搜索结果」 entry
          carrying the original query (AC2 — page-level, history-independent,
          survives reload / direct-visit-from-search / bfcache miss). All other
          origins (home `/?window=…` / theme `/topics/{slug}` / daily
          `/daily?date=…`) keep the default 「返回首页」 label. Direct load /
          external referrer / private mode → falls back to "/" (byte-identical
          to the prior bare link), so existing href assertions stay green. SSR
          renders href={fallback} + children label (fromHref starts null); the
          captured originating URL is read post-hydration, and the label may
          switch to searchLabel at the same render. href + scroll restore still
          go through the 2.5 infrastructure (AC1). */}
      <BackLink
        fallback="/"
        searchLabel={<><span aria-hidden>←</span> 返回搜索结果</>}
        className="inline-flex items-center gap-1 text-sm text-ink-secondary hover:text-ink-primary"
      >
        <span aria-hidden>←</span> 返回首页
      </BackLink>

      {/* Title — a fact, not system-derived, so no AiLabel here. */}
      <h1 className="mt-4 font-display text-3xl font-bold leading-tight text-ink-primary">
        {detail.title}
      </h1>

      {/* Operator-authored tags (Story 1.9). Display-only chips under the title.
          Rendered ONLY when the projected tag set is non-empty (NFR: empty state
          never renders placeholder chips). Not a feed filter (Epic 2.2). */}
      {hasTags ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {detail.tags.map((tag) => (
            <TagChip key={tag}>{tag}</TagChip>
          ))}
        </div>
      ) : null}

      {/* Story 3.2: FollowButton under the title. Anonymous → opens the
          deferred-login dialog; logged-in → toggles follow. Cross-page
          consistency: the feed card and this button read the same
          (accountId, hot_event, hotEventId) truth. */}
      <div className="mt-4">
        <FollowButton
          followRef={{ kind: FollowTargetKind.HotEvent, hotEventId }}
          initialIsFollowing={following}
          isLoggedIn={session !== null}
        />
      </div>

      {/* 发生了什么 — facts partition. Source count + times, always rendered. */}
      <section className="mt-8 space-y-3 rounded-lg border border-border-hairline bg-surface-raised px-5 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
          发生了什么
        </h2>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-sm text-ink-tertiary">
          <div>
            <dt className="inline">来源数 </dt>
            <dd className="inline text-ink-primary">{detail.evidenceCount}</dd>
          </div>
          <div>
            <dt className="inline">最近更新 </dt>
            <dd className="inline">{formatDateTime(detail.latestEvidenceAt)}</dd>
          </div>
          <div>
            <dt className="inline">发布于 </dt>
            <dd className="inline">{formatDateTime(detail.publishedAt)}</dd>
          </div>
        </dl>
      </section>

      {/* 为什么重要 — system-derived explanation, or honest degraded state. */}
      <section className="mt-6 space-y-3 rounded-lg border border-border-hairline bg-surface-base px-5 py-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
            为什么重要
          </h2>
          {isAiSourced ? <AiLabel /> : null}
        </div>
        {hasExplanation ? (
          <p className="text-base leading-relaxed text-ink-primary">
            {detail.explanation!.whyItMatters}
          </p>
        ) : (
          <p className="text-base text-ink-tertiary">系统解释生成中。</p>
        )}
      </section>

      {/* 当前仍不确定什么 — system-derived, or honest degraded state. */}
      <section className="mt-6 space-y-3 rounded-lg border border-border-hairline bg-surface-base px-5 py-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
            当前仍不确定什么
          </h2>
          {isAiSourced ? <AiLabel /> : null}
        </div>
        {hasExplanation ? (
          <p className="text-base leading-relaxed text-ink-primary">
            {detail.explanation!.uncertainties}
          </p>
        ) : (
          <p className="text-base text-ink-tertiary">系统解释生成中。</p>
        )}
      </section>

      {/* Market reaction (Story 2.1, AC2/AC3). Two signal chips + a shared
          tradingSession time context when a snapshot was projected; an honest
          degraded line when no snapshot exists (V1 prod: adapter resolves to
          none). UX-DR7: reaction enters the UI ONLY as chips (never a full red/
          green card), and every chip pairs color with a text label (a11y floor).
          NFR: values are descriptive (change percent / sector / limit-up count),
          never advisory. */}
      <section className="mt-6 space-y-3 rounded-lg border border-border-hairline bg-surface-base px-5 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
          市场反应
        </h2>
        {reaction !== null ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <ReactionChip
                tone={reaction.priceVolume.tone as "up" | "down" | "flat"}
                value={reaction.priceVolume.value}
              />
              <ReactionChip
                tone={reaction.sectorLimitUp.tone as "up" | "down" | "flat"}
                value={reaction.sectorLimitUp.value}
              />
            </div>
            <p className="font-mono text-xs text-ink-tertiary">
              交易时段 {formatDateTime(reaction.tradingSession)}
            </p>
          </div>
        ) : (
          <p className="text-base text-ink-tertiary">市场反应数据暂不可用。</p>
        )}
      </section>

      {/* Associations (Story 2.2, AC1/AC2/AC3). Concept/industry/stock items
          grouped by kind, each rendered as a clickable FilterPill link to the
          filtered feed (`/?<kind>=<label>` — the V1 click-through destination).
          Provenance line "关联依据：系统映射" makes the explicit mapping basis
          observable (AC2). Honest degraded line when no set was projected (V1
          prod: no worker, no adapter → AC3, never fabricated items). NFR: labels
          are entity-identity only, never advisory. */}
      <section className="mt-6 space-y-3 rounded-lg border border-border-hairline bg-surface-base px-5 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
          关联
        </h2>
        {hasAssociations ? (
          <div className="space-y-3">
            {conceptItems.length > 0 ? (
              <AssociationGroup
                title="概念"
                items={conceptItems}
                kind="concept"
              />
            ) : null}
            {industryItems.length > 0 ? (
              <AssociationGroup
                title="行业"
                items={industryItems}
                kind="industry"
              />
            ) : null}
            {stockItems.length > 0 ? (
              <AssociationGroup title="个股" items={stockItems} kind="stock" />
            ) : null}
            <p className="text-xs text-ink-tertiary">关联依据：系统映射</p>
          </div>
        ) : (
          <p className="text-base text-ink-tertiary">
            暂无已确认的概念 / 行业 / 个股关联。
          </p>
        )}
      </section>

      {/* Theme membership (Story 2.3, AC4/AC2/AC3). Each theme is a clickable
          FilterPill link to /topics/{slug} (FR9, the theme-continuity jump —
          the detail→theme half of the closed loop). Provenance line
          "关联依据：系统映射" makes the explicit mapping basis observable (AC2).
          Honest degraded line when no set was projected (V1 prod: theme-backfill
          worker resolves no adapter → AC3, never fabricated themes). NFR: labels
          are theme-concept identity only, never advisory. */}
      <section className="mt-6 space-y-3 rounded-lg border border-border-hairline bg-surface-base px-5 py-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
            主题
          </h2>
          {hasThemes ? <AiLabel /> : null}
        </div>
        {hasThemes ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {themeItems.map((item) => (
                <FilterPill
                  key={item.slug}
                  href={`/topics/${encodeURIComponent(item.slug)}`}
                >
                  {item.label}
                </FilterPill>
              ))}
            </div>
            <p className="text-xs text-ink-tertiary">关联依据：系统映射</p>
          </div>
        ) : (
          <p className="text-base text-ink-tertiary">暂无已确认的主题关联。</p>
        )}
      </section>

      {/* Evidence timeline (AC2). One row per source, chronological. */}
      <section className="mt-10 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
          证据时间线
        </h2>
        {detail.evidence.length > 0 ? (
          <ol role="list" className="space-y-4">
            {detail.evidence.map((row) => (
              <li
                key={row.id}
                className="border-l-2 border-brand bg-surface-raised px-5 py-4"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-semibold text-ink-primary">
                    {row.sourceName}
                  </span>
                  <time className="font-mono text-xs text-ink-tertiary">
                    {row.publishedAt === null ? "时间未知" : formatDateTime(row.publishedAt)}
                  </time>
                </div>
                {row.summary !== null && row.summary.trim() !== "" ? (
                  <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
                    {row.summary}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-ink-tertiary">（无摘要）</p>
                )}
                <div className="mt-3">
                  {row.linkStatus === "available" && row.url !== null ? (
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-medium text-brand"
                    >
                      原文链接 <span aria-hidden>↗</span>
                    </a>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-tertiary">
                      无原始链接
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-ink-tertiary">暂无证据行。</p>
        )}
      </section>
    </div>
  );
}

/**
 * One association group (concept / industry / stock). Renders the group title
 * + the items as FilterPill links to the filtered feed. Each link's href is
 * `/?<kind>=<label>` (URL-encoded) — the V1 click-through destination (epic:
 * every associated item has a clear click-through destination; dead links are
 * defects). The feed honors the dimension via a JS filter (Story 2.2 page.tsx),
 * so the link is a real filter, not a dead link (AC1).
 *
 * Only groups with >=1 confirmed item are rendered (AC3: a missing dimension is
 * omitted, never fabricated).
 */
function AssociationGroup({
  title,
  items,
  kind,
}: {
  title: string;
  items: AssociationItem[];
  kind: "concept" | "industry" | "stock";
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-ink-secondary">{title}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <FilterPill
            key={`${kind}:${item.label}`}
            href={`/?${kind}=${encodeURIComponent(item.label)}`}
          >
            {item.label}
          </FilterPill>
        ))}
      </div>
    </div>
  );
}

/**
 * Locale-stable UTC format (avoid locale-dependent toLocaleString). YYYY-MM-DD
 * HH:mm UTC is consistent across build-time TZ and runtime TZ. Shared shape with
 * the feed card formatter.
 */
function formatDateTime(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
