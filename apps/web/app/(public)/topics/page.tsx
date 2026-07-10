import type { Metadata } from "next";

import { AiLabel, FilterPill } from "@/components/chips";
import {
  getPrisma,
  listPublishedThemeMemberships,
  newTraceId,
} from "@aguhot/core";
import type { ThemeRef } from "@aguhot/core";

export const metadata: Metadata = {
  title: "主题",
};

/**
 * Topics directory page — Story 2.3.
 *
 * Replaces the Story 1.2 static placeholder. This is the dynamic theme
 * directory: it reads the published theme-membership read model
 * (published_hot_event_themes via listPublishedThemeMemberships, AD-3 — never
 * event_theme_sets / hot_events / evidence_*) and derives the distinct-theme
 * set in JS (dedup by slug, preserve first-seen order). Each theme is a
 * clickable FilterPill link to /topics/{slug} (the theme-continuity page). The
 * directory is the entry point the primary nav "主题" target resolves to (the
 * main image "主题" entry must not be a dead link — closed loop).
 *
 * Honest degradation (AC3 / epic continuity honesty): when NO published event
 * has any theme membership (V1 prod: theme-backfill worker resolves no adapter
 * → no themes generated → no projections), the page renders an explicit
 * "暂无已确认的主题。" degraded line — never fabricated themes, never empty.
 *
 * Why force-dynamic + @aguhot/core import is safe for the build:
 *   - `export const dynamic = "force-dynamic"` marks the route dynamic so Next
 *     evaluates it at REQUEST time, not BUILD time. getPrisma() reads
 *     DATABASE_URL at runtime; that call is never reached during `next build`,
 *     so the public web build stays DATABASE_URL-free (same mechanism as the
 *     homepage + detail route).
 *
 * System-derived themes carry the uniform <AiLabel/> (UX-DR8). NFR: theme
 * labels are concept identity only, never advisory.
 */
export const dynamic = "force-dynamic";

interface DistinctTheme {
  slug: string;
  label: string;
}

export default async function TopicsDirectoryPage() {
  const prisma = getPrisma();
  const memberships = await listPublishedThemeMemberships({
    prisma,
    traceId: newTraceId(),
  });

  // Derive the distinct-theme set from memberships (slug→label, preserve
  // first-seen order). slug is the URL/addressing key; label is the display
  // identity. Mirrors the 2.2 listPublishedAssociations + 1.7 filterByWindow
  // JS-join pattern (no SQL distinct — V1 scale is tiny).
  const seen = new Set<string>();
  const themes: DistinctTheme[] = [];
  for (const m of memberships) {
    for (const item of m.items as ThemeRef[]) {
      if (
        typeof item.slug === "string" &&
        item.slug.trim() !== "" &&
        typeof item.label === "string" &&
        item.label.trim() !== "" &&
        !seen.has(item.slug)
      ) {
        seen.add(item.slug);
        themes.push({ slug: item.slug, label: item.label });
      }
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header className="space-y-3">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-4xl font-semibold tracking-tight text-ink-primary">
            主题
          </h1>
          {themes.length > 0 ? <AiLabel /> : null}
        </div>
        <p className="text-lg text-ink-secondary">AGUHOT · 按主题浏览热点</p>
      </header>

      <section className="mt-12 space-y-4">
        {themes.length > 0 ? (
          <>
            <h2 className="text-xl font-semibold text-ink-primary">已确认主题</h2>
            <p className="text-sm text-ink-tertiary">
              点击主题查看其成员事件的时间序列。
            </p>
            <div className="flex flex-wrap gap-2">
              {themes.map((theme) => (
                <FilterPill
                  key={theme.slug}
                  href={`/topics/${encodeURIComponent(theme.slug)}`}
                >
                  {theme.label}
                </FilterPill>
              ))}
            </div>
          </>
        ) : (
          <p className="text-base text-ink-tertiary">暂无已确认的主题。</p>
        )}
      </section>
    </div>
  );
}
