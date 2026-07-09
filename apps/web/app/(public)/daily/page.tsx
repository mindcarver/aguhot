import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "日报",
};

/**
 * Daily digest placeholder — Story 1.2.
 *
 * Structural server-component placeholder (isomorphic to the 1.1 `/console`
 * placeholder): exists only so the primary nav target `/daily` is anonymously
 * reachable (HTTP 200, inside the public shell). The daily-digest content
 * lands in a later story; this page renders no business content and has no
 * session dependency (AD-8). No `dark:` variants (theme cleanup is 1.3).
 */
export default function DailyPlaceholderPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-20">
      <header className="space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">日报</h1>
        <p className="text-lg text-neutral-600">AGUHOT · 每日热点精选</p>
      </header>
      <section className="mt-12 space-y-3">
        <h2 className="text-xl font-semibold">当前状态</h2>
        <p className="text-neutral-700">日报为结构性占位页，每日热点精选将在后续迭代中陆续开放。</p>
      </section>
    </div>
  );
}
