/**
 * SourceAdapter port — the boundary domain modules use to reach external
 * evidence sources (AD-7).
 *
 * The ingest service depends only on this interface; concrete adapters (RSS,
 * future API/webhook sources) are resolved and constructed in the worker
 * assembly layer. Swapping a source (e.g. RSS -> API) means pointing the
 * worker at a different adapter implementation — `ingestSources` never
 * imports a third-party SDK or wire format.
 */

import type { EvidenceItem } from "./types.js";

export interface SourceAdapter {
  /**
   * Fetch and normalize evidence items from the source.
   *
   * Implementations MUST parse the source's native format (RSS XML, API JSON,
   * ...) into the normalized {@link EvidenceItem} shape. They SHOULD throw on
   * unrecoverable source-level failures (dead URL, malformed payload) — the
   * ingest service catches per-source so one broken source never aborts the
   * rest (AC3 isolation). Item-level missing fields are not errors: the adapter
   * emits the item with null fields and the service archives it as
   * `missing_fields`.
   */
  fetch(): Promise<EvidenceItem[]>;
}
