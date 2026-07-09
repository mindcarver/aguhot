import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * apps/web ESLint flat config — Next.js 16 native flat config.
 *
 * Next.js 16 removed `next lint`; eslint-config-next now ships native flat
 * config exports that spread directly into defineConfig(). Run via
 * `eslint .` (see package.json `lint` script).
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright / test artifacts
    "playwright-report/**",
    "test-results/**",
    "e2e/**",
  ]),
]);

export default eslintConfig;
