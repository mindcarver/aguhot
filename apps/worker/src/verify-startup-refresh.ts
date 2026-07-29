import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { enqueueStartupRefreshes } from "./startup-refresh.js";

const calls: Array<{
  queue: "pipeline" | "market";
  traceId: string;
  deduplication: { id: string; ttl?: number } | undefined;
}> = [];
const traceIds = ["trace-pipeline", "trace-market"];

const startupResult = await enqueueStartupRefreshes({
  newTraceId: () => traceIds.shift() ?? "unexpected-trace",
  enqueuePipelineRefresh: async (traceId, options) => {
    calls.push({
      queue: "pipeline",
      traceId,
      deduplication: options.deduplication,
    });
    return { id: "pipeline-job" };
  },
  enqueueMarketDataRefresh: async (traceId, options) => {
    calls.push({
      queue: "market",
      traceId,
      deduplication: options.deduplication,
    });
    return { id: "market-job" };
  },
});

assert.deepEqual(startupResult, {
  pipelineJobId: "pipeline-job",
  marketDataJobId: "market-job",
});
assert.deepEqual(calls, [
  {
    queue: "pipeline",
    traceId: "trace-pipeline",
    deduplication: {
      id: "worker-startup",
    },
  },
  {
    queue: "market",
    traceId: "trace-market",
    deduplication: {
      id: "worker-startup",
    },
  },
]);

const rootPackage = JSON.parse(
  await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
) as { scripts?: Record<string, string> };
const devScript = rootPackage.scripts?.dev;
const devDependenciesScript = rootPackage.scripts?.["dev:deps"];

assert.equal(typeof devScript, "string", "root package.json must expose pnpm dev");
if (typeof devScript !== "string") {
  throw new Error("root package.json must expose pnpm dev");
}
assert.equal(typeof devDependenciesScript, "string", "root package.json must expose pnpm dev:deps");
if (typeof devDependenciesScript !== "string") {
  throw new Error("root package.json must expose pnpm dev:deps");
}
assert.match(devScript, /pnpm dev:deps/, "pnpm dev must start local dependencies");
assert.match(devScript, /\. \.\/\.env/, "pnpm dev must load the repo-root .env");
assert.match(devScript, /@aguhot\/web/, "pnpm dev must start the web workspace");
assert.match(devScript, /@aguhot\/worker/, "pnpm dev must start the worker workspace");
assert.match(
  devDependenciesScript,
  /127\.0\.0\.1:1200/,
  "pnpm dev:deps must check the local RSSHub",
);
assert.match(
  devDependenciesScript,
  /docker compose up/,
  "pnpm dev:deps must start RSSHub when it is absent",
);

const compose = await readFile(new URL("../../../compose.yaml", import.meta.url), "utf8");
assert.match(compose, /diygod\/rsshub@sha256:/, "RSSHub image must be pinned");
assert.match(compose, /127\.0\.0\.1:1200:1200/, "RSSHub must bind to loopback only");

const pipelineRefreshSource = await readFile(
  new URL("./queues/pipeline-refresh-queue.ts", import.meta.url),
  "utf8",
);
const approveStage = pipelineRefreshSource.indexOf("const toApprove =");
const optionalReasonStage = pipelineRefreshSource.indexOf("const llmAdapter =");
assert.ok(approveStage >= 0, "pipeline refresh must contain the publish stage");
assert.ok(optionalReasonStage >= 0, "pipeline refresh must contain the optional reason stage");
assert.ok(
  approveStage < optionalReasonStage,
  "optional LLM enrichment must not block the publish stage",
);

console.log("startup refresh verification passed");
