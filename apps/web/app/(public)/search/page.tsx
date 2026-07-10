import type { Metadata } from "next";
import Link from "next/link";

import { FilterPill } from "@/components/chips";
import {
  getPrisma,
  newTraceId,
  searchPublished,
} from "@aguhot/core";

import { EventCard } from "../_components/event-card";
import { SearchBox } from "../_components/search-box";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "搜索",
};

/**
 * Maximum query length after trim. Queries longer than this are truncated
 * (silent — no error). Guards against pathological input amplifying in-memory
 * match cost, and bounds the URL length. 128 chars is generous for a hot-event
 * / theme keyword search (Chinese or Latin).
 */
const MAX_QUERY_LEN = 128 as const;

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

/**
 * Trim + truncate the raw `q` search param to a safe matchable query. Returns
 * the empty string for absent / whitespace-only / empty-after-trim input (the
 * page renders the empty-query guide state and does NOT call searchPublished).
 * This is the trust-boundary input validation: public input, never trust raw.
 */
function parseSearchQuery(raw: string | undefined): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  // Truncate to MAX_QUERY_LEN (silent — no error surfaced). Code-point-safe:
  // Array.from splits on Unicode code points, so an astral character (CJK
  // Extension B / emoji — two UTF-16 code units, a surrogate pair) is NOT
  // split at the boundary the way trimmed.slice(0, 128) would split a lone
  // surrogate. For BMP characters (one code point = one code unit, e.g.
  // standard CJK) Array.from and .slice agree; the difference only matters
  // when the 128th code unit falls inside a surrogate pair.
  if (Array.from(trimmed).length <= MAX_QUERY_LEN) return trimmed;
  return Array.from(trimmed).slice(0, MAX_QUERY_LEN).join("");
}

/**
 * Public search results page — Story 3.1 (FR12).
 *
 * Reads ONLY published_* read models (AD-3) via searchPublished (which joins
 * listPublishedHotEvents + listPublishedHotEventExplanations +
 * listPublishedThemeMemberships in JS). Never reads hot_events /
 * explanation_versions / event_theme_sets / evidence_* (AD-3). Anonymous by
 * default (AD-8): no login dependency anywhere on the search path.
 *
 * Why force-dynamic + @aguhot/core import is safe for the build:
 *   - force-dynamic marks the route dynamic so Next evaluates it at REQUEST
 *     time, not BUILD time. getPrisma() reads DATABASE_URL at runtime; that
 *     call is never reached during `next build`, so the build stays
 *     DATABASE_URL-free (same mechanism as the home / detail / topics / daily
 *     routes).
 *
 * Three honest states (NFR: never fabricate):
 *   (1) Empty query (no q / empty / pure whitespace) → render SearchBox +
 *       "输入关键词搜索热点事件与主题。" guide. Does NOT render results or
 *       no-match text.
 *   (2) Non-empty query, zero hits → "未找到与「{q}」相关的热点或主题。"
 *       no-match text + a link back home + a SearchBox (so the reader can try a
 *       different word in place).
 *   (3) Non-empty query with hits → grouped "热点事件 (N)" section mapping
 *       EventCard (reused, link /events/{id}) + "主题 (N)" section mapping
 *       FilterPill (reused, link /topics/{slug}). Event hits are ranked by
 *       searchPublished (title tier 0 > summary tier 1, recency within tier);
 *       theme hits by memberCount DESC, label ASC.
 *
 * getPrisma throws when DATABASE_URL is missing at runtime → loud failure (the
 * error propagates to a route error), NOT a silent empty state. DB is core
 * infra; its absence is an incident, not graceful degradation (same as home /
 * detail / topics / daily).
 */
export default async function SearchPage({ searchParams }: PageProps) {
  const { q: raw } = await searchParams;
  const q = parseSearchQuery(raw);

  // Empty query → guide state. Do NOT call searchPublished (no DB read needed).
  if (q === "") {
    return (
      <div className="mx-auto max-w-3xl px-6 py-12">
        <header className="space-y-4">
          <h1 className="text-4xl font-bold tracking-tight text-ink-primary">
            搜索
          </h1>
          <p className="text-lg text-ink-secondary">搜索热点事件与主题。</p>
        </header>
        <section className="mt-8">
          <SearchBox />
        </section>
        <p className="mt-8 text-sm text-ink-tertiary">
          输入关键词搜索热点事件与主题。
        </p>
      </div>
    );
  }

  // Request-time DB read. getPrisma() throws loudly if DATABASE_URL is missing —
  // that is intentional (DB is core infra, not graceful-degradation territory).
  const prisma = getPrisma();
  const traceId = newTraceId();
  const result = await searchPublished({ prisma, traceId, query: q });

  const hasHits = result.events.length > 0 || result.themes.length > 0;

  // No-match state (AC2): honest no-result feedback + a path back home + an
  // in-place SearchBox so the reader can change keywords.
  if (!hasHits) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-12">
        <header className="space-y-4">
          <h1 className="text-4xl font-bold tracking-tight text-ink-primary">
            搜索
          </h1>
        </header>
        <section className="mt-8">
          <SearchBox defaultValue={q} />
        </section>
        <div className="mt-12 space-y-3">
          <p className="text-ink-secondary">
            未找到与「{q}」相关的热点或主题。
          </p>
          <Link
            href="/"
            className="inline-flex items-center rounded-full bg-brand px-3 py-1 text-sm text-brand-foreground"
          >
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  // Hit state: grouped events + themes.
  const now = new Date();
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header className="space-y-4">
        <h1 className="text-4xl font-bold tracking-tight text-ink-primary">
          搜索
        </h1>
      </header>

      {/* Persistent search box so the reader can refine the query in place. */}
      <section className="mt-8">
        <SearchBox defaultValue={q} />
      </section>

      {/* Event hits (AC1): title tier 0 > summary tier 1, recency within tier. */}
      {result.events.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
            热点事件 ({result.events.length})
          </h2>
          <ul role="list" className="mt-4 space-y-3">
            {result.events.map((ev) => (
              <EventCard
                key={ev.hotEventId}
                hotEventId={ev.hotEventId}
                title={ev.title}
                evidenceCount={ev.evidenceCount}
                latestEvidenceAt={ev.latestEvidenceAt}
                publishedAt={ev.publishedAt}
                now={now}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {/* Theme hits (AC1): memberCount DESC, label ASC. FilterPill links to
          /topics/{slug}. */}
      {result.themes.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
            主题 ({result.themes.length})
          </h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {result.themes.map((th) => (
              <FilterPill
                key={th.slug}
                href={`/topics/${encodeURIComponent(th.slug)}`}
              >
                {th.label}
                {/* Visible count for sighted readers + a visually-hidden unit so
                    a screen reader announces the count meaningfully (e.g.
                    "芯片供应链 · 1 个相关事件") instead of a bare number. */}
                <span aria-hidden="true"> · {th.memberCount}</span>
                <span className="sr-only">（{th.memberCount} 个相关事件）</span>
              </FilterPill>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
