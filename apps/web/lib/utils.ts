import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * `cn` — shadcn/ui standard class-name merge helper.
 * Generated as part of `shadcn init` (Base UI base). Kept in `@/lib/utils`
 * per `components.json` aliases.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Strip HTML markup from a display string. Some RSS sources (notably RSSHub's
 * eastmoney search route) embed highlight tags like `两大存储<em>芯片</em>巨头`
 * in titles/summaries; React escapes them so the literal `<em>` shows on the
 * page. Removes any `<...>` tag run + decodes the common entities those sources
 * emit. Applied at render boundaries (timeline card, detail page). Stored data
 * is also stripped at ingest (rss-adapter) so future rows are clean; this is the
 * display-level guard for already-stored rows.
 */
export function stripTags(input: string | null | undefined): string {
  if (input === null || input === undefined) return "";
  return input
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}
