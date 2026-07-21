import type { PrismaClient } from "../../../generated/client.js";

/** A day is a surge day when any tracked broad index gains at least this percent. */
export const SURGE_THRESHOLD = 2.0;
export const SURGE_INDEX_CODES = ["sh000001", "sz399001", "sz399006"] as const;
export const SURGE_SOURCE = "akshare" as const;

export interface DecimalLike {
  toNumber(): number;
}

export interface IndexBar {
  indexCode: string;
  tradeDate: Date;
  pctChange: DecimalLike;
  close: DecimalLike;
}

export interface ForwardReturns {
  t1: number | null;
  t5: number | null;
  t20: number | null;
}

export interface IndexSurgeDetail {
  indexCode: string;
  pctChange: number | null;
  close: number | null;
  surged: boolean;
  forwardReturns: ForwardReturns | null;
}

export interface DetectedSurgeDay {
  tradeDay: string;
  threshold: number;
  surgeCount: number;
  indices: IndexSurgeDetail[];
}

export interface UpsertSurgeDaysOptions {
  prisma: PrismaClient;
  traceId: string;
  fromDay?: string;
  toDay?: string;
  threshold?: number;
}

export interface UpsertSurgeDaysResult {
  upserted: number;
  pruned: number;
  surgeDays: DetectedSurgeDay[];
  threshold: number;
  barsByIndex: Record<string, number>;
  traceId: string;
}
