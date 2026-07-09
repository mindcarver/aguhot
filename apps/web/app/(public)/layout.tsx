import type { ReactNode } from "react";
import { PublicNav } from "./_components/public-nav";

/**
 * Responsive public shell — Story 1.2.
 *
 * Group-level layout for the `(public)` route group. The root `layout.tsx`
 * owns `<html>/<body>`; this layout wraps every `(public)` route in the
 * responsive shell (desktop left-rail nav + main area; mobile top bar +
 * drawer). It deliberately does NOT wrap `(operator)/console`, which stays a
 * bare placeholder until Story 1.6.
 *
 * Desktop (>=768px, `md:`): flex row — `<PublicNav>` renders the sticky
 * left-rail `<aside>`, and `<main>` takes the remaining width with
 * `min-w-0` so long content cannot push the rail off-screen.
 *
 * Mobile (<768px): block flow — `<PublicNav>` renders the sticky top
 * `<header>` (and the conditionally-rendered drawer); `<main>` stacks below.
 */
export default function PublicLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="min-h-screen md:flex">
      <PublicNav />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
