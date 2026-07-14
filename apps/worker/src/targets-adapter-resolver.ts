/**
 * Targets adapter resolver (worker runtime) — wires the Claude Agent SDK into the
 * investment-targets BullMQ queue.
 *
 * Mirrors llm-adapter-resolver: reads env and returns a HeadlessAgentTargetsAdapter
 * when the required vars are present + the skill file is readable, or undefined
 * otherwise (preserving honest degradation — no adapter → generateInvestmentTargets
 * returns null → no rows written, NFR-2).
 *
 * Env vars (process.env; .env gitignored):
 *   - ANTHROPIC_AUTH_TOKEN  SDK Bearer auth (the bundled executable reads this —
 *                           used by Anthropic-compatible gateways like BigModel/GLM).
 *   - ANTHROPIC_API_KEY     alt SDK auth (x-api-key). Either this or AUTH_TOKEN.
 *   - ANTHROPIC_BASE_URL    optional; points the SDK at a compatible endpoint
 *                           (e.g. https://open.bigmodel.cn/api/anthropic for GLM).
 *   - AGENT_MODEL           model id/alias the endpoint accepts (e.g. "glm-5.2").
 *   - AGENT_SKILL_PATH   optional; defaults to ~/.claude/skills/ashare-news-
 *                        investment-targets/SKILL.md (where install.sh symlinks it).
 *   - AGENT_MAX_BUDGET_USD  optional, default 2 (per-event USD ceiling).
 *   - AGENT_MAX_TURNS    optional, default 40.
 *   - AGENT_TIMEOUT_MS   optional, default 280000 (sits under the BullMQ 300s cap).
 *   - AGENT_SCRATCH_DIR  optional, default os.tmpdir()/aguhot-agent.
 *
 * Resolved once per queue job (cheap — env reads + one allocation; the adapter is
 * stateless). Per-job resolve picks up env changes without a worker restart.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

import type { TargetsAdapter } from "@aguhot/core";

import {
  HeadlessAgentTargetsAdapter,
  defaultSkillPath,
} from "./headless-agent-targets-adapter.js";

/**
 * Resolve the targets adapter from env. Returns the SDK-backed adapter when an
 * auth token (ANTHROPIC_AUTH_TOKEN OR ANTHROPIC_API_KEY) + AGENT_MODEL are present
 * AND the skill file exists; returns undefined otherwise (honest degradation — the
 * generator writes nothing). ANTHROPIC_BASE_URL is passed through by the SDK
 * subprocess from process.env (no resolver check needed — its absence just means
 * the default Anthropic endpoint).
 */
export function resolveTargetsAdapter(): TargetsAdapter | undefined {
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.AGENT_MODEL;
  if ((authToken === undefined || authToken === "") && (apiKey === undefined || apiKey === "")) {
    return undefined;
  }
  if (model === undefined || model === "") return undefined;

  const skillPath = process.env.AGENT_SKILL_PATH && process.env.AGENT_SKILL_PATH !== ""
    ? process.env.AGENT_SKILL_PATH
    : defaultSkillPath();
  // Missing/unreadable skill → degrade (don't throw at construction). A machine
  // without the skill installed should no-op, not crash the worker boot.
  if (!existsSync(skillPath)) return undefined;

  const maxBudgetUsd = parsePositiveNumber(process.env.AGENT_MAX_BUDGET_USD, 2);
  const maxTurns = parsePositiveInt(process.env.AGENT_MAX_TURNS, 40);
  const timeoutMs = parsePositiveInt(process.env.AGENT_TIMEOUT_MS, 600_000);
  const scratchDir = process.env.AGENT_SCRATCH_DIR && process.env.AGENT_SCRATCH_DIR !== ""
    ? process.env.AGENT_SCRATCH_DIR
    : join(tmpdir(), "aguhot-agent");
  // Ensure the scratch cwd exists — the SDK spawns the native binary with this cwd,
  // and a non-existent cwd makes the spawn fail ("binary failed to launch").
  mkdirSync(scratchDir, { recursive: true });

  return new HeadlessAgentTargetsAdapter({
    model,
    maxBudgetUsd,
    maxTurns,
    skillPath,
    scratchDir,
    timeoutMs,
  });
}

function parsePositiveNumber(v: string | undefined, fallback: number): number {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parsePositiveInt(v: string | undefined, fallback: number): number {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
