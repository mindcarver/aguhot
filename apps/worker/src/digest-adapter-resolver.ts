/**
 * Digest adapter resolver (worker runtime) — wires the real LLM-backed digest
 * adapter into the daily-digest queue. Mirrors llm-adapter-resolver.
 *
 * Reads the SAME LLM_* env the reason/deepread/trend adapter uses (one provider
 * serves all AI text) and returns an OpenAiCompatibleDigestAdapter when all three
 * are present, or undefined otherwise (honest degradation — generateDailyDigest
 * returns null → no row written). The adapter is constructed with the prisma
 * client (it loads per-event context itself, since the DigestAdapter port
 * receives only hotEventIds).
 *
 * Resolved once per job (cheap — env reads + one allocation; the adapter is
 * stateless apart from the prisma handle).
 */

import type { OpenAiCompatibleDigestAdapterOptions, DigestAdapter } from "@aguhot/core";
import { OpenAiCompatibleDigestAdapter, getPrisma } from "@aguhot/core";

export function resolveDigestAdapter(prisma: ReturnType<typeof getPrisma>): DigestAdapter | undefined {
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  if (baseUrl === undefined || baseUrl === "") return undefined;
  if (apiKey === undefined || apiKey === "") return undefined;
  if (model === undefined || model === "") return undefined;
  const opts: OpenAiCompatibleDigestAdapterOptions = { prisma, baseUrl, apiKey, model };
  return new OpenAiCompatibleDigestAdapter(opts);
}
