import type { Metadata } from "next";
import Link from "next/link";

import { AiLabel } from "@/components/chips";
import {
  getPrisma,
  getPublishedDailyDigest,
  listPublishedDailyDigestCoverageDates,
  listPublishedHotEvents,
  newTraceId,
} from "@aguhot/core";
import type { DailyDigestEntry } from "@aguhot/core";

export const metadata: Metadata = {
  title: "日报",
};

/**
 * Daily digest page — Story 2.4.
 *
 * Replaces the Story 1.2 static placeholder. This is the dynamic daily-digest
 * page: it reads the published daily-digest read model (published_daily_digests
 * via getPublishedDailyDigest / listPublishedDailyDigestCoverageDates, AD-3 —
 * never daily_digests / hot_events / evidence_*). The primary nav "日报" target
 * resolves here (the main image "日报" entry must not be a dead link — closed
 * loop, FR10).
 *
 * Default view: the LATEST published digest (the max coverageDate from
 * listPublishedDailyDigestCoverageDates). Date selector: ?date=YYYY-MM-DD picks
 * a specific coverageDate (invalid/malformed → ignored, falls back to latest).
 *
 * Each entry is a clickable link to /events/{hotEventId} (FR10, the daily→detail
 * jump). Entries are already sorted by evidenceCount DESC at generation time
 * (strongest signal first).
 *
 * Honest degradation (AC3 / epic honesty): when no digest exists for the
 * coverageDate (V1 prod: daily-digest worker resolves no adapter → no digest
 * generated / coverageDate has no eligible events), the page renders an explicit
 * degraded line "该覆盖日期的日报尚未生成。" + the current coverage scope ("已发布
 * N 条热点事件，日报生成中。") — never fabricated entries, never blank.
 *
 * Why force-dynamic + @aguhot/core import is safe for the build:
 *   - `export const dynamic = "force-dynamic"` marks the route dynamic so Next
 *     evaluates it at REQUEST time, not BUILD time. getPrisma() reads
 *     DATABASE_URL at runtime; that call is never reached during `next build`,
 *     so the public web build stays DATABASE_URL-free (same mechanism as the
 *     homepage + detail route + /topics).
 *
 * System-derived digest content carries the uniform <AiLabel/> (UX-DR8). NFR:
 * conclusions are descriptive, never advisory.
 */
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ date?: string }>;
}

export default async function DailyDigestPage({ searchParams }: PageProps) {
  const prisma = getPrisma();

  // Parse the ?date= query param (YYYY-MM-DD). Invalid/malformed → undefined
  // (fall back to latest).
  const params = await searchParams;
  const requestedDate = parseCoverageDate(params.date);

  // Resolve the target coverageDate: a valid ?date= → that date; otherwise the
  // latest published digest's coverageDate (or undefined if no digests exist).
  let coverageDate: Date | undefined;
  if (requestedDate !== undefined) {
    coverageDate = requestedDate;
  } else {
    const coverageDates = await listPublishedDailyDigestCoverageDates({
      prisma,
      traceId: newTraceId(),
    });
    coverageDate = coverageDates[0]?.coverageDate;
  }

  // Read the published digest for the target coverageDate (if any).
  const digest =
    coverageDate !== undefined
      ? await getPublishedDailyDigest({
          prisma,
          traceId: newTraceId(),
          coverageDate,
        })
      : null;

  // For the degraded state: count the day's eligible published events
  // (latestEvidenceAt UTC day = coverageDate) so the page shows the current
  // coverage scope. Falls back to "今日" when no coverageDate is resolved.
  let eligibleCount = 0;
  let degradedScopeDate: Date;
  if (coverageDate !== undefined) {
    degradedScopeDate = coverageDate;
  } else {
    degradedScopeDate = new Date();
  }
  if (digest === null) {
    const allPublished = await listPublishedHotEvents({
      prisma,
      traceId: newTraceId(),
    });
    eligibleCount = countByCoverageDay(allPublished, degradedScopeDate);
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      {/* Return link to the homepage. daily→home is a list→list secondary
          navigation (not a UX-DR12 detail return), so it stays a bare <Link>;
          the UX-DR12 reading-context restoration landing point is the detail
          page BackLink (Story 2.5). href unchanged. */}
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-ink-secondary hover:text-ink-primary"
      >
        <span aria-hidden>←</span> 返回首页
      </Link>

      <header className="mt-4 space-y-3">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-4xl font-semibold tracking-tight text-ink-primary">
            日报
          </h1>
          {digest !== null ? <AiLabel /> : null}
        </div>
        <p className="text-lg text-ink-secondary">AGUHOT · 每日热点精选</p>
      </header>

      {digest !== null ? (
        <DigestContent digest={digest} />
      ) : (
        <DegradedContent
          coverageDate={degradedScopeDate}
          eligibleCount={eligibleCount}
        />
      )}
    </div>
  );
}

