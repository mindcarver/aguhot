"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

import { SearchBox } from "./search-box";

/**
 * Top-bar public navigation — Story 6.1 (Epic 6 视觉对齐参考站).
 *
 * Replaces the V1 desktop left-rail `<aside>` (Story 1.2) with a sticky
 * top-bar窄条 visible at ALL widths — aligning with the reference site's
 * chromeless editorial-column form (UX-DR3, 2026-07-12 rewrite). The mobile
 * drawer behavior (1.2) is preserved verbatim; only the desktop surface
 * changed from a left rail to a horizontal top bar.
 *
 * Desktop (>=768px, `md:`): sticky `<header>` (role=banner) — brand left,
 * horizontal primary links (首页 / 日报 / 主题 / 收藏) + 运营台 + `<SearchBox>`
 * right. Active link carries a brand-color bottom underline
 * (`aria-current="page"` + `border-b-brand`).
 *
 * Mobile (<768px): the same sticky `<header>` shows brand + hamburger; the
 * hamburger toggles an overlay drawer containing `<DrawerNav>` (SearchBox +
 * vertical links + 运营台). Drawer closes on: link navigation, overlay click,
 * Escape (a11y floor, 1.2). Initial `open=false` keeps SSR + first client
 * render identical (no hydration mismatch). Conditional render (no animation
 * library) — toggling is instantaneous, satisfying `prefers-reduced-motion`.
 *
 * Primary entries are identical across desktop and mobile (epic IA: nav depth
 * one level). No auth/session dependency (AD-8): every entry anonymously
 * reachable; `/favorites` is a placeholder, does not force login.
 *
 * Implementation decision (Dev Agent Record): the 6.1 spec's Code Map listed
 * a NEW `top-nav.tsx`, but `PublicNav` already contained the nav items,
 * active-state heuristic, drawer logic, Escape/overlay close, and SearchBox.
 * Creating a separate TopNav would duplicate ~150 lines. Per the project's
 * lazy-diff convention, PublicNav was reworked in place to render a top bar at
 * all widths instead of a left rail — same ACs, shortest diff, zero logic
 * duplication. The file/name is retained.
 */

type NavItem = {
  readonly href: string;
  readonly label: string;
};

const PRIMARY_NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "首页" },
  { href: "/daily", label: "日报" },
  { href: "/crash-calendar", label: "大跌日历" },
  { href: "/surge-calendar", label: "大涨日历" },
  { href: "/market-breadth", label: "涨跌停历史" },
  { href: "/topics", label: "主题" },
  { href: "/favorites", label: "收藏" },
] as const;

const OPERATOR_NAV_ITEM: NavItem = {
  href: "/console",
  label: "运营台",
};

/**
 * Active-link heuristic.
 *
 * The home route (`/`) is active only on an exact match; every other route is
 * active on a startsWith match so sub-routes highlight their parent entry.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Desktop horizontal nav links — rendered inside the sticky top `<header>` at
 * `md:` widths. Active link gets a brand-color bottom underline; inactive
 * links carry a transparent border so the underline slot is reserved (no
 * layout shift when activation flips). `min-h-11` keeps the touch target floor
 * (UX-DR13). Wrapped in `<nav aria-label="主导航">` so the landmark is
 * reachable via `getByRole("navigation")`.
 */
