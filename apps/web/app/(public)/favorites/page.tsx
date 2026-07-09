import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "收藏",
};

/**
 * Favorites placeholder — Story 1.2.
 *
 * Structural server-component placeholder (isomorphic to the 1.1 `/console`
 * placeholder): exists only so the primary nav target `/favorites` is
 * anonymously reachable (HTTP 200, inside the public shell). It does NOT
 * force login — public paths must stay anonymous (AD-8). Logged-in
 * favorites/personal preferences open in a later story, and that is noted on
 * the page itself. This page renders no business content and has no session
 * dependency. No `dark:` variants (theme cleanup is 1.3).
 */
export default function FavoritesPlaceholderPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-20">
      <header className="space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">收藏</h1>
        <p className="text-lg text-neutral-600">AGUHOT · 我收藏的热点</p>
      </header>
      <section className="mt-12 space-y-3">
        <h2 className="text-xl font-semibold">当前状态</h2>
        <p className="text-neutral-700">
          收藏为结构性占位页。登录态下的收藏、关注与个人偏好能力将在后续迭代中陆续开放；当前匿名浏览不受影响。
        </p>
      </section>
    </div>
  );
}