/**
 * Render the digest: coverage date + generation time header, then one clickable
 * row per entry (already sorted by evidenceCount DESC at generation time).
 */
function DigestContent({
  digest,
}: {
  digest: {
    coverageDate: Date;
    entries: DailyDigestEntry[];
    source: string;
    generatedAt: Date;
  };
}) {
  return (
    <section className="mt-10 space-y-4">
      <dl className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-sm text-ink-tertiary">
        <div>
          <dt className="inline">覆盖日期 </dt>
          <dd className="inline text-ink-primary">
            {formatDate(digest.coverageDate)}
          </dd>
        </div>
        <div>
          <dt className="inline">生成时间 </dt>
          <dd className="inline text-ink-primary">
            {formatDateTime(digest.generatedAt)}
          </dd>
        </div>
      </dl>

      <ol className="mt-4 space-y-3">
        {digest.entries.map((entry) => (
          <li
            key={entry.hotEventId}
            className="rounded-lg border border-border-hairline bg-surface-raised px-5 py-4 transition-colors hover:bg-surface-muted"
          >
            <Link
              href={`/events/${entry.hotEventId}`}
              className="block space-y-2"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-semibold text-ink-primary">
                  {entry.title}
                </h2>
                <span className="shrink-0 font-mono text-xs text-ink-tertiary">
                  {entry.evidenceCount} 来源
                </span>
              </div>
              <p className="text-sm text-ink-secondary">{entry.conclusion}</p>
              <p className="font-mono text-xs text-ink-tertiary">
                最近证据 {formatDateTime(new Date(entry.latestEvidenceAt))}
              </p>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Render the honest degraded state: the coverage date with no digest + the
 * current coverage scope (eligible published event count for that day). Never
 * blank, never fabricated.
 */
function DegradedContent({
  coverageDate,
  eligibleCount,
}: {
  coverageDate: Date;
  eligibleCount: number;
}) {
  return (
    <section className="mt-10 space-y-3">
      <h2 className="text-xl font-semibold text-ink-primary">当前状态</h2>
      <p className="text-base text-ink-secondary">
        该覆盖日期的日报尚未生成。
      </p>
      <p className="text-sm text-ink-tertiary">
        当前覆盖范围：{formatDate(coverageDate)} 已发布 {eligibleCount} 条热点事件，日报生成中。
      </p>
    </section>
  );
}

// --- helpers -----------------------------------------------------------------

/**
 * Parse a ?date=YYYY-MM-DD query param into a UTC Date at that day's start.
 * Returns undefined if the param is missing, empty, or not a valid YYYY-MM-DD
 * date (the caller falls back to the latest digest). Conservative: rejects
 * partial/ambiguous formats rather than guessing.
 */
function parseCoverageDate(raw: string | undefined): Date | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  // Strict YYYY-MM-DD check (exactly 10 chars, digits + dashes in the right
  // places).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  // Parse as UTC midnight to avoid TZ drift. Date.UTC returns NaN for invalid
  // dates (e.g. month 13).
  const [y, m, d] = raw.split("-");
  const ts = Date.UTC(
    Number(y),
    Number(m) - 1, // JS months are 0-indexed
    Number(d),
  );
  if (Number.isNaN(ts)) return undefined;
  return new Date(ts);
}

/**
 * Count published events whose latestEvidenceAt UTC day = coverageDate UTC day.
 * Mirrors the digest-service filterByCoverageDay logic (the /daily degraded
 * state shows the same "eligible" count the generator would use).
 */
function countByCoverageDay(
  events: { latestEvidenceAt: Date }[],
  coverageDate: Date,
): number {
  const covY = coverageDate.getUTCFullYear();
  const covM = coverageDate.getUTCMonth();
  const covD = coverageDate.getUTCDate();
  let count = 0;
  for (const e of events) {
    const t = e.latestEvidenceAt;
    if (
      t.getUTCFullYear() === covY &&
      t.getUTCMonth() === covM &&
      t.getUTCDate() === covD
    ) {
      count += 1;
    }
  }
  return count;
}

/**
 * Locale-stable UTC date format (YYYY-MM-DD). Consistent across build-time TZ
 * and runtime TZ. Shared shape with the detail page formatter.
 */
function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Locale-stable UTC format (avoid locale-dependent toLocaleString). YYYY-MM-DD
 * HH:mm UTC is consistent across build-time TZ and runtime TZ. Shared shape with
 * the feed card + detail page formatter.
 */
function formatDateTime(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
