/**
 * China macro adapter via akshare/Eastmoney (Issue #69).
 *
 * NBS's `easyquery.htm` is WAF-blocked (403 UrlACL) from the deployment
 * environment. akshare's `macro_china_gdp` / `macro_china_cpi_yearly` reach the
 * same NBS-sourced data via Eastmoney's API, bypassing the WAF. This module
 * spawns the sidecar's `macro` command, parses the JSON-lines output, and
 * produces `SnapshotPollTarget`s for the snapshot poll job (#68).
 *
 * Source identity is `cn-eastmoney` (not `cn-nbs`) because the data is fetched
 * from Eastmoney's API, which republishes NBS figures. The values are NBS
 * numbers, but the transport/audit trail is Eastmoney. publishedAt is stamped
 * by the snapshot store as firstCapturedAt (AD-SNAP-1).
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Prisma } from "@aguhot/core";
import type { SnapshotValueExtractor } from "@aguhot/core";
import type { SnapshotPollTarget, RawFetchResult } from "./capital-snapshot-poll.js";

const PROVIDER_ID = "cn-eastmoney";
const PROCESSING_VERSION = "eastmoney-akshare-v1";

const EASTMONEY_SOURCE = {
  id: "cn-eastmoney",
  name: "Eastmoney (via akshare, republishing NBS data)",
  dataset: "macro_china_gdp_cpi",
  documentationUrl: "https://data.eastmoney.com/cjsj/gdp.html",
} as const;

export interface MacroObservation {
  readonly metric_key: string;
  readonly market: string;
  readonly dimension: string;
  readonly observed_at: string;
  readonly value: number | null;
  readonly unit: string;
  readonly indicator: string;
  readonly source_period: string;
}

/**
 * Injectable transport for testing: runs the sidecar macro command and returns
 * parsed JSON-lines. The default implementation spawns the real sidecar.
 */
export type MacroTransport = () => Promise<readonly MacroObservation[]>;

function getSidecarCwd(): string {
  const workerSourceDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(workerSourceDir, "..", "..", "market-sidecar");
}

function defaultMacroTransport(): MacroTransport {
  return async () => {
    const cwd = getSidecarCwd();
    return new Promise((resolve, reject) => {
      const child = spawn(
        "uv",
        ["run", "python", "-m", "market_sidecar", "macro"],
        { cwd, env: process.env, stdio: ["ignore", "pipe", "inherit"] },
      );
      let stdout = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.once("error", (error) => {
        reject(new Error(`sidecar macro could not start: ${error.message}`));
      });
      child.once("exit", (code, signal) => {
        if (signal !== null) {
          reject(new Error(`sidecar macro killed by ${signal}`));
          return;
        }
        if (code !== 0) {
          reject(new Error(`sidecar macro exited with status ${String(code)}`));
          return;
        }
        const observations: MacroObservation[] = [];
        for (const line of stdout.trim().split("\n")) {
          if (line.length === 0) continue;
          try {
            observations.push(JSON.parse(line) as MacroObservation);
          } catch {
            // skip unparseable line
          }
        }
        resolve(observations);
      });
    });
  };
}

/**
 * The value extractor for Eastmoney snapshots. The rawPayload stored by the
 * snapshot poll job is the full MacroObservation JSON; this extracts the
 * numeric value + unit + source.
 */
export const eastmoneyExtractor: SnapshotValueExtractor = (snapshot) => {
  const payload = snapshot.rawPayload as Partial<MacroObservation> & { value?: unknown };
  const raw = payload.value;
  const value = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  return {
    value,
    unit: (payload.unit as string | undefined) ?? null,
    source: EASTMONEY_SOURCE,
  };
};

/**
 * Build the fetchLatest closure for one metric. Filters the shared sidecar
 * output to this metric's observation. Returns null when the metric is absent
 * (not yet published) so the poller treats it as "try next tick".
 */
function makeFetchLatest(
  metricKey: string,
  transport: MacroTransport,
): () => Promise<RawFetchResult | null> {
  return async () => {
    const observations = await transport();
    const obs = observations.find((o) => o.metric_key === metricKey);
    if (obs === undefined) return null;
    return {
      metricKey: obs.metric_key,
      market: obs.market,
      dimension: obs.dimension,
      observedAt: obs.observed_at,
      rawPayload: obs as unknown as Prisma.InputJsonValue,
    };
  };
}

/**
 * Resolve the Eastmoney snapshot poll targets (GDP YoY + CPI YoY). Used by
 * the snapshot poll job's resolveSnapshotPollTargets (#68).
 *
 * `transport` is injectable for testing; production uses the real sidecar spawn.
 */
export function resolveEastmoneyTargets(
  transport: MacroTransport = defaultMacroTransport(),
): SnapshotPollTarget[] {
  const metrics = ["cn-growth", "cn-inflation"];
  return metrics.map((metricKey) => ({
    providerId: PROVIDER_ID,
    processingVersion: PROCESSING_VERSION,
    fetchLatest: makeFetchLatest(metricKey, transport),
    extractor: eastmoneyExtractor,
  }));
}
