/** Manual, repeatable detection/projection runner for GitHub #30. */
import {
  getPrisma,
  newTraceId,
  refreshPublishedSurgeDays,
  upsertSurgeDays,
} from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

resetEnvCache();
requireEnv("DATABASE_URL");

const value = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const fromDay = value("--from");
const toDay = value("--to");
const isValidCalendarDay = (day: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return new Date(`${day}T00:00:00.000Z`).toISOString().slice(0, 10) === day;
};
if ([fromDay, toDay].some((day) => day !== undefined && !isValidCalendarDay(day))) {
  throw new Error("--from/--to must be YYYY-MM-DD");
}

const prisma = getPrisma();
const traceId = newTraceId();
const detected = await upsertSurgeDays({ prisma, traceId, fromDay, toDay });
console.log(`surge-review: ${detected.upserted} upserted, ${detected.pruned} pruned`);

const published = await refreshPublishedSurgeDays({ prisma, traceId, fromDay, toDay });
console.log(`surge-calendar: ${published.projected} projected, ${published.pruned} pruned`);
await prisma.$disconnect();
