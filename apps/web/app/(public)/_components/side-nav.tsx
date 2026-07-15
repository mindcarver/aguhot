"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Left sidebar navigation — Epic 6 视觉对齐参考站 (aihot.virxact.com) two-column
 * shell. A sticky left rail on md+ (精选 / 日报 / 主题 / 搜索 / 收藏 + 接入 + 更多),
 * collapsing to a sticky horizontal top bar on mobile. Replaces the V1 top
 * `<PublicNav>` desktop surface; `<PublicNav>`'s mobile drawer is retained below
 * md so mobile keeps its full nav + SearchBox.
 *
 * Client component: active-state needs `usePathname` (the route group `(public)`
 * is transparent to the pathname, so `/daily` etc. match literally). `"/"` is
 * active only on the exact homepage (not on every nested route).
 */

interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Exact-match active (homepage only); others use startsWith. */
  exact?: boolean;
}

const CONTENT: NavItem[] = [
  { href: "/", label: "精选", icon: "★", exact: true },
  { href: "/daily", label: "A股日报", icon: "▤" },
  { href: "/crash-calendar", label: "大跌日历", icon: "▿" },
  { href: "/topics", label: "主题", icon: "⊞" },
  { href: "/search", label: "搜索", icon: "⌕" },
  { href: "/favorites", label: "收藏", icon: "🔖" },
];

const MORE: NavItem[] = [
  { href: "/about", label: "关于", icon: "❤" },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact === true) return pathname === "/";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function SideNav() {
  const pathname = usePathname();
  return (
    <aside
      className="sticky top-0 hidden h-screen w-[220px] shrink-0 overflow-y-auto border-r border-border-hairline bg-surface-base px-3.5 py-5 md:block"
      aria-label="主导航"
    >
      <div className="px-2.5 font-display text-lg font-bold tracking-wide text-brand">AGUHOT</div>

      <nav className="mt-5 text-[13.5px]">
        <SidebarGroup title="内容">
          {CONTENT.map((item) => (
            <SidebarLink key={item.href} item={item} active={isActive(pathname, item)} />
          ))}
        </SidebarGroup>
        <SidebarGroup title="更多">
          {MORE.map((item) => (
            <SidebarLink key={item.href} item={item} active={isActive(pathname, item)} />
          ))}
        </SidebarGroup>
      </nav>
    </aside>
  );
}

function SidebarGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <div className="px-2.5 pb-1.5 text-[11px] uppercase tracking-[.12em] text-ink-tertiary">
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-ink-secondary hover:bg-surface-muted hover:text-ink-primary ${active ? "bg-indigo-50 font-semibold text-brand" : ""}`}
    >
      <span className="w-4 text-center opacity-80">{item.icon}</span>
      <span>{item.label}</span>
    </Link>
  );
}
