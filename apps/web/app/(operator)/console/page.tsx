import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "运营台",
};

/**
 * Operator review console route group placeholder — Story 1.1.
 *
 * Per ARCHITECTURE-SPINE.md Structural Seed, apps/web holds both a
 * `(public)` and an `(operator)` route group. The `(operator)` group groups
 * operator-only routes under a shared (future) layout; it does NOT claim `/`,
 * which belongs to the public homepage. This placeholder lives at `/console`
 * so the dual-group structure is visible without colliding with `(public)`.
 *
 * The review queue / publish gate (review-workflow, AD-6) is delivered in
 * Story 1.6. No auth, no functionality in 1.1.
 */
export default function OperatorPlaceholderPage() {
  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-3xl px-6 py-20">
        <h1 className="text-2xl font-bold">运营复核台</h1>
        <p className="mt-4 text-neutral-700 dark:text-neutral-300">
          1.1 未实现 · 该入口为结构性占位，运营复核队列与发布闸门将在后续迭代中落地。
        </p>
      </div>
    </main>
  );
}
