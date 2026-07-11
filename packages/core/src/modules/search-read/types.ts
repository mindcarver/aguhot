/**
 * search-read domain types: the public search over published_* read models
 * (Story 3.1, FR12; Story 4.4 adds the timeline corpus).
 *
 * FR12: "用户可以搜索热点事件、主题页或相关关键词，结果覆盖标题、解释摘要和
 * 主题名称". searchPublished reads corpora from the published_* read models
 * (AD-3) and returns grouped results { events, themes, timeline } ranked by a
 * blend of relevance (title hit > summary hit) and recency (latestEvidenceAt /
 * occurredAt DESC within each tier). Story 4.4 adds the timeline corpus
 * (published_timeline_entries title/summary) as the 4th read, surfacing market
 * dynamics that the Epic 4 pivot made a first-class content unit.
 *
 * This module never writes anything (pure read). It only orchestrates reads of
 * listPublishedHotEvents + listPublishedHotEventExplanations +
 * listPublishedThemeMemberships + listPublishedTimelineEntries (all filter-free
 * sibling list fns owned by publish-orchestrator), then matches + ranks in JS.
 * Chinese-friendly: substring match via String.prototype.includes + toLowerCase
 * (no FTS/tsvector/ILIKE — deferred; Chinese substring character-level match is
 * correct without word segmentation).
 */

import type { PrismaClient } from "../../../generated/client.js";
import type { PublishedTimelineEntry } from "../publish-orchestrator/types.js";

/**
 * Options for searchPublished. `{ prisma, traceId, query }` — `query` is the
 * raw search string the caller intends to match (the web layer trims + truncates
 * before calling; this fn also trims defensively and short-circuits on empty).
 */
export interface SearchPublishedOptions {
  prisma: PrismaClient;
  traceId: string;
  query: string;
}

/**
 * The kind of hit — "event" (matched title or explanation summary), "theme"
 * (matched theme label), or "timeline" (matched published_timeline entry title
 * or summary). Drives the grouped { events, themes, timeline } return shape.
 */
export const SearchHitKind = {
  Event: "event",
  Theme: "theme",
  Timeline: "timeline",
} as const;

export type SearchHitKindType = (typeof SearchHitKind)[keyof typeof SearchHitKind]

/**
 * Which corpus field an event hit matched. Drives the two-tier relevance ranking:
 * a "title" hit is tier 0 (strong — the user's query is in the event name), a
 * "summary" hit is tier 1 (weaker — the query is in the AI-generated explanation
 * body). An event matching both title and summary counts once at tier 0
 * (strongest signal wins, no duplicates).
 */
export const EventMatchedField = {
  Title: "title",
  Summary: "summary",
} as const;

export type EventMatchedFieldType =
  (typeof EventMatchedField)[keyof typeof EventMatchedField]

/**
 * One published hot-event search hit. Carries the EventCard-needed fields
 * (hotEventId / title / evidenceCount / latestEvidenceAt / publishedAt) plus
 * `matchedField` so the page could (in a future highlight tier) distinguish
 * title vs summary hits. Tier-0 (title) hits rank above tier-1 (summary) hits;
 * within each tier, latestEvidenceAt DESC (recency).
 */
export interface EventSearchHit {
  kind: typeof SearchHitKind.Event;
  hotEventId: string;
  title: string;
  evidenceCount: number;
  latestEvidenceAt: Date;
  publishedAt: Date;
  matchedField: EventMatchedFieldType;
}

/**
 * One published theme search hit. `memberCount` is the number of published
 * events whose theme membership includes this slug (the theme's live breadth).
 * Themes rank by memberCount DESC (broader themes first), then label ASC
 * (stable, alphabetical within equal breadth).
 */
export interface ThemeSearchHit {
  kind: typeof SearchHitKind.Theme;
  slug: string;
  label: string;
  memberCount: number;
}

/**
 * One published timeline entry search hit (Story 4.4). The timeline corpus is
 * `published_timeline_entries` — the per-HotEvent folded projection written by
 * publish-orchestrator. `matchedField` reuses EventMatchedField (title = tier 0,
 * summary = tier 1) so timeline hits share the event-hit tier semantics.
 *
 * `entry` carries the full PublishedTimelineEntry so the search page can render
 * the hit via the 4.2 TimelineCard with zero projection — TimelineCard already
 * knows how to render a PublishedTimelineEntry (whole-card Link to
 * /events/{hotEventId}, fixed reading order, fold disclosure). `matchedField`
 * only drives the tier-then-recency ranking; it is not rendered as a highlight
 * (consistent with event hits).
 *
 * Note on overlap with event hits (Design Notes, spec 4.4): the timeline
 * `title` and `summary` strings are the SAME strings as
 * `published_hot_events.title` and `published_hot_event_explanations.summary`
 * (4.1 projects them from the same sources). So for any event with evidence,
 * the timeline entry and the event row carry identical title/summary → a query
 * matching one matches the other. The two groups (热点事件 / 时间流) intentionally
 * render the overlapping membership with distinct card frameworks (EventCard
 * shows saliency/recency, TimelineCard shows timestamp/source/session). This is
 * the spec-mandated "coverage" outcome, NOT a defect — dedupe/merge is logged as
 * deferred work.
 */
export interface TimelineSearchHit {
  kind: typeof SearchHitKind.Timeline;
  matchedField: EventMatchedFieldType;
  entry: PublishedTimelineEntry;
}

/**
 * The grouped search result. `events`, `themes`, and `timeline` are each
 * already ranked (events: tier ASC then latestEvidenceAt DESC; themes:
 * memberCount DESC then label ASC; timeline: tier ASC then occurredAt DESC then
 * hotEventId ASC). Empty arrays when there are no hits (the page renders the
 * no-match state). `query` echoes the matched query (trimmed) for display +
 * shareability.
 */
export interface SearchPublishedResult {
  query: string;
  events: EventSearchHit[];
  themes: ThemeSearchHit[];
  timeline: TimelineSearchHit[];
}
