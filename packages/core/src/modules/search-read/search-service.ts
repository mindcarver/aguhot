/**
 * searchPublished: public search over published_* read models — Story 3.1 (FR12).
 *
 * Reads THREE corpora (FR12: "标题、解释摘要和主题名称"):
 *   - event titles from listPublishedHotEvents (published_hot_events.title)
 *   - explanation summaries from listPublishedHotEventExplanations
 *     (published_hot_event_explanations.summary — the sibling list fn 3.1 adds
 *     to surface this corpus)
 *   - theme labels from listPublishedThemeMemberships
 *     (published_hot_event_themes.items[].label)
 *
 * All three reads are filter-free sibling list fns owned by publish-orchestrator
 * (AD-3: public reads only published_* read models). searchPublished joins them
 * in JS and applies case-insensitive substring matching — the same V1 in-memory
 * filter pattern as 1.7 filterByWindow / 2.2 association join / 2.3 theme derive
 * ("V1 published volume is tiny, filtering is a UI concern"). Chinese-friendly:
 * `haystack.toLowerCase().includes(q.toLowerCase())` — Chinese has no case so
 * toLowerCase is a no-op on CJK and normalizes Latin; substring character-level
 * match is correct without word segmentation (deferred: FTS/tsvector/GIN +
 * zhparser/jieba when real query load appears).
 *
 * Ranking (FR12 AC1 "按相关性与时间综合排序"):
 *   - events: two tiers — tier 0 (title hit, strong) before tier 1 (summary hit,
 *     weaker); within a tier, latestEvidenceAt DESC (recency). An event matching
 *     both title and summary counts once at tier 0 (strongest signal wins, no
 *     duplicate).
 *   - themes: memberCount DESC (broader themes first), then label ASC (stable
 *     alphabetical tiebreaker). A theme matches if ANY collected label for its
 *     slug contains the query (a label that drifted on a later event must stay
 *     searchable); the DISPLAY label stays first-seen.
 *
 * Only published_* read models are read — never hot_events / explanation_versions
 * / event_theme_sets / evidence_* (AD-3). Row existence = currently published
 * (no status column). A taken-down event's row is deleted from published_* → it
 * automatically disappears from search (no extra filter, AD-8).
 */

import {
  listPublishedHotEventExplanations,
  listPublishedHotEvents,
  listPublishedThemeMemberships,
} from "../publish-orchestrator/index.js";
import type {
  EventMatchedFieldType,
  EventSearchHit,
  SearchPublishedOptions,
  SearchPublishedResult,
  ThemeSearchHit,
} from "./types.js";
import { EventMatchedField, SearchHitKind } from "./types.js";

/**
 * Search published events + themes by case-insensitive substring match.
 *
 * Returns grouped { events, themes } ranked by relevance + recency. An empty
 * query (after trim) short-circuits to empty result (the page layer also guards,
 * but this is a defensive double-check so the core fn is safe to call directly).
 */
