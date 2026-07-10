import { cn } from "@/lib/utils";

/**
 * Published hot-event feed card — Story 1.7. Server component (no client JS).
 *
 * Renders one published_hot_events row as a static information card on the public
 * feed. The card shows exactly the fields the read model has today (Story 1.6
 * minimal projection): title, source count (evidenceCount), latest update time
 * (latestEvidenceAt). A ranking-reason chip is rendered ONLY when there is a
 * real signal — evidenceCount >= 3 (multi-source coverage) or latestEvidenceAt
 * within the last 72 hours (recent heating). When neither signal is present, no
 * chip is rendered (NFR: never fabricate a reason). The ordering itself
 * (evidenceCount DESC, latestEvidenceAt DESC) always applies at the query layer.
 *
 * Story 1.7 deliberately does NOT render a link / make the card clickable: the
 * detail page is Story 1.8, and a link to a non-existent route would be dishonest
 * UI. The card is a static info surface.
 *
 * Tokens: uses only real @theme tokens that resolve in Tailwind v4
 * (bg-surface-raised / border-border-hairline / rounded-lg / ink-* / bg-brand).
 * Does NOT copy the operator console's broken undefined tokens (bg-surface /
 * border-line-subtle / bg-brand-strong) — those do not resolve.
 */

const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000;
const MULTI_SOURCE_THRESHOLD = 3;

export interface EventCardProps {
  title: string;
  evidenceCount: number;
  latestEvidenceAt: Date;
  publishedAt: Date;
  now?: Date;
}

/**
 * Decide whether a ranking-reason chip should render, and which reason.
 * Returns null when no honest signal exists (never fabricates a reason).
 *
 * - "近期升温" (recent heating): latestEvidenceAt within 72h.
 * - "多源覆盖" (multi-source coverage): evidenceCount >= 3.
 * If both apply, recency wins (more time-sensitive, surfaces first).
 */
function rankingReason(
  evidenceCount: number,
  latestEvidenceAt: Date,
  now: Date,
): { label: string; tone: "recent" | "multi-source" } | null {
  const isRecent = now.getTime() - latestEvidenceAt.getTime() <= SEVENTY_TWO_HOURS_MS;
  if (isRecent) {
    return { label: "近期升温", tone: "recent" };
  }
  if (evidenceCount >= MULTI_SOURCE_THRESHOLD) {
    return { label: "多源覆盖", tone: "multi-source" };
  }
  return null;
}

export function EventCard({
  title,
  evidenceCount,
  latestEvidenceAt,
  publishedAt,
  now = new Date(),
}: EventCardProps) {
  const reason = rankingReason(evidenceCount, latestEvidenceAt, now);

  return (
    <li className="rounded-lg border border-border-hairline bg-surface-raised px-5 py-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold text-ink-primary">{title}</h2>
        {reason !== null ? (
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-xs",
              reason.tone === "recent"
                ? "bg-brand text-brand-foreground"
                : "bg-surface-muted text-ink-secondary",
            )}
          >
            {reason.label}
          </span>
        ) : null}
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs text-ink-tertiary">
        <div>
          <dt className="inline">来源数 </dt>
          <dd className="inline">{evidenceCount}</dd>
        </div>
        <div>
          <dt className="inline">更新 </dt>
          <dd className="inline">{formatDateTime(latestEvidenceAt)}</dd>
        </div>
        <div>
          <dt className="inline">发布 </dt>
          <dd className="inline">{formatDateTime(publishedAt)}</dd>
        </div>
      </dl>
    </li>
  );
}

/**
 * Locale-stable UTC format (avoid locale-dependent toLocaleString). YYYY-MM-DD
 * HH:mm UTC is enough for the feed card meta line and stays consistent across
 * build-time TZ and runtime TZ.
 */
function formatDateTime(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
