/**
 * Self-check for `isOperatorEnabled` (the `/console/*` deployment gate).
 *
 * Run with: pnpm --filter web verify:operator-gate
 *           (tsx lib/operator-gate.selfcheck.ts)
 *
 * Pins the gate's env-classification behavior across the six meaningful
 * `(NODE_ENV, AGUHOT_OPERATOR_ENABLED)` combinations. The gate is the
 * load-bearing trust boundary for the operator write surface: in production the
 * console MUST stay closed unless the flag is exactly `"true"`. Drives:
 *   - dev/test always open (local dev + e2e seed reach `/console/*`)
 *   - production closed by default (flag unset → closed)
 *   - production opened ONLY by the exact string `"true"`
 *   - strict equality: `"false"` / `"True"` / `"1"` all closed (no truthy coercion)
 *
 * Temporarily overwrites `process.env.NODE_ENV` + `process.env.AGUHOT_OPERATOR_ENABLED`
 * and restores the originals on exit (even on assertion failure) so the
 * surrounding process is not polluted.
 *
 * Prints PASS/FAIL and exits non-zero iff any assertion fails, mirroring the
 * core/web selfcheck convention (no test framework, plain assertions +
 * process.exit).
 */

import { isOperatorEnabled } from "./operator-gate.js";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

function main(): void {
  const assertions: Assertion[] = [];

  const originalNodeEnv = process.env.NODE_ENV;
  const originalFlag = process.env.AGUHOT_OPERATOR_ENABLED;
  const hadFlag = Object.prototype.hasOwnProperty.call(
    process.env,
    "AGUHOT_OPERATOR_ENABLED",
  );

  /**
   * Mutate a single env var. `@types/node` declares `NODE_ENV` as readonly to
   * discourage accidental mutation in production code; the value IS mutable at
   * runtime, so a test-only `as Record<string, string | undefined>` cast is
   * safe and keeps the cast in one place.
   */
  function setEnvVar(name: string, value: string | undefined): void {
    const env = process.env as Record<string, string | undefined>;
    if (value === undefined) {
      delete env[name];
    } else {
      env[name] = value;
    }
  }

  function restore(): void {
    setEnvVar("NODE_ENV", originalNodeEnv);
    setEnvVar("AGUHOT_OPERATOR_ENABLED", hadFlag ? originalFlag : undefined);
  }

  function setEnv(nodeEnv: string | undefined, flag: string | undefined): void {
    setEnvVar("NODE_ENV", nodeEnv);
    setEnvVar("AGUHOT_OPERATOR_ENABLED", flag);
  }

  try {
    // --- non-production always open ------------------------------------------
    assertions.push(
      run("development, flag unset → open", () => {
        setEnv("development", undefined);
        if (!isOperatorEnabled()) throw new Error("expected open in development");
      }),
    );
    assertions.push(
      run("test, flag unset → open", () => {
        setEnv("test", undefined);
        if (!isOperatorEnabled()) throw new Error("expected open in test");
      }),
    );

    // --- production: closed by default ---------------------------------------
    assertions.push(
      run("production, flag unset → CLOSED", () => {
        setEnv("production", undefined);
        if (isOperatorEnabled()) throw new Error("expected closed when flag unset");
      }),
    );

    // --- production: opened only by exact "true" -----------------------------
    assertions.push(
      run('production, flag="true" → open', () => {
        setEnv("production", "true");
        if (!isOperatorEnabled()) throw new Error("expected open for exact true");
      }),
    );

    // --- production: explicit "false" closed ---------------------------------
    assertions.push(
      run('production, flag="false" → CLOSED', () => {
        setEnv("production", "false");
        if (isOperatorEnabled()) throw new Error("expected closed for false");
      }),
    );

    // --- production: strict match — non-"true" truthy strings closed ---------
    assertions.push(
      run('production, flag="True" → CLOSED (strict, case-sensitive)', () => {
        setEnv("production", "True");
        if (isOperatorEnabled()) throw new Error("expected closed for True");
      }),
    );
    assertions.push(
      run('production, flag="1" → CLOSED (strict, no truthy coercion)', () => {
        setEnv("production", "1");
        if (isOperatorEnabled()) throw new Error("expected closed for 1");
      }),
    );

    // --- defense-in-depth: flag is IGNORED outside production ---------------
    // A stray AGUHOT_OPERATOR_ENABLED must NOT close dev/test (the gate is
    // "non-production is always open" — the flag only matters in prod).
    assertions.push(
      run('development, flag="false" → STILL open (flag ignored outside prod)', () => {
        setEnv("development", "false");
        if (!isOperatorEnabled()) throw new Error("dev closed by flag — must stay open");
      }),
    );
    assertions.push(
      run('test, flag="garbage" → STILL open (flag ignored outside prod)', () => {
        setEnv("test", "garbage");
        if (!isOperatorEnabled()) throw new Error("test closed by flag — must stay open");
      }),
    );
  } finally {
    restore();
  }

  report(assertions);
}

/**
 * Run a case whose body MUST return normally (acceptance path). Returns an
 * Assertion: ok=true iff the body completed without throwing.
 */
function run(name: string, body: () => void): Assertion {
  try {
    body();
    return { name, ok: true };
  } catch (err) {
    return {
      name,
      ok: false,
      detail: (err as Error).message,
    };
  }
}

function report(assertions: Assertion[]): void {
  console.log("");
  console.log("=== web operator-gate isOperatorEnabled self-check ===");
  for (const a of assertions) {
    const mark = a.ok ? "PASS" : "FAIL";
    console.log(`  [${mark}] ${a.name}${a.detail ? ` — ${a.detail}` : ""}`);
  }
  const failed = assertions.filter((a) => !a.ok);
  console.log("");
  if (failed.length === 0) {
    console.log(`PASS — ${assertions.length}/${assertions.length} assertions ok`);
    process.exit(0);
  } else {
    console.error(`FAIL — ${failed.length}/${assertions.length} assertions failed`);
    process.exit(1);
  }
}

main();
