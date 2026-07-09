import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * `cn` — shadcn/ui standard class-name merge helper.
 * Generated as part of `shadcn init` (Base UI base). Kept in `@/lib/utils`
 * per `components.json` aliases.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
