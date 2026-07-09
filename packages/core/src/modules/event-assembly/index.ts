/**
 * event-assembly module barrel.
 *
 * The single write-owner of hot_events + hot_event_evidence (AD-2). Exports the
 * clustering pure logic (tokenize/signatureOf/clusterRecords), the DB service
 * (clusterEvents), and the publication-status/options/types. The Prisma client
 * and the shared id helpers live one level up and are re-exported from the
 * package barrel.
 *
 * This module never writes evidence_records (source-ingest owns those),
 * published_* read models (publish-orchestrator owns those), or any other
 * module's aggregate. It never sets publication_status to "published" — that
 * transition belongs to review-workflow (1.6).
 */

export { clusterEvents } from "./cluster-events.js";
export type {
  ClusterEventsOptions,
  ClusterEventsResult,
} from "./cluster-events.js";
export {
  clusterRecords,
  overlapCoefficient,
  signatureOf,
  tokenize,
  SIGNATURE_DELIMITER,
} from "./clustering.js";
export type { ClusterGroup } from "./clustering.js";
export {
  PublicationStatus,
  SIMILARITY_THRESHOLD,
  TIME_WINDOW_MS,
} from "./types.js";
export type {
  ClusterInput,
  ClusterOptions,
  PublicationStatus as PublicationStatusType,
} from "./types.js";
