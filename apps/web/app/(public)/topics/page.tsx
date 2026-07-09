import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "主题",
};

/**
 * Topics placeholder — Story 1.2.
 *
 * Structural server-component placeholder (isomorphic to the 1.1 `/console`
 * placeholder): exists only so the primary nav target `/topics` is
 * anonymously reachable (HTTP 200, inside the public shell). The
 * theme/topic browsing content lands in a later story; this page renders no
 * business content and has no session dependency (AD-8). H1 uses `font-display`
 * and colors use `@theme` ink tokens (Story 1.3).
 */
export default function TopicsPlaceholderPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-20">
      <header className="space-y-4">
        <h1 className="text-4xl font-display font-semibold tracking-tight">主题</h1>
        <p className="text-lg text-ink-secondary">AGUHOT · 按主题浏览热点</p>
      </header>
      <section className="mt-12 space-y-3">
        <h2 className="text-xl font-semibold">当前状态</h2>
        <p className="text-ink-secondary">
          主题为结构性占位页，按主题浏览热点的能力将在后续迭代中陆续开放。
        </p>
      </section>
    </div>
  );
}
