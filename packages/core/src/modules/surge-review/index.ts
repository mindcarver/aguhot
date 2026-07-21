export { detectSurgeDays } from "./surge-logic.js";
export { getSurgeDay, upsertSurgeDays } from "./surge-review-service.js";
export { SURGE_INDEX_CODES, SURGE_SOURCE, SURGE_THRESHOLD } from "./types.js";
export type {
  DecimalLike,
  DetectedSurgeDay,
  ForwardReturns,
  IndexBar,
  IndexSurgeDetail,
  UpsertSurgeDaysOptions,
  UpsertSurgeDaysResult,
} from "./types.js";
