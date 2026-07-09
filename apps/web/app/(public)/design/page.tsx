import type { Metadata } from "next";
import { AiLabel, FilterPill, ReactionChip } from "@/components/chips";

export const metadata: Metadata = {
  title: "设计系统预览",
};

/**
 * Design-system preview surface — Story 1.3.
 *
 * A minimal, anonymous, token-only preview page. It is NOT a business page:
 * it renders no hot-event / filter / card / timeline content (those land in
 * 1.7 / 1.8). Its sole purpose is to surface-anchor AC1 (warm canvas + ink +
 * brand/market decoupling + display/sans/mono type layers) and AC2 (the three
 * chip primitives consume `@theme` tokens) so they can be verified visually
 * and in e2e (`e2e/design.spec.ts`).
 *
 * - Server component, no session dependency, no auth wall (AD-8: `/design`
 *   returns 200, never redirects to `/login`).
 * - Not in the primary nav — reachable by URL only. 1.7/1.8 consume the same
 *   `@theme` tokens directly, not this page.
 *
 * Colors here are ALWAYS token utilities (`bg-canvas`, `bg-brand`, ...). There
 * are zero hardcoded hex values or inline `font-family` declarations — that is
 * one of the things AC2 asserts.
 */

/**
 * A single color swatch: a token-driven block + its token name. The block's
 * background is the token utility (never a literal), so the swatch IS the
 * proof the token renders.
 */
function Swatch({
  token,
  bgClass,
  textClass = "text-ink-secondary",
}: {
  token: string;
  bgClass: string;
  textClass?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className={`inline-block size-10 rounded-md border border-border-hairline ${bgClass}`}
      />
      <span className={`text-sm ${textClass}`}>{token}</span>
    </div>
  );
}

export default function DesignPreviewPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-20">
      <header className="space-y-4">
        {/* Chinese-page H1 uses font-display (DESIGN: editorial serif for big
            titles), distinct from the sans-bold brand word on the homepage. */}
        <h1 className="text-4xl font-display font-semibold tracking-tight">设计系统预览</h1>
        <p className="text-lg text-ink-secondary">
          AGUHOT · 视觉 token 与排版基础（DESIGN V1 暖底亮色）
        </p>
      </header>

      {/* Typography samples — display (serif) / sans (body) / mono (numeric).
          Each row uses a different font family to anchor the three-layer type
          system (AC1). */}
      <section className="mt-12 space-y-4">
        <h2 className="text-xl font-semibold">排版</h2>
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-ink-tertiary">display · 衬线大标题</p>
            {/* DESIGN display token — Source Han Serif SC, serif. */}
            <p className="font-display text-3xl font-semibold">热点驱动判断</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-ink-tertiary">headline · 无衬线标题</p>
            <p className="text-2xl font-bold">今日市场要闻与编辑解释</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-ink-tertiary">title · 无衬线小标题</p>
            <p className="text-lg font-semibold">证据来源与可追溯性</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-ink-tertiary">body · 无衬线正文</p>
            <p className="text-base">每一个公开呈现的热点事件，都经过采集、聚类、解释与运营复核闭环后才会发布。</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-ink-tertiary">body-sm · 无衬线次要正文</p>
            <p className="text-sm text-ink-secondary">匿名即可浏览核心内容；登录态仅用于收藏、关注与个人偏好。</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-ink-tertiary">numeric · 等宽数字</p>
            {/* DESIGN numeric token — IBM Plex Mono via next/font/google. */}
            <p className="font-mono text-sm">+3.42% · 12,847.50 · 2026-07-10 09:30</p>
          </div>
        </div>
      </section>

      {/* Color palette — every swatch background is a token utility. */}
      <section className="mt-12 space-y-4">
        <h2 className="text-xl font-semibold">色板</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Swatch token="canvas" bgClass="bg-canvas" />
          <Swatch token="surface-base" bgClass="bg-surface-base" />
          <Swatch token="surface-raised" bgClass="bg-surface-raised" />
          <Swatch token="surface-muted" bgClass="bg-surface-muted" />
          <Swatch token="ink-primary" bgClass="bg-ink-primary" textClass="text-ink-secondary" />
          <Swatch token="ink-secondary" bgClass="bg-ink-secondary" textClass="text-ink-secondary" />
          <Swatch token="border-hairline" bgClass="bg-border-hairline" />
          <Swatch token="brand" bgClass="bg-brand" textClass="text-ink-secondary" />
          <Swatch token="brand-foreground" bgClass="bg-brand-foreground" />
          <Swatch token="accent-warm" bgClass="bg-accent-warm" textClass="text-ink-secondary" />
          <Swatch token="accent-warm-foreground" bgClass="bg-accent-warm-foreground" />
          <Swatch token="market-up" bgClass="bg-market-up" textClass="text-ink-secondary" />
          <Swatch token="market-up-soft" bgClass="bg-market-up-soft" />
          <Swatch token="market-down" bgClass="bg-market-down" textClass="text-ink-secondary" />
          <Swatch token="market-down-soft" bgClass="bg-market-down-soft" />
          <Swatch token="market-flat" bgClass="bg-market-flat" textClass="text-ink-secondary" />
          <Swatch token="market-flat-soft" bgClass="bg-market-flat-soft" />
          <Swatch token="focus-ring" bgClass="bg-focus-ring" textClass="text-ink-secondary" />
        </div>
      </section>

      {/* Component primitives — the three chips from components/chips.tsx.
          Each is driven entirely by token classes (AC2). */}
      <section className="mt-12 space-y-4">
        <h2 className="text-xl font-semibold">组件原语</h2>

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-ink-tertiary">AI 标签 · accent-warm</p>
          <AiLabel />
        </div>

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-ink-tertiary">
            筛选胶囊 · 默认 / 激活（brand）
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <FilterPill active={false}>全部</FilterPill>
            <FilterPill active={true}>市场反应</FilterPill>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-ink-tertiary">
            市场反应 · 涨 / 跌 / 平（文本 + 颜色）
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <ReactionChip tone="up" value="+3.42%" />
            <ReactionChip tone="down" value="-1.18%" />
            <ReactionChip tone="flat" value="0.00%" />
          </div>
        </div>
      </section>
    </div>
  );
}
