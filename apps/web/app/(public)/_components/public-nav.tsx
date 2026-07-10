"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

import { SearchBox } from "./search-box";

/**
 * Responsive public navigation — Story 1.2.
 *
 * Desktop (>=768px, Tailwind `md:`): a sticky left-rail `<aside>` showing the
 * primary one-level navigation (首页 / 日报 / 主题 / 收藏 + internal 运营台).
 *
 * Mobile (<768px): a sticky top `<header>` with a hamburger button that
 * toggles an overlay drawer containing the same primary entries. The drawer
 * closes on: link navigation, overlay click, and Escape (a11y floor). Initial
 * `open=false` keeps SSR and first client render identical (no hydration
 * mismatch). The drawer uses conditional render (`open && …`) rather than an
 * animation library; toggling is instantaneous, which also satisfies
 * `prefers-reduced-motion`.
 *
 * Primary entries are identical across desktop and mobile (epic IA: nav depth
 * is one level). No auth/session dependency (AD-8): every entry is anonymously
 * reachable; `/favorites` is a placeholder and does not force login.
 */

type NavItem = {
  readonly href: string;
  readonly label: string;
};

const PRIMARY_NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "首页" },
  { href: "/daily", label: "日报" },
  { href: "/topics", label: "主题" },
  { href: "/favorites", label: "收藏" },
] as const;

const OPERATOR_NAV_ITEM: NavItem = {
  href: "/console",
  label: "运营台",
};

/**
 * Active-link heuristic for the left rail / drawer.
 *
 * The home route (`/`) is treated as active only on an exact match; every
 * other route is active on a startsWith match so sub-routes (added in later
 * stories) highlight their parent entry.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="主导航">
      {/*
        Global search entry (Story 3.1, FR12 AC3). A native HTML form (GET
        /search) rendered at the TOP of NavList so it appears in BOTH the
        desktop left-rail aside AND the mobile drawer (they share NavList).
        This is NOT a PRIMARY_NAV_ITEMS entry — the navigation.spec asserts
        "四个一级入口" (four primary entries); a `<form>` inside `<nav>` is not a
        primary link, so the existing navigation e2e assertions stay green. The
        form submits natively on Enter (keyboard) and the button meets min-h-11
        (touch target, UX-DR13). See search-box.tsx for the implicit-label /
        id-free rationale (two simultaneous instances).
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
      {/* Desktop: sticky left-rail aside (>=768px). */}
      <aside className="hidden md:flex md:w-60 md:sticky md:top-0 md:h-screen md:flex-col md:border-r md:border-border-hairline md:bg-surface-base">
        <div className="flex h-16 items-center px-6">
          <Link href="/" className="text-lg font-bold tracking-tight text-ink-primary">
            AGUHOT
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <NavList pathname={pathname} />
        </div>
      </aside>

      {/* Mobile: sticky top header + drawer (<768px). */}
      <header className="md:hidden sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border-hairline bg-surface-base px-4">
        <button
          ref={openButtonRef}
          type="button"
          onClick={toggleDrawer}
          aria-expanded={open}
          aria-controls={drawerId}
          aria-label={open ? "关闭导航菜单" : "打开导航菜单"}
          className="inline-flex size-11 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-muted hover:text-ink-primary"
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
        <Link href="/" className="text-lg font-bold tracking-tight text-ink-primary">
          AGUHOT
        </Link>
      </header>

      {/* Mobile drawer overlay + panel. Conditionally rendered (instant mount/
          unmount) so toggling is animation-free and honors reduced-motion. */}
      {open && (
        <div className="md:hidden fixed inset-0 z-30">
          {/* Overlay: click closes (a11y floor). */}
          <button
            type="button"
            aria-label="关闭导航菜单"
            tabIndex={-1}
            onClick={closeDrawer}
            className="absolute inset-0 cursor-default bg-overlay"
          />
          {/* Drawer panel sits above the overlay (z-40).
              Non-modal disclosure dialog: the intent's a11y floor requires
              Escape / overlay close / keyboard reachability, not modal focus
              confinement. Do NOT re-add `aria-modal="true"` without also
              adding a focus trap — it would promise confinement the keyboard
              path does not provide. */}
          <div
            id={drawerId}
            role="dialog"
            aria-label="导航菜单"
            className="absolute left-0 top-16 z-40 h-[calc(100vh-4rem)] w-72 max-w-[85vw] overflow-y-auto border-r border-border-hairline bg-surface-raised px-3 py-4 shadow-lg"
          >
            <NavList pathname={pathname} onNavigate={closeDrawer} />
          </div>
        </div>
      )}
    </>
  );
}
