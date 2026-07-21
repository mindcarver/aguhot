import { getPrisma, resetPrisma } from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";
import { Prisma } from "../../../packages/core/generated/client.js";

const FIXTURE_TRACE_ID = "surge-calendar-e2e-fixture";

export const SURGE_FIXTURE = {
  completeDate: "2031-06-18",
  incompleteDate: "2031-06-19",
} as const;

/**
 * Seed only two tagged public read-model rows for the surge-calendar browser
 * contract. Cleanup deletes solely this fixture's rows, so the seed neither
 * rewrites raw market data nor touches the independent crash read model.
 */
export async function seedSurgeCalendar(): Promise<void> {
  resetEnvCache();
  requireEnv("DATABASE_URL");
  const prisma = getPrisma();

  await prisma.publishedSurgeDay.deleteMany({ where: { traceId: FIXTURE_TRACE_ID } });
  await prisma.publishedSurgeDay.upsert({
    where: { tradeDate: new Date(`${SURGE_FIXTURE.completeDate}T00:00:00.000Z`) },
    create: {
      tradeDate: new Date(`${SURGE_FIXTURE.completeDate}T00:00:00.000Z`),
      threshold: 2,
      surgeCount: 2,
      indices: [
        { indexCode: "sh000001", pctChange: 2.18, close: 3500, surged: true, forwardReturns: { t1: 0.75, t5: 1.25, t20: null } },
        { indexCode: "sz399001", pctChange: 2.64, close: 11200, surged: true, forwardReturns: { t1: -0.2, t5: 0.45, t20: 3.1 } },
        { indexCode: "sz399006", pctChange: 1.05, close: 2400, surged: false, forwardReturns: { t1: 0.1, t5: null, t20: null } },
      ],
      leadingSectors: [
        { sectorCode: "801080", sectorName: "电子", pctChange: 4.4 },
        { sectorCode: "801750", sectorName: "计算机", pctChange: 3.2 },
      ],
      breadth: {
        limitUpCount: 38,
        limitDownCount: 1,
        consecutiveBoardMax: 4,
        brokenBoardCount: 12,
        advancingCount: 3921,
        decliningCount: 102,
        flatCount: 48,
        totalTurnover: 12345.67,
        marginBalanceChange: 5.4,
        dragonTiger: null,
      },
      source: "e2e-fixture",
      traceId: FIXTURE_TRACE_ID,
    },
    update: {
      threshold: 2,
      surgeCount: 2,
      indices: [
        { indexCode: "sh000001", pctChange: 2.18, close: 3500, surged: true, forwardReturns: { t1: 0.75, t5: 1.25, t20: null } },
        { indexCode: "sz399001", pctChange: 2.64, close: 11200, surged: true, forwardReturns: { t1: -0.2, t5: 0.45, t20: 3.1 } },
        { indexCode: "sz399006", pctChange: 1.05, close: 2400, surged: false, forwardReturns: { t1: 0.1, t5: null, t20: null } },
      ],
      leadingSectors: [
        { sectorCode: "801080", sectorName: "电子", pctChange: 4.4 },
        { sectorCode: "801750", sectorName: "计算机", pctChange: 3.2 },
      ],
      breadth: {
        limitUpCount: 38,
        limitDownCount: 1,
        consecutiveBoardMax: 4,
        brokenBoardCount: 12,
        advancingCount: 3921,
        decliningCount: 102,
        flatCount: 48,
        totalTurnover: 12345.67,
        marginBalanceChange: 5.4,
        dragonTiger: null,
      },
      source: "e2e-fixture",
      traceId: FIXTURE_TRACE_ID,
    },
  });
  await prisma.publishedSurgeDay.upsert({
    where: { tradeDate: new Date(`${SURGE_FIXTURE.incompleteDate}T00:00:00.000Z`) },
    create: {
      tradeDate: new Date(`${SURGE_FIXTURE.incompleteDate}T00:00:00.000Z`),
      threshold: 2,
      surgeCount: 1,
      indices: [
        { indexCode: "sh000001", pctChange: 2.01, close: 3510, surged: true, forwardReturns: { t1: null, t5: null, t20: null } },
        { indexCode: "sz399001", pctChange: null, close: null, surged: false, forwardReturns: null },
        { indexCode: "sz399006", pctChange: null, close: null, surged: false, forwardReturns: null },
      ],
      leadingSectors: [],
      breadth: Prisma.DbNull,
      source: "e2e-fixture",
      traceId: FIXTURE_TRACE_ID,
    },
    update: {
      threshold: 2,
      surgeCount: 1,
      indices: [
        { indexCode: "sh000001", pctChange: 2.01, close: 3510, surged: true, forwardReturns: { t1: null, t5: null, t20: null } },
        { indexCode: "sz399001", pctChange: null, close: null, surged: false, forwardReturns: null },
        { indexCode: "sz399006", pctChange: null, close: null, surged: false, forwardReturns: null },
      ],
      leadingSectors: [],
      breadth: Prisma.DbNull,
      source: "e2e-fixture",
      traceId: FIXTURE_TRACE_ID,
    },
  });
  resetPrisma();
}

export async function clearSurgeCalendarFixture(): Promise<void> {
  const prisma = getPrisma();
  await prisma.publishedSurgeDay.deleteMany({ where: { traceId: FIXTURE_TRACE_ID } });
  resetPrisma();
}