export async function searchPublished(
  options: SearchPublishedOptions,
): Promise<SearchPublishedResult> {
  const q = options.query.trim();
  if (q === "") {
    return { query: "", events: [], themes: [] };
  }
  const qLower = q.toLowerCase();

  // Concurrently read all three corpora (all filter-free sibling list fns; V1
  // published volume is tiny so three reads + an in-memory join is the ponytail
  // choice over SQL union / FTS / per-corpus indexes).
  const [events, explanations, memberships] = await Promise.all([
    listPublishedHotEvents({ prisma: options.prisma, traceId: options.traceId }),
    listPublishedHotEventExplanations({
      prisma: options.prisma,
      traceId: options.traceId,
    }),
    listPublishedThemeMemberships({
      prisma: options.prisma,
      traceId: options.traceId,
    }),
  ]);

  // Build a hotEventId → summary lookup for the explanation corpus. Events
  // without a projected explanation row simply have no summary to match (their
  // title/theme can still hit via the other corpora).
  const summaryByEvent = new Map<string, string>();
  for (const row of explanations) {
    summaryByEvent.set(row.hotEventId, row.summary);
  }

  // --- Event hits: two-tier relevance (title > summary), recency within tier ---
  const eventHits: EventSearchHit[] = [];
  for (const ev of events) {
    const matchedField = matchEvent(
      ev.title,
      summaryByEvent.get(ev.hotEventId) ?? null,
      qLower,
    );
    if (matchedField !== null) {
      eventHits.push({
        kind: SearchHitKind.Event,
        hotEventId: ev.hotEventId,
        title: ev.title,
        evidenceCount: ev.evidenceCount,
        latestEvidenceAt: ev.latestEvidenceAt,
        publishedAt: ev.publishedAt,
        matchedField,
      });
    }
  }
  eventHits.sort(rankEventHit);

  // --- Theme hits: aggregate slug → { label, memberEventIds }, match label ---
  // First pass: aggregate across all membership rows. A slug shared by multiple
  // events is one theme hit with memberCount = number of published events that
  // carry it (the theme's live breadth). The DISPLAY label is the first-seen
  // ThemeRef.label for that slug (listPublishedThemeMemberships is ordered
  // hotEventId ASC so first-seen is deterministic across loads). The MATCH set
  // collects ALL distinct labels ever seen for that slug: a theme whose label
  // drifted on a later event (same slug, different label) must stay searchable
  // by every label a published membership actually carries (AC1 theme corpus
  // must surface any published label). Matching ANY collected label while
  // displaying the first-seen label keeps the display stable AND the corpus
  // complete.
  const slugToDisplayLabel = new Map<string, string>();
  const slugToAllLabels = new Map<string, Set<string>>();
  const slugToMembers = new Map<string, Set<string>>();
  for (const m of memberships) {
    for (const item of m.items) {
      // Skip items with an empty label/slug (defensive; normalizeThemeItems
      // already enforces non-empty at write time, so this is belt-and-suspenders
      // against any corrupt Json read).
      if (
        typeof item.slug !== "string" ||
        item.slug === "" ||
        typeof item.label !== "string" ||
        item.label === ""
      ) {
        continue;
      }
      if (!slugToDisplayLabel.has(item.slug)) {
        slugToDisplayLabel.set(item.slug, item.label);
      }
      let labelSet = slugToAllLabels.get(item.slug);
      if (labelSet === undefined) {
        labelSet = new Set<string>();
        slugToAllLabels.set(item.slug, labelSet);
      }
      labelSet.add(item.label);
      let memberSet = slugToMembers.get(item.slug);
      if (memberSet === undefined) {
        memberSet = new Set<string>();
        slugToMembers.set(item.slug, memberSet);
      }
      memberSet.add(m.hotEventId);
    }
  }

  const themeHits: ThemeSearchHit[] = [];
  for (const [slug, displayLabel] of slugToDisplayLabel) {
    const allLabels = slugToAllLabels.get(slug);
    if (allLabels === undefined) continue;
    // Match ANY collected label for this slug (display stays first-seen).
    let matched = false;
    for (const label of allLabels) {
      if (matchTheme(label, qLower)) {
        matched = true;
        break;
      }
    }
    if (!matched) continue;
    const members = slugToMembers.get(slug);
    themeHits.push({
      kind: SearchHitKind.Theme,
      slug,
      label: displayLabel,
      memberCount: members?.size ?? 0,
    });
  }
  themeHits.sort((a, b) => {
    // memberCount DESC (broader themes first).
    const byCount = b.memberCount - a.memberCount;
    if (byCount !== 0) return byCount;
    // label ASC (stable alphabetical tiebreaker).
    return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
  });

  return { query: q, events: eventHits, themes: themeHits };
}

/**
 * Decide whether an event matches the query, and on which field. Returns
 * "title" (tier 0, strong) if the title contains q, else "summary" (tier 1,
 * weaker) if the explanation summary contains q, else null (no hit). A title
 * hit takes precedence over a summary hit so an event matching both counts
 * once at the stronger tier (no duplicate).
 *
 * `qLower` is the already-lowercased query (caller pre-computes once).
 */
function matchEvent(
  title: string,
  summary: string | null,
  qLower: string,
): EventMatchedFieldType | null {
  if (title.toLowerCase().includes(qLower)) {
    return EventMatchedField.Title;
  }
  if (summary !== null && summary.toLowerCase().includes(qLower)) {
    return EventMatchedField.Summary;
  }
  return null;
}

/**
 * Case-insensitive substring match for a theme label. Chinese substring
 * character-level match (toLowerCase is a no-op on CJK); Latin normalized via
 * toLowerCase.
 */
function matchTheme(label: string, qLower: string): boolean {
  return label.toLowerCase().includes(qLower);
}

/**
 * Tier-then-recency comparator for event hits. tier 0 (title) sorts before
 * tier 1 (summary); within a tier, latestEvidenceAt DESC (more recently updated
 * first). Deterministic tiebreaker by hotEventId ASC so two events sharing the
 * same tier + same latestEvidenceAt resolve to a stable DOM order across loads.
 */
function rankEventHit(a: EventSearchHit, b: EventSearchHit): number {
  const tierA = a.matchedField === EventMatchedField.Title ? 0 : 1;
  const tierB = b.matchedField === EventMatchedField.Title ? 0 : 1;
  if (tierA !== tierB) return tierA - tierB;
  const byTime = b.latestEvidenceAt.getTime() - a.latestEvidenceAt.getTime();
  if (byTime !== 0) return byTime;
  return a.hotEventId < b.hotEventId ? -1 : a.hotEventId > b.hotEventId ? 1 : 0;
}
