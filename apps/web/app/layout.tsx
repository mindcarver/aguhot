import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

/**
 * Numeric-layer font — Story 1.3.
 *
 * `IBM Plex Mono` is the DESIGN `numeric` token. It is loaded via
 * `next/font/google` (a Next.js built-in, self-hosted at build time) with the
 * single weight DESIGN specifies (500) and `display: "swap"`. Its CSS variable
 * (`--font-plex-mono`) is consumed by the `--font-mono` token in globals.css
 * `@theme`, so every `font-mono` utility resolves to Plex Mono first and falls
 * back to the OS monospace stack if the variable is ever absent.
 *
 * `subsets: ["latin"]` — Plex Mono is only the numeric/latin layer; CJK
 * display (Source Han Serif SC) and body (Source Han Sans SC) are NOT webfonts
 * here — they are OS font-family stacks (see globals.css `--font-display` /
 * `--font-sans`), which avoids bundling multi-megabyte CJK subsets.
 */
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "AGUHOT",
    template: "%s · AGUHOT",
  },
  description: "可信热点发布闭环 — 公共首页",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // `lang="zh-CN"` is the document language. `suppressHydrationWarning` was a
    // theme-provider template leftover with no backing theme logic (1.1/1.2
    // deferred item) — removed in 1.3: DESIGN V1 is warm-light only, there is
    // no `.dark` class toggle on <html>, so there is nothing that can produce a
    // root hydration mismatch to suppress.
    <html lang="zh-CN" className={plexMono.variable}>
      {/* Canvas + ink + default font live here (single source for the page
          chrome), not in `@layer base`, to avoid double-writing them. */}
      <body className="bg-canvas text-ink-primary font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
