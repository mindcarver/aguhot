import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AiLabel } from "@/components/chips";
import {
  getPrisma,
  listPublishedHotEvents,
  listPublishedThemeMemberships,
  newTraceId,
} from "@aguhot/core";
import type { ThemeRef } from "@aguhot/core";

export const metadata: Metadata = {
  title: "主题追踪",
};

/**
 * Theme continuity page — Story 2.3.
 *
 * Aggregates the published member events of one theme (slug) and presents them
 * as a CHRONOLOGICAL sequence (latestEvidenceAt ASC, earliest→latest) so
 * continuity reads as a narrative arc (epic: "a theme page aggregates multiple
 * events across time and presents them chronologically so continuity reads as a
 * sequence"). Each member event is a clickable link to its detail page (FR11,
 * the theme→detail half of the closed loop).
 *
 * Reads ONLY published_* read models (AD-3): listPublishedThemeMemberships
 * (published_hot_event_themes) to find which events belong to the slug, and
 * listPublishedHotEvents (published_hot_events) for the member summaries.
 * Never reads event_theme_sets / hot_events / evidence_*.
 *
 * Honest continuity (AC3 / epic: "absence as absence, never fabricated"): a slug
 * with NO published members → notFound() (404). Rendering an empty theme page
 * for a slug the system has not confirmed would fabricate a theme — a violation.
 * Real themes (>=1 published member) render the page; a theme whose members are
 * all taken down naturally re-404s (projection cleared → no members).
 *
 * Why force-dynamic + @aguhot/core import is safe for the build:
 *   - force-dynamic marks the route dynamic so Next evaluates it at REQUEST
 *     time, not BUILD time. getPrisma() reads DATABASE_URL at runtime; that
 *     call is never reached during `next build`, so the build stays
 *     DATABASE_URL-free.
 *
 * System-derived theme content carries the uniform <AiLabel/> (UX-DR8). The
 * title uses the editorial serif (font-display) reserved for theme/section/daily
 * titles. NFR: theme labels + member titles are concept-identity / factual,
 * never advisory. Return path: "← 返回" link to /topics + browser-native back
 * (full UX-DR12 scroll/filter context restoration is 2.5).
 */
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function ThemeContinuityPage({ params }: PageProps) {
  const { slug } = await params;

  const prisma = getPrisma();
  const traceId = newTraceId();

  // Read the membership map + the published event summaries (AD-3: only
  // published_* read models). Build the member set for this slug in JS.
  const [memberships, events] = await Promise.all([
    listPublishedThemeMemberships({ prisma, traceId }),
    listPublishedHotEvents({ prisma, traceId }),
  ]);

  // Find the hotEventIds whose membership items include this slug.
  const memberEventIds = new Set<string>();
  for (const m of memberships) {
    for (const item of m.items as ThemeRef[]) {
      if (item.slug === slug) {
        memberEventIds.add(m.hotEventId);
      }
    }
  }

  // AC3 honest continuity: a slug with no published members → 404 (never render
  // an empty theme page that would fabricate a theme the system has not
  // confirmed).
  if (memberEventIds.size === 0) {
    notFound();
  }

  // The member event summaries. Filter the published list to members of this
  // slug, then sort by latestEvidenceAt ASC (chronological sequence — epic:
  // continuity reads as a sequence from earliest to latest). Deterministic
  // tiebreaker by hotEventId so two members sharing the same latestEvidenceAt
  // resolve to a stable DOM order across loads.
  const memberEvents = events
    .filter((e) => memberEventIds.has(e.hotEventId))
    .sort(
      (a, b) =>
        a.latestEvidenceAt.getTime() - b.latestEvidenceAt.getTime() ||
        a.hotEventId.localeCompare(b.hotEventId),
    );

  // AC3 / I/O-matrix row 6 honest continuity: a slug whose membership rows
  // exist (memberEventIds non-empty, so the gate above was skipped) but whose
  // in-memory join against the published list yields zero members (all members
  // taken down between the two reads) → still 404, never a fabricated empty
  // page. Unify both empty outcomes (no membership at all / no surviving
  // published member) to notFound().
  if (memberEvents.length === 0) {
    notFound();
  }

  // Derive the display label for this slug from the membership items (shared
  // slug → take the first matching ThemeRef.label, which is consistent across
  // members under the deterministic stub; in general the first-seen label wins).
  let themeLabel = slug;
  for (const m of memberships) {
    for (const item of m.items as ThemeRef[]) {
      if (item.slug === slug && typeof item.label === "string" && item.label.trim() !== "") {
        themeLabel = item.label;
        break;
      }
    }
    if (themeLabel !== slug) break;
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      {/* Return link to the /topics directory. theme[slug]→/topics is a
          list→directory secondary navigation (not a UX-DR12 detail return), so
          it stays a bare <Link>; the UX-DR12 reading-context restoration
          landing point is the detail page BackLink (Story 2.5). href unchanged. */}
      <Link
        href="/topics"
        className="inline-flex items-center gap-1 text-sm text-ink-secondary hover:text-ink-primary"
      >
        <span aria-hidden>←</span> 返回主题目录
      </Link>

      <header className="mt-4 space-y-3">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-3xl font-bold leading-tight text-ink-primary">
            {themeLabel}
          </h1>
          <AiLabel />
        </div>
        <p className="text-sm text-ink-tertiary">
          按时间序列追踪该主题下的成员事件（从早到晚）。
        </p>
      </header>

      {/* Member events as a chronological sequence (latestEvidenceAt ASC). Each
          member links to its detail page (FR11). memberEvents is non-empty here
          — the empty case resolves to notFound() above (AC3 honest continuity). */}
      <section className="mt-10 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
          成员事件
        </h2>
        <ol role="list" className="space-y-3">
          {memberEvents.map((event) => (
            <li
              key={event.hotEventId}
              className="rounded-lg border border-border-hairline bg-surface-raised px-5 py-4"
            >
              <Link
                href={`/events/${event.hotEventId}`}
                className="group block space-y-1"
              >
                <p className="font-semibold text-ink-primary group-hover:text-brand">
                  {event.title}
                </p>
                <p className="font-mono text-xs text-ink-tertiary">
                  {formatDateTime(event.latestEvidenceAt)} · 来源数 {event.evidenceCount}
                </p>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/**
 * Locale-stable UTC format (avoid locale-dependent toLocaleString). YYYY-MM-DD
 * HH:mm UTC is consistent across build-time TZ and runtime TZ. Shared shape with
 * the detail page formatter.
 */
function formatDateTime(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
