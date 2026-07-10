/**
 * search-read domain types: the public search over published_* read models
 * (Story 3.1, FR12).
 *
 * FR12: "用户可以搜索热点事件、主题页或相关关键词，结果覆盖标题、解释摘要和
 * 主题名称". searchPublished reads three corpora from the published_* read models
 * (AD-3) and returns grouped results { events, themes } ranked by a blend of
 * relevance (title hit > summary hit) and recency (latestEvidenceAt DESC within
 * each tier).
 *
 * This module never writes anything (pure read). It only orchestrates reads of
 * listPublishedHotEvents + listPublishedHotEventExplanations +
 * listPublishedThemeMemberships (all filter-free sibling list fns owned by
 * publish-orchestrator), then matches + ranks in JS. Chinese-friendly: substring
 * match via String.prototype.includes + toLowerCase (no FTS/tsvector/ILIKE —
 * deferred; Chinese substring character-level match is correct without word
 * segmentation).
 */

import type { PrismaClient } from "../../../generated/client.js";

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
 * The kind of hit — "event" (matched title or explanation summary) or "theme"
 * (matched theme label). Drives the grouped { events, themes } return shape.
 */
export const SearchHitKind = {
  Event: "event",
  Theme: "theme",
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
 * The grouped search result. `events` and `themes` are each already ranked
 * (events: tier ASC then latestEvidenceAt DESC; themes: memberCount DESC then
 * label ASC). Empty arrays when there are no hits (the page renders the no-match
 * state). `query` echoes the matched query (trimmed) for display + shareability.
 */
export interface SearchPublishedResult {
  query: string;
  events: EventSearchHit[];
  themes: ThemeSearchHit[];
}
