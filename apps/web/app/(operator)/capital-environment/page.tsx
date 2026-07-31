/**
 * Capital environment dashboard page (Issue #58) — internal research tool.
 *
 * Lives under the `(operator)` route group (auth-gated + noindex per PRD:
 * "首版为 AGUHOT 内部个人使用，不对外公开"). This is NOT a public page, so the
 * AD-3 published-read-model guardrail (which binds only `(public)` routes) does
 * not apply; the page reads the #55 replay read model directly.
 *
 * Supports `?asOf=YYYY-MM-DD` to replay a historical date. Defaults to the
 * latest available date (today) when omitted. `force-dynamic` so the database
 * read happens at request time, not build time.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { getPrisma, newTraceId, replayCapitalEnvironmentAt } from "@aguhot/core";
import { buildCapitalConclusion } from "@/lib/capital-conclusion";
import { CapitalEnvironmentDashboard } from "./_components";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "资本环境仪表盘",
  description: "美国、中国、韩国及全球资本环境的多维状态与证据（内部研究工具）",
  robots: { index: false, follow: false },
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface PageProps {
  searchParams: Promise<{ asOf?: string }>;
}

function formatDay(value: string): string {
  return value.slice(0, 10);
}

export default async function CapitalEnvironmentPage({ searchParams }: PageProps) {
  const { asOf: rawAsOf } = await searchParams;
  // Default to today; validate a user-provided asOf is a real calendar date.
  const today = new Date();
  const defaultAsOf = today.toISOString();
  const requestedAsOf =
    rawAsOf !== undefined && DATE_PATTERN.test(rawAsOf)
      ? `${rawAsOf}T23:59:59.999Z`
      : defaultAsOf;

  const prisma = getPrisma();
  const traceId = newTraceId();
  const replay = await replayCapitalEnvironmentAt(prisma, requestedAsOf, { traceId });
  const conclusion = buildCapitalConclusion(replay);

  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <header className="space-y-2">
          <div className="flex items-center gap-3 text-sm text-ink-tertiary">
            <Link href="/console" className="hover:text-brand">
              ← 返回运营台
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-ink-primary">资本环境仪表盘</h1>
          <p className="text-ink-secondary">
            回放日期：{formatDay(replay.asOf)}
          </p>
        </header>

        {/* Date selector — quick links + manual input (GET form, no JS). */}
        <nav aria-label="选择回放日期" className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-tertiary">快速切换：</span>
          <Link
            href="?"
            className="rounded-md border border-border-hairline px-2.5 py-1 text-ink-secondary hover:bg-surface-muted"
          >
            最新
          </Link>
          <Link
            href={`?asOf=${formatDay(yesterday.toISOString())}`}
            className="rounded-md border border-border-hairline px-2.5 py-1 text-ink-secondary hover:bg-surface-muted"
          >
            {formatDay(yesterday.toISOString())}
          </Link>
          <Link
            href={`?asOf=${formatDay(lastWeek.toISOString())}`}
            className="rounded-md border border-border-hairline px-2.5 py-1 text-ink-secondary hover:bg-surface-muted"
          >
            {formatDay(lastWeek.toISOString())}
          </Link>
          <form action="" method="get" className="ml-2 flex items-center gap-1">
            <label htmlFor="asOf" className="text-ink-tertiary">
              自选日期：
            </label>
            <input
              id="asOf"
              name="asOf"
              type="date"
              defaultValue={formatDay(requestedAsOf)}
              className="rounded-md border border-border-hairline bg-surface-base px-2 py-1 font-mono text-sm text-ink-primary"
            />
            <button
              type="submit"
              className="rounded-md bg-brand px-2.5 py-1 text-brand-foreground hover:opacity-90"
            >
              回放
            </button>
          </form>
        </nav>

        <div className="mt-8">
          <CapitalEnvironmentDashboard replay={replay} conclusion={conclusion} />
        </div>
      </div>
    </main>
  );
}