function DesktopNav({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="主导航" className="hidden md:block">
      <ul className="flex items-center gap-5">
        {PRIMARY_NAV_ITEMS.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
              className={cn(
                "inline-flex min-h-14 items-center border-b-2 px-1 text-sm",
                isActive(pathname, item.href)
                  ? "border-white font-semibold text-white"
                  : "border-transparent text-white/70 hover:text-white",
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
        <li>
          <Link
            href={OPERATOR_NAV_ITEM.href}
            aria-current={isActive(pathname, OPERATOR_NAV_ITEM.href) ? "page" : undefined}
            className={cn(
              "inline-flex min-h-14 items-center border-b-2 px-1 text-xs",
              isActive(pathname, OPERATOR_NAV_ITEM.href)
                ? "border-white font-semibold text-white"
                : "border-transparent text-white/55 hover:text-white",
            )}
          >
            {OPERATOR_NAV_ITEM.label}
          </Link>
        </li>
      </ul>
    </nav>
  );
}

/**
 * Mobile drawer nav — SearchBox + vertical links + 运营台. Identical to the
 * 1.2 NavList (kept vertical for the drawer surface). `onNavigate` closes the
 * drawer on link click.
 */
function DrawerNav({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="主导航">
      {/*
        Global search entry (Story 3.1, FR12 AC3). A native HTML form (GET
        /search) at the TOP of the drawer nav. id-free (two-instances rationale
        in search-box.tsx) — the desktop `<SearchBox>` in the header is a
        separate instance, only one is visible at a time (md:flex / md:hidden).
      */}
      <div className="mb-4">
        <SearchBox />
      </div>
      <ul className="space-y-1">
        {PRIMARY_NAV_ITEMS.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
              className={cn(
                "block min-h-11 rounded-md px-3 py-2 text-base",
                isActive(pathname, item.href)
                  ? "bg-surface-muted font-semibold text-ink-primary"
                  : "text-ink-secondary hover:bg-surface-base hover:text-ink-primary",
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-6 border-t border-border-hairline pt-4">
        <p className="px-3 pb-2 text-xs uppercase tracking-wide text-ink-tertiary">内部入口</p>
        <Link
          href={OPERATOR_NAV_ITEM.href}
          onClick={onNavigate}
          aria-current={isActive(pathname, OPERATOR_NAV_ITEM.href) ? "page" : undefined}
          className={cn(
            "block min-h-11 rounded-md px-3 py-2 text-base",
            isActive(pathname, OPERATOR_NAV_ITEM.href)
              ? "bg-surface-muted font-semibold text-ink-primary"
              : "text-ink-secondary hover:bg-surface-base hover:text-ink-primary",
          )}
        >
          {OPERATOR_NAV_ITEM.label}
        </Link>
      </div>
    </nav>
  );
}

export function PublicNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Stable, SSR-safe id for aria-controls / overlay labelling.
  const drawerId = useId();
  const openButtonRef = useRef<HTMLButtonElement | null>(null);

  // Auto-close the drawer on any route change — link click or browser
  // back/forward — WITHOUT setState in an effect (React 19's
  // react-hooks/set-state-in-effect rule disallows that). Instead we adjust
  // state during render, the React-endorsed pattern for "reset state when an
  // external value changes": keep the pathname from the previous render and,
  // if it differs, reset `open`. The guard prevents a render loop, and because
  // this runs during render (not in an effect) it does not cascade.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  const toggleDrawer = useCallback(() => {
    setOpen((value) => !value);
  }, []);

  const closeDrawer = useCallback(() => {
    setOpen(false);
  }, []);

  // Close on Escape while the drawer is open (a11y floor). This effect only
  // subscribes to a DOM event (an external system) — it does NOT call setState
  // synchronously in its body, so it satisfies react-hooks/set-state-in-effect.
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        closeDrawer();
        // Return focus to the trigger so the keyboard user isn't stranded.
        openButtonRef.current?.focus();
      }
    },
    [open, closeDrawer],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  return (
    <>
      {/*
        Sticky top-bar header (role=banner) at ALL widths. Story 6.1: the V1
        desktop left-rail `<aside>` is removed; the 1.2 mobile top header is
        promoted to the universal surface. Translucent canvas + backdrop-blur
        so scrolling content passes under it lightly (reference-site form).
        `border-b-border-hairline` anchors the bar to the editorial column.
      */}
      {/*
        Sticky navy masthead (role=banner) at ALL widths. 2026-07-15: flipped
        from the chromeless translucent canvas bar to a solid brand-navy bar so
        the 蓝白格调 reads unambiguously (a near-white cool canvas alone was too
        subtle). This deliberately revises the UX-DR3 "chromeless editorial"
        stance — the user prioritised a visible blue-white premium register.
        White brand + light links + white active underline on navy.
      */}
      <header className="sticky top-0 z-40 border-b border-black/20 bg-brand">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-6 px-6">
          <Link href="/" className="font-display text-lg font-bold tracking-tight text-white">
            AGUHOT
          </Link>

          {/*
            Desktop: horizontal nav links (ml-auto pushes the cluster right).
            `SearchBox` is a sibling of `<DesktopNav>` so the form is not nested
            inside the `<nav>` landmark (it is its own `<form role="search">`).
          */}
          <div className="ml-auto hidden items-center gap-5 md:flex">
            <DesktopNav pathname={pathname} />
            {/*
              Compact variant (Story 6.1 review-followup, Codex P1): the
              stacked SearchBox (two `min-h-11` rows = 88px) overflows the
              `h-14` (56px) top bar. Compact renders input + button on one row
              (each 44px ≤ 56px), keeping the a11y INPUT reachable + the
              touch-target floor. The drawer keeps the stacked variant.
            */}
            <SearchBox variant="compact" />
          </div>

          {/*
            Mobile: hamburger toggle (md:hidden). Same button as 1.2; the
            accessible name flips with `open` (打开/关闭导航菜单), so
            navigation.spec locators use the regex `/导航菜单/` to survive the
            toggle.
          */}
          <button
            ref={openButtonRef}
            type="button"
            onClick={toggleDrawer}
            aria-expanded={open}
            aria-controls={drawerId}
            aria-label={open ? "关闭导航菜单" : "打开导航菜单"}
            className="ml-auto inline-flex size-11 items-center justify-center rounded-md text-white/80 hover:bg-white/10 hover:text-white md:hidden"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="size-6"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {open ? (
                <>
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="6" y1="18" x2="18" y2="6" />
                </>
              ) : (
                <>
                  <line x1="4" y1="7" x2="20" y2="7" />
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <line x1="4" y1="17" x2="20" y2="17" />
                </>
              )}
            </svg>
          </button>
        </div>
      </header>

      {/*
        Mobile drawer overlay + panel. Conditionally rendered (instant mount/
        unmount) so toggling is animation-free and honors reduced-motion. Top
        offset = header height (h-14 = 3.5rem = top-14).
      */}
      {open && (
        <div className="fixed inset-0 z-30 md:hidden">
          {/* Overlay: click closes (a11y floor). */}
          <button
            type="button"
            aria-label="关闭导航菜单"
            tabIndex={-1}
            onClick={closeDrawer}
            className="absolute inset-0 cursor-default bg-overlay"
          />
          {/* Drawer panel sits above the overlay (z-40). Non-modal disclosure
              dialog: the a11y floor requires Escape / overlay close / keyboard
              reachability, not modal focus confinement. Do NOT re-add
              `aria-modal="true"` without a focus trap. */}
          <div
            id={drawerId}
            role="dialog"
            aria-label="导航菜单"
            className="absolute left-0 top-14 z-40 h-[calc(100vh-3.5rem)] w-72 max-w-[85vw] overflow-y-auto border-r border-border-hairline bg-surface-raised px-3 py-4 shadow-lg"
          >
            <DrawerNav pathname={pathname} onNavigate={closeDrawer} />
          </div>
        </div>
      )}
    </>
  );
}
