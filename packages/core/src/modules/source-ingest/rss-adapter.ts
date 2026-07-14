/**
 * RSS SourceAdapter — parses an RSS 2.0 feed into normalized EvidenceItems.
 *
 * This is the one concrete adapter wired in Story 1.4. It is deliberately the
 * only place that knows the RSS wire format: `ingestSources` consumes the
 * {@link SourceAdapter} port, so adding an API/webhook source later means a new
 * adapter class, not a change to the ingest service (AD-7).
 *
 * Fetching is done over HTTP(S). For deterministic verification, the verify
 * script seeds an EvidenceSource whose feedUrl points at a committed fixture
 * file via the `file:` scheme; `fetchUrl` supports both.
 */

import { XMLParser } from "fast-xml-parser";

import type { SourceAdapter } from "./adapter.js";
import type { EvidenceItem } from "./types.js";

export interface RssAdapterOptions {
  feedUrl: string;
}

export class RssAdapter implements SourceAdapter {
  private readonly feedUrl: string;

  constructor(options: RssAdapterOptions) {
    this.feedUrl = options.feedUrl;
  }

  async fetch(): Promise<EvidenceItem[]> {
    const xml = await fetchUrl(this.feedUrl);
    const parser = new XMLParser({
      ignoreAttributes: false,
      // Treat <link> as text content, not an object, so RSS <link>text</link>
      // parses to a string rather than { "#text": ... }.
      textNodeName: "#text",
    });
    const parsed = parser.parse(xml) as RssFeed;

    const channel = parsed?.rss?.channel;
    if (!channel) {
      throw new Error(`[rss-adapter] no <rss><channel> at ${this.feedUrl}`);
    }

    const items = normalizeItems(channel.item);
    return items.map((item) => toEvidenceItem(item));
  }
}

interface RssFeed {
  rss?: {
    channel?: RssChannel;
  };
}

interface RssChannel {
  item?: RssItem | RssItem[];
}

interface RssItem {
  title?: string;
  link?: string;
  pubDate?: string;
  description?: string;
}

function normalizeItems(item: RssChannel["item"]): RssItem[] {
  if (item === undefined || item === null) return [];
  if (Array.isArray(item)) return item;
  return [item];
}

function toEvidenceItem(item: RssItem): EvidenceItem {
  return {
    url: optionalString(item.link),
    title: optionalString(item.title),
    summary: optionalString(item.description),
    publishedAt: parseDate(item.pubDate),
    raw: item,
  };
}

function optionalString(value: string | undefined): string | null {
  if (value === undefined) return null;
  // Some RSS sources (notably RSSHub's eastmoney search route) embed highlight
  // markup like `两大存储<em>芯片</em>巨头` in titles/descriptions. Strip it at
  // the ingest boundary so stored evidence + everything downstream (cluster
  // titles, published read models, search index) stays plain text.
  const stripped = stripMarkup(value);
  const trimmed = stripped.trim();
  return trimmed === "" ? null : trimmed;
}

/** Remove `<...>` tag runs + decode the common HTML entities feeds emit. */
function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function parseDate(value: string | undefined): Date | null {
  const raw = optionalString(value);
  if (raw === null) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/**
 * Fetch the feed body. Supports `file:` URLs (used by the deterministic
 * fixture-based verify script) and `http:`/`https:` URLs (real sources).
 */
async function fetchUrl(url: string): Promise<string> {
  if (url.startsWith("file:")) {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    return readFile(fileURLToPath(url), "utf8");
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `[rss-adapter] fetch ${url} failed: HTTP ${response.status} ${response.statusText}`,
    );
  }
  return response.text();
}
