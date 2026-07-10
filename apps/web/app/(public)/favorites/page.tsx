import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "收藏",
};

/**
 * Favorites placeholder — Story 1.2 (copy updated in 3.2).
 *
 * Structural server-component placeholder (isomorphic to the 1.1 `/console`
 * placeholder): exists only so the primary nav target `/favorites` is
 * anonymously reachable (HTTP 200, inside the public shell). It does NOT
 * force login — public paths must stay anonymous (AD-8). This page renders no
 * business content and has no session dependency (it stays static so the build
 * stays DATABASE_URL-free AND SESSION_SECRET-free). The follow action itself
 * (Story 3.2) lives on the feed card / detail page / theme page; the watchlist
 * list/management UI is owned by Story 3.3. H1 uses `font-display` and colors
 * use `@theme` ink tokens (Story 1.3).
 */
export default function FavoritesPlaceholderPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-20">
      <header className="space-y-4">
        <h1 className="text-4xl font-display font-semibold tracking-tight">收藏</h1>
        <p className="text-lg text-ink-secondary">AGUHOT · 我收藏的热点</p>
      </header>
      <section className="mt-12 space-y-3">
        <h2 className="text-xl font-semibold">当前状态</h2>
        <p className="text-ink-secondary">
          你已经可以在热点详情页与主题页点击「收藏」保存感兴趣的内容。关注列表与管理能力将在后续迭代中开放；当前匿名浏览不受影响。
        </p>
      </section>
    </div>
  );
}
