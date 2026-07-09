import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "首页",
};

/**
 * Anonymous public homepage shell — Story 1.1.
 *
 * - Server component (no "use client"): default render path is static.
 * - No auth/session dependency, no `/login` redirect (AD-8). Public content
 *   paths are anonymously usable.
 * - No mock hot-event cards, filters, or nav — those land in 1.2 / 1.7.
 *   This is only the shell + default entry copy.
 */
export default function PublicHomePage() {
  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-3xl px-6 py-20">
        <header className="space-y-4">
          <h1 className="text-4xl font-bold tracking-tight">AGUHOT</h1>
          <p className="text-lg text-neutral-600 dark:text-neutral-400">
            可信热点发布闭环 · 公共首页
          </p>
        </header>

        <section className="mt-12 space-y-3">
          <h2 className="text-xl font-semibold">关于 AGUHOT</h2>
          <p className="text-neutral-700 dark:text-neutral-300">
            AGUHOT
            是一个以「可查看 + 可信」为核心的热点发布平台。每一个公开呈现的热点事件，都经过采集、聚类、解释与运营复核闭环后才会发布。
          </p>
          <p className="text-neutral-700 dark:text-neutral-300">
            匿名即可浏览核心内容；登录态仅用于收藏、关注与个人偏好。
          </p>
        </section>

        <section className="mt-12 space-y-3">
          <h2 className="text-xl font-semibold">当前状态</h2>
          <p className="text-neutral-700 dark:text-neutral-300">
            公共页面骨架已就绪。热点事件流、证据时间线与运营复核台将在后续迭代中陆续开放。
          </p>
        </section>
      </div>
    </main>
  );
}
