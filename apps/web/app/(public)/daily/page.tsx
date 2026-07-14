import type { Metadata } from "next";
import Link from "next/link";

import { AiLabel } from "@/components/chips";
import { stripTags } from "@/lib/utils";
import {
  DAILY_CATEGORIES,
  getPrisma,
  getPublishedDailyDigest,
  getPublishedTrendBriefing,
  listPublishedDailyDigestCoverageDates,
  listPublishedHotEvents,
  newTraceId,
} from "@aguhot/core";
import type { DailyDigestEntry, PublishedTrendBriefing } from "@aguhot/core";

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
  // coverageDates is always fetched (cheap) so DigestContent can render the
  // 前一日/后一日 navigation across published digest days.
  const coverageDates = await listPublishedDailyDigestCoverageDates({
    prisma,
    traceId: newTraceId(),
  });
  let coverageDate: Date | undefined;
  if (requestedDate !== undefined) {
    coverageDate = requestedDate;
  } else {
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

  // Read the published AI 趋势研判 (trend briefing) for the target coverageDate
  // (Story 5.3). Null when generateTrendBriefing has not produced a briefing (V1
  // prod: daily-digest worker resolves no llmAdapter → never produced, OR the
  // coverageDate has no eligible events) — <DigestContent> renders the honest
  // degraded state ("AI 趋势研判生成中。") in that case. Only fetched when a digest
  // exists (the trend briefing renders inside <DigestContent>, so a missing digest
  // means <DegradedContent> renders and the briefing is moot).
  const trendBriefing =
    coverageDate !== undefined && digest !== null
      ? await getPublishedTrendBriefing({
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
        className="inline-flex items-center min-h-11 gap-1 text-sm text-ink-secondary hover:text-ink-primary"
      >
        <span aria-hidden>←</span> 返回首页
      </Link>

      <header className="mt-4 border-b-2 border-ink-primary pb-4">
        <div className="text-xs uppercase tracking-[.15em] text-ink-tertiary">
          DAILY · 每日盘后
        </div>
        <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight text-ink-primary">
          A股日报
        </h1>
        <div className="mt-1 font-mono text-xs text-ink-secondary">
          {digest !== null
            ? `VOL.${formatDate(digest.coverageDate)} · ${digest.entries.length} STORIES · AGUHOT DAILY`
            : "AGUHOT · A股日报"}
        </div>
        {coverageDate !== undefined ? (
          <div className="mt-1 text-sm text-ink-secondary">
            {formatDateCn(coverageDate)}
          </div>
        ) : null}
      </header>

      {digest !== null ? (
        <DigestContent
          digest={digest}
          trendBriefing={trendBriefing}
          coverageDates={coverageDates}
          currentCoverageDate={coverageDate ?? digest.coverageDate}
        />
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
 * Render the digest: coverage date + generation time header, then the AI 趋势研判
 * (trend briefing) block (Story 5.3), then one clickable row per entry (already
 * sorted by evidenceCount DESC at generation time).
 *
 * The trend briefing renders between the coverage/generation metadata (`<dl>`) and
 * the event list (`<ol>`) with the uniform <AiLabel/> (UX-DR8, epic-5-context :96).
 * Its visual weight is ≤ the fact entries (text-sm text-ink-secondary, same shape as
 * the entry conclusions) so the AI judgment never out-shouts the factual summary
 * (epic NFR: AI 解读视觉权重须 <= 事实摘要). When no briefing exists (V1 prod: worker
 * resolves no llmAdapter → never produced), an honest degraded line "AI 趋势研判生
 * 成中。" renders (muted, mirroring the "日报生成中。" degraded pattern + the 5.2
 * "AI 深读生成中。" pattern) — never blank, never fabricated.
 */
function DigestContent({
  digest,
  trendBriefing,
  coverageDates,
  currentCoverageDate,
}: {
  digest: {
    coverageDate: Date;
    entries: DailyDigestEntry[];
    source: string;
    generatedAt: Date;
  };
  trendBriefing: PublishedTrendBriefing | null;
  coverageDates: ReadonlyArray<{ coverageDate: Date }>;
  currentCoverageDate: Date;
}) {
  // Group entries by category in the fixed taxonomy order; "其它" always last.
  const byCategory = new Map<string, DailyDigestEntry[]>();
  for (const cat of DAILY_CATEGORIES) byCategory.set(cat, []);
  for (const e of digest.entries) {
    const bucket = byCategory.get(e.category) ?? byCategory.get("其它")!;
    bucket.push(e);
  }
  const sections = DAILY_CATEGORIES.filter((c) => (byCategory.get(c) ?? []).length > 0);
  const sourceCount = new Set(digest.entries.map((e) => e.sourceName).filter((s) => s !== "")).size;

  // Prev/next across published digest days (descending coverageDates list).
  const sortedDays = [...coverageDates].map((c) => c.coverageDate.getTime()).sort((a, b) => b - a);
  const cur = currentCoverageDate.getTime();
  const idx = sortedDays.indexOf(cur);
  const prevDay = idx >= 0 && idx + 1 < sortedDays.length ? (sortedDays[idx + 1] ?? null) : null;
  const nextDay = idx > 0 ? (sortedDays[idx - 1] ?? null) : null;

  return (
    <section className="mt-8 space-y-6">
      {/* 今日看点 TOC */}
      <div className="rounded-lg border border-border-hairline bg-surface-raised px-5 py-4">
        <h2 className="flex items-baseline justify-between text-sm font-semibold text-ink-secondary">
          <span>今日看点</span>
          <span className="font-mono text-xs font-normal text-ink-tertiary">
            {digest.entries.length} 篇报道
          </span>
        </h2>
        <ol className="mt-3 space-y-1.5">
          {digest.entries.map((e, i) => (
            <li key={e.hotEventId} className="flex items-baseline gap-2 border-b border-dashed border-border-hairline pb-1.5 last:border-0">
              <span className="font-mono text-xs text-ink-tertiary">{String(i + 1).padStart(2, "0")}</span>
              <a href={`/events/${e.hotEventId}`} className="flex-1 text-sm text-ink-primary hover:text-brand">
                {stripTags(e.title)}
              </a>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${categoryTone(e.category)}`}>
                {e.category}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* AI 趋势研判 (Story 5.3). */}
      {trendBriefing !== null ? (
        <div className="rounded-lg border border-border-hairline border-l-[3px] border-l-accent-warm bg-surface-raised px-5 py-4">
          <div className="flex items-center gap-2">
            <AiLabel />
            <span className="text-xs font-semibold tracking-wide text-accent-warm">AI 趋势研判 · 当日主线</span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">{trendBriefing.briefing}</p>
        </div>
      ) : (
        <p className="text-sm text-ink-tertiary">AI 趋势研判生成中。</p>
      )}

      {/* 分类分节故事卡 */}
      {sections.map((cat, si) => {
        const items = byCategory.get(cat)!;
        return (
          <section key={cat} className="space-y-3">
            <h2 className="flex items-center gap-2 border-l-4 border-brand pl-3 font-display text-xl font-semibold text-ink-primary">
              <span className="font-mono text-xs font-normal text-ink-tertiary">{String(si + 1).padStart(2, "0")}</span>
              {cat}
            </h2>
            {items.map((e) => (
              <article key={e.hotEventId} className="rounded-lg border border-border-hairline bg-surface-raised px-5 py-4 transition-colors hover:bg-surface-muted">
                <Link href={`/events/${e.hotEventId}`} className="block space-y-1.5">
                  <h3 className="text-base font-semibold leading-snug text-ink-primary">{stripTags(e.title)}</h3>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-tertiary">
                    <span className="font-semibold">综合资讯</span>
                    {e.sourceName !== "" ? <span className="font-mono">{e.sourceName}</span> : null}
                    <span className="font-mono">{e.evidenceCount} 来源</span>
                  </div>
                  <p className="text-sm leading-relaxed text-ink-secondary">{stripTags(e.conclusion)}</p>
                </Link>
              </article>
            ))}
          </section>
        );
      })}

      {/* 统计 */}
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border-hairline bg-border-hairline">
        <Stat n={digest.entries.length} lab="今日事件" />
        <Stat n={sourceCount} lab="信源" />
        <Stat n={sections.length} lab="分类" />
      </div>

      {/* 前一日 / 后一日 导航 */}
      <nav className="flex items-center justify-between border-t border-border-hairline pt-4 text-sm">
        {prevDay !== null ? (
          <Link href={`/daily?date=${ymd(new Date(prevDay))}`} className="text-brand">
            ← 前一日
          </Link>
        ) : (
          <span className="text-ink-tertiary">← 前一日</span>
        )}
        <span className="text-ink-tertiary">生成于 {formatDateTime(digest.generatedAt)}</span>
        {nextDay !== null ? (
          <Link href={`/daily?date=${ymd(new Date(nextDay))}`} className="text-brand">
            后一日 →
          </Link>
        ) : (
          <span className="text-ink-tertiary">后一日 →</span>
        )}
      </nav>
    </section>
  );
}

function Stat({ n, lab }: { n: number; lab: string }) {
  return (
    <div className="bg-surface-raised px-3 py-4 text-center">
      <div className="font-display text-2xl font-bold text-brand">{n}</div>
      <div className="mt-0.5 text-xs text-ink-tertiary">{lab}</div>
    </div>
  );
}

/** Category → tailwind color classes for the TOC tag + section accent. */
function categoryTone(category: string): string {
  switch (category) {
    case "政策动态": return "bg-indigo-50 text-indigo-800";
    case "行业景气": return "bg-emerald-50 text-emerald-800";
    case "公司·标的": return "bg-amber-50 text-amber-800";
    case "海外映射": return "bg-blue-50 text-blue-800";
    case "资金面": return "bg-red-50 text-red-800";
    case "风险提示": return "bg-violet-50 text-violet-800";
    default: return "bg-surface-muted text-ink-secondary";
  }
}

/** Format a Date as YYYY-MM-DD (for the ?date= nav links). */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Chinese long-form date (二〇二六年七月十四日). */
function formatDateCn(d: Date): string {
  const digits = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const y = String(d.getUTCFullYear()).split("").map((c) => digits[Number(c)]!).join("");
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const cn = (n: number) => (n < 10 ? digits[n]! : `${digits[Math.floor(n / 10)]!}十${n % 10 === 0 ? "" : digits[n % 10]!}`);
  const weekday = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][d.getUTCDay()];
  return `${y}年${cn(m)}月${cn(day)}日 ${weekday}`;
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
