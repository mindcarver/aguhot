/**
 * LLM adapter resolver (worker runtime) — wires the real LLM provider into the
 * explanation pipeline's three BullMQ queues (recommendation-reason /
 * deep-read / daily-digest trend-briefing).
 *
 * Story 5.1 left the injection point as `const adapter = undefined` (real
 * provider procurement deferred). This resolver reads three env vars and
 * returns an OpenAiCompatibleLlmAdapter when ALL are present, or `undefined`
 * when any is missing — preserving the unchanged 5.1 honest-degradation
 * default (no adapter → generators return null → no AI content written →
 * prod degrades honestly, NFR-2).
 *
 * Env vars (read from process.env; .env is gitignored line 30 so the key
 * never enters git):
 *   - LLM_BASE_URL  e.g. "https://api.aicodewith.com" (no trailing slash; the
 *                    adapter appends "/v1/chat/completions").
 *   - LLM_API_KEY   the Bearer token (e.g. "sk-acw-…"). SECRET — never log.
 *   - LLM_MODEL     the model name (e.g. "gpt5.5"). Recorded in modelId.
 *   - LLM_PROVIDER_TAG  optional, for the modelId prefix (default
 *                    "openai-compat" → modelId "openai-compat:{model}").
 *
 * The resolver is called once per queue job (cheap — three env reads + one
 * allocation). It does NOT cache the adapter instance across jobs because the
 * adapter is stateless (no connection pool) and a per-job resolve picks up env
 * changes without a worker restart (useful in dev).
 */

import { OpenAiCompatibleLlmAdapter, type LLMAdapter } from "@aguhot/core";

/**
 * Resolve the LLM adapter from env. Returns the real adapter when all three
 * required vars are present + non-empty; returns undefined otherwise (honest
 * degradation — the generators write nothing).
 */
export function resolveLlmAdapter(): LLMAdapter | undefined {
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  // Any missing/empty var → no adapter (honest degradation). This is the
  // unchanged 5.1 default when the provider isn't procured.
  if (baseUrl === undefined || baseUrl === "") return undefined;
  if (apiKey === undefined || apiKey === "") return undefined;
  if (model === undefined || model === "") return undefined;
  const providerTag = process.env.LLM_PROVIDER_TAG;
  return new OpenAiCompatibleLlmAdapter({
    baseUrl,
    apiKey,
    model,
    providerTag: providerTag !== "" && providerTag !== undefined ? providerTag : undefined,
  });
}
