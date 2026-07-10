/**
 * Self-check for the pure web-layer watchlist resolver (no infra, no DB, no Next
 * runtime).
 *
 * Run with: pnpm --filter web verify:watchlist
 *           (tsx lib/watchlist.selfcheck.ts)
 *
 * Pins resolveWatchlistView's classification + ordering behavior — the offline
 * classification is AC3's load-bearing logic (misclassifying an offline item as
 * live would let a taken-down event render as a clickable EventCard, violating
 * "never disguise unavailable items as live"). Drives:
 *   - live event classification (hotEventId in publishedEvents → liveEvents)
 *   - live theme classification (slug in a membership → liveThemes with label)
 *   - offline event classification (hotEventId NOT in publishedEvents → offlineEvents)
 *   - offline theme classification (slug NOT in any membership → offlineThemes)
 *   - createdAt DESC ordering preserved across all buckets
 *   - empty inputs → all-empty buckets (AC2 empty state)
 *   - mixed input (live + offline + both kinds) classified correctly
 *   - theme label first-seen wins (mirrors /topics/[slug] derivation)
 *
 * Prints PASS/FAIL and exits non-zero iff any assertion fails, mirroring the
 * core selfcheck convention (no test framework, plain assertions +
 * process.exit).
 */

import { FollowTargetKind } from "@aguhot/core";
import type {
  FollowTarget,
  PublishedHotEventSummary,
  PublishedThemeMembershipRow,
} from "@aguhot/core";

import { resolveWatchlistView } from "./watchlist.js";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

/** Build a follow row with sensible defaults for the classification tests. */
function follow(
  overrides: Partial<FollowTarget> & {
    id: string;
    targetKind: FollowTarget["targetKind"];
    createdAt: Date;
  },
): FollowTarget {
  return {
    userAccountId: "user-test",
    targetHotEventId: null,
    targetThemeSlug: null,
    ...overrides,
  } as FollowTarget;
}

function eventSummary(
  id: string,
  overrides: Partial<PublishedHotEventSummary> = {},
): PublishedHotEventSummary {
  return {
    hotEventId: id,
    title: `event-${id}`,
    evidenceCount: 1,
    latestEvidenceAt: new Date("2026-07-01T00:00:00Z"),
    publishedAt: new Date("2026-06-01T00:00:00Z"),
    ...overrides,
  };
}

function membership(
  hotEventId: string,
  items: { slug: string; label: string }[],
): PublishedThemeMembershipRow {
  return {
    hotEventId,
    items: items.map((i) => ({
      slug: i.slug,
      label: i.label,
      mappingBasis: "knowledge_base:v1",
    })),
  };
}

function main(): void {
  const assertions: Assertion[] = [];

  // --- AC2 empty input: all buckets empty --------------------------------
  assertions.push(
    runAccept("empty input: all four buckets empty", () => {
      const view = resolveWatchlistView({
        follows: [],
        publishedEvents: [],
        themeMemberships: [],
      });
      assertEmpty(view, "empty input");
    }),
  );

  // --- live event classification ------------------------------------------
  assertions.push(
    runAccept("live event: hotEventId in publishedEvents → liveEvents", () => {
      const f = follow({
        id: "f1",
        targetKind: FollowTargetKind.HotEvent,
        targetHotEventId: "evt-A",
        createdAt: new Date("2026-07-10T00:00:00Z"),
      });
      const evt = eventSummary("evt-A", { title: "钛合金扩张" });
      const view = resolveWatchlistView({
        follows: [f],
        publishedEvents: [evt],
        themeMemberships: [],
      });
      if (view.liveEvents.length !== 1) {
        throw new Error(`expected 1 liveEvent, got ${view.liveEvents.length}`);
      }
      const liveEvent = view.liveEvents[0];
      if (liveEvent === undefined) {
        throw new Error("expected liveEvent at index 0, got undefined");
      }
      if (liveEvent.hotEventId !== "evt-A") {
        throw new Error(
          `expected liveEvent hotEventId evt-A, got ${liveEvent.hotEventId}`,
        );
      }
      if (liveEvent.title !== "钛合金扩张") {
        throw new Error(
          `expected title 钛合金扩张, got ${liveEvent.title}`,
        );
      }
      if (view.offlineEvents.length !== 0) {
        throw new Error(
          `expected 0 offlineEvents, got ${view.offlineEvents.length}`,
        );
      }
    }),
  );

  // --- offline event classification ---------------------------------------
  assertions.push(
    runAccept(
      "offline event: hotEventId NOT in publishedEvents → offlineEvents (AC3)",
      () => {
        const f = follow({
          id: "f2",
          targetKind: FollowTargetKind.HotEvent,
          targetHotEventId: "evt-gone",
          createdAt: new Date("2026-07-09T00:00:00Z"),
        });
        const view = resolveWatchlistView({
          follows: [f],
          publishedEvents: [eventSummary("evt-other")],
          themeMemberships: [],
        });
        if (view.offlineEvents.length !== 1) {
          throw new Error(
            `expected 1 offlineEvent, got ${view.offlineEvents.length}`,
          );
        }
        const offlineEvent = view.offlineEvents[0];
        if (offlineEvent === undefined) {
          throw new Error("expected offlineEvent at index 0, got undefined");
        }
        if (offlineEvent.hotEventId !== "evt-gone") {
          throw new Error(
            `expected offline hotEventId evt-gone, got ${offlineEvent.hotEventId}`,
          );
        }
        if (view.liveEvents.length !== 0) {
          throw new Error(
            `expected 0 liveEvents, got ${view.liveEvents.length}`,
          );
        }
      },
    ),
  );

  // --- live theme classification ------------------------------------------
  assertions.push(
    runAccept("live theme: slug in a membership → liveThemes with label", () => {
      const f = follow({
        id: "f3",
        targetKind: FollowTargetKind.Theme,
        targetThemeSlug: "chip-supply",
        createdAt: new Date("2026-07-08T00:00:00Z"),
      });
      const view = resolveWatchlistView({
        follows: [f],
        publishedEvents: [],
        themeMemberships: [
          membership("evt-A", [{ slug: "chip-supply", label: "芯片供应链" }]),
        ],
      });
      if (view.liveThemes.length !== 1) {
        throw new Error(`expected 1 liveTheme, got ${view.liveThemes.length}`);
      }
      const liveTheme = view.liveThemes[0];
      if (liveTheme === undefined) {
        throw new Error("expected liveTheme at index 0, got undefined");
      }
      if (liveTheme.slug !== "chip-supply") {
        throw new Error(
          `expected slug chip-supply, got ${liveTheme.slug}`,
        );
      }
      if (liveTheme.label !== "芯片供应链") {
        throw new Error(
          `expected label 芯片供应链, got ${liveTheme.label}`,
        );
      }
      if (view.offlineThemes.length !== 0) {
        throw new Error(
          `expected 0 offlineThemes, got ${view.offlineThemes.length}`,
        );
      }
    }),
  );

  // --- offline theme classification ---------------------------------------
  assertions.push(
    runAccept(
      "offline theme: slug NOT in any membership → offlineThemes (AC3)",
      () => {
        const f = follow({
          id: "f4",
          targetKind: FollowTargetKind.Theme,
          targetThemeSlug: "ghost-theme",
          createdAt: new Date("2026-07-07T00:00:00Z"),
        });
        const view = resolveWatchlistView({
          follows: [f],
          publishedEvents: [],
          themeMemberships: [
            membership("evt-A", [{ slug: "other-slug", label: "其他" }]),
          ],
        });
        if (view.offlineThemes.length !== 1) {
          throw new Error(
            `expected 1 offlineTheme, got ${view.offlineThemes.length}`,
          );
        }
        const offlineTheme = view.offlineThemes[0];
        if (offlineTheme === undefined) {
          throw new Error("expected offlineTheme at index 0, got undefined");
        }
        if (offlineTheme.slug !== "ghost-theme") {
          throw new Error(
            `expected slug ghost-theme, got ${offlineTheme.slug}`,
          );
        }
        if (view.liveThemes.length !== 0) {
          throw new Error(`expected 0 liveThemes, got ${view.liveThemes.length}`);
        }
      },
    ),
  );

  // --- createdAt DESC ordering --------------------------------------------
  assertions.push(
    runAccept(
      "createdAt DESC: follows sorted most-recent-first within each bucket",
      () => {
        const older = follow({
          id: "f-old",
          targetKind: FollowTargetKind.HotEvent,
          targetHotEventId: "evt-old",
          createdAt: new Date("2026-07-01T00:00:00Z"),
        });
        const newer = follow({
          id: "f-new",
          targetKind: FollowTargetKind.HotEvent,
          targetHotEventId: "evt-new",
          createdAt: new Date("2026-07-10T00:00:00Z"),
        });
        const middle = follow({
          id: "f-mid",
          targetKind: FollowTargetKind.HotEvent,
          targetHotEventId: "evt-mid",
          createdAt: new Date("2026-07-05T00:00:00Z"),
        });
        const view = resolveWatchlistView({
          // Pass them in NON-sorted order to prove the fn sorts.
          follows: [older, newer, middle],
          publishedEvents: [
            eventSummary("evt-old"),
            eventSummary("evt-new"),
            eventSummary("evt-mid"),
          ],
          themeMemberships: [],
        });
        if (view.liveEvents.length !== 3) {
          throw new Error(`expected 3 liveEvents, got ${view.liveEvents.length}`);
        }
        const order = view.liveEvents.map((e) => e.hotEventId);
        const expected = ["evt-new", "evt-mid", "evt-old"];
        if (order.join(",") !== expected.join(",")) {
          throw new Error(
            `expected createdAt DESC order [${expected.join(", ")}], got [${order.join(", ")}]`,
          );
        }
      },
    ),
  );

  // --- createdAt DESC tiebreaker by id DESC --------------------------------
  assertions.push(
    runAccept(
      "createdAt DESC tiebreaker: same createdAt → id DESC deterministic",
      () => {
        const sameTime = new Date("2026-07-05T00:00:00Z");
        const a = follow({
          id: "aaa",
          targetKind: FollowTargetKind.HotEvent,
          targetHotEventId: "evt-a",
          createdAt: sameTime,
        });
        const z = follow({
          id: "zzz",
          targetKind: FollowTargetKind.HotEvent,
          targetHotEventId: "evt-z",
          createdAt: sameTime,
        });
        const view = resolveWatchlistView({
          follows: [a, z],
          publishedEvents: [eventSummary("evt-a"), eventSummary("evt-z")],
          themeMemberships: [],
        });
        const order = view.liveEvents.map((e) => e.hotEventId);
        // id DESC: "zzz" before "aaa" → evt-z before evt-a.
        if (order.join(",") !== "evt-z,evt-a") {
          throw new Error(
            `expected tiebroken order [evt-z, evt-a], got [${order.join(", ")}]`,
          );
        }
      },
    ),
  );

  // --- mixed input: all four buckets populated ----------------------------
  assertions.push(
    runAccept(
      "mixed input: live event + offline event + live theme + offline theme",
      () => {
        const fLiveEvt = follow({
          id: "f-le",
          targetKind: FollowTargetKind.HotEvent,
          targetHotEventId: "evt-live",
          createdAt: new Date("2026-07-10T00:00:00Z"),
        });
        const fOfflineEvt = follow({
          id: "f-oe",
          targetKind: FollowTargetKind.HotEvent,
          targetHotEventId: "evt-dead",
          createdAt: new Date("2026-07-09T00:00:00Z"),
        });
        const fLiveTheme = follow({
          id: "f-lt",
          targetKind: FollowTargetKind.Theme,
          targetThemeSlug: "live-slug",
          createdAt: new Date("2026-07-08T00:00:00Z"),
        });
        const fOfflineTheme = follow({
          id: "f-ot",
          targetKind: FollowTargetKind.Theme,
          targetThemeSlug: "dead-slug",
          createdAt: new Date("2026-07-07T00:00:00Z"),
        });
        const view = resolveWatchlistView({
          follows: [fLiveEvt, fOfflineEvt, fLiveTheme, fOfflineTheme],
          publishedEvents: [eventSummary("evt-live")],
          themeMemberships: [
            membership("evt-live", [{ slug: "live-slug", label: "在线主题" }]),
          ],
        });
        if (view.liveEvents.length !== 1) {
          throw new Error(
            `liveEvents wrong count: ${view.liveEvents.length}`,
          );
        }
        if (view.liveEvents[0]?.hotEventId !== "evt-live") {
          throw new Error(
            `liveEvents wrong: ${JSON.stringify(view.liveEvents.map((e) => e.hotEventId))}`,
          );
        }
        if (view.offlineEvents.length !== 1) {
          throw new Error(
            `offlineEvents wrong count: ${view.offlineEvents.length}`,
          );
        }
        if (view.offlineEvents[0]?.hotEventId !== "evt-dead") {
          throw new Error(
            `offlineEvents wrong: ${JSON.stringify(view.offlineEvents.map((e) => e.hotEventId))}`,
          );
        }
        if (view.liveThemes.length !== 1) {
          throw new Error(
            `liveThemes wrong count: ${view.liveThemes.length}`,
          );
        }
        if (view.liveThemes[0]?.slug !== "live-slug") {
          throw new Error(
            `liveThemes wrong: ${JSON.stringify(view.liveThemes.map((t) => t.slug))}`,
          );
        }
        if (view.offlineThemes.length !== 1) {
          throw new Error(
            `offlineThemes wrong count: ${view.offlineThemes.length}`,
          );
        }
        if (view.offlineThemes[0]?.slug !== "dead-slug") {
          throw new Error(
            `offlineThemes wrong: ${JSON.stringify(view.offlineThemes.map((t) => t.slug))}`,
          );
        }
      },
    ),
  );

  // --- theme label first-seen wins ----------------------------------------
  assertions.push(
    runAccept(
      "theme label first-seen wins (mirrors /topics/[slug])",
      () => {
        const f = follow({
          id: "f-t",
          targetKind: FollowTargetKind.Theme,
          targetThemeSlug: "shared-slug",
          createdAt: new Date("2026-07-06T00:00:00Z"),
        });
        const view = resolveWatchlistView({
          follows: [f],
          publishedEvents: [],
          // Two membership rows carry the SAME slug with DIFFERENT labels.
          // The first-seen label wins (deterministic).
          themeMemberships: [
            membership("evt-1", [{ slug: "shared-slug", label: "第一标签" }]),
            membership("evt-2", [{ slug: "shared-slug", label: "第二标签" }]),
          ],
        });
        if (view.liveThemes.length !== 1) {
          throw new Error(`expected 1 liveTheme, got ${view.liveThemes.length}`);
        }
        const firstTheme = view.liveThemes[0];
        if (firstTheme === undefined) {
          throw new Error("expected liveTheme at index 0, got undefined");
        }
        if (firstTheme.label !== "第一标签") {
          throw new Error(
            `expected first-seen label 第一标签, got ${firstTheme.label}`,
          );
        }
      },
    ),
  );

  // --- offline items never mixed into live group (AC3 anti-disguise) -------
  assertions.push(
    runAccept(
      "AC3 anti-disguise: offline event/theme NEVER appear in live buckets",
      () => {
        const fOfflineEvt = follow({
          id: "f-oe2",
          targetKind: FollowTargetKind.HotEvent,
          targetHotEventId: "no-such-event",
          createdAt: new Date("2026-07-10T00:00:00Z"),
        });
        const fOfflineTheme = follow({
          id: "f-ot2",
          targetKind: FollowTargetKind.Theme,
          targetThemeSlug: "no-such-theme",
          createdAt: new Date("2026-07-10T00:00:00Z"),
        });
        const view = resolveWatchlistView({
          follows: [fOfflineEvt, fOfflineTheme],
          publishedEvents: [],
          themeMemberships: [],
        });
        if (view.liveEvents.length !== 0) {
          throw new Error(
            `offline event leaked into liveEvents: ${view.liveEvents.length}`,
          );
        }
        if (view.liveThemes.length !== 0) {
          throw new Error(
            `offline theme leaked into liveThemes: ${view.liveThemes.length}`,
          );
        }
        if (view.offlineEvents.length !== 1 || view.offlineThemes.length !== 1) {
          throw new Error(
            `expected 1 offline each, got ${view.offlineEvents.length}/${view.offlineThemes.length}`,
          );
        }
      },
    ),
  );

  report(assertions);
}

function assertEmpty(view: ReturnType<typeof resolveWatchlistView>, label: string): void {
  if (view.liveEvents.length !== 0) {
    throw new Error(`${label}: expected 0 liveEvents, got ${view.liveEvents.length}`);
  }
  if (view.liveThemes.length !== 0) {
    throw new Error(`${label}: expected 0 liveThemes, got ${view.liveThemes.length}`);
  }
  if (view.offlineEvents.length !== 0) {
    throw new Error(
      `${label}: expected 0 offlineEvents, got ${view.offlineEvents.length}`,
    );
  }
  if (view.offlineThemes.length !== 0) {
    throw new Error(
      `${label}: expected 0 offlineThemes, got ${view.offlineThemes.length}`,
    );
  }
}

/**
 * Run a case whose body MUST return normally (acceptance path). Returns an
 * Assertion: ok=true iff the body completed without throwing.
 */
function runAccept(name: string, body: () => void): Assertion {
  try {
    body();
    return { name, ok: true };
  } catch (err) {
    return {
      name,
      ok: false,
      detail: (err as Error).message,
    };
  }
}

// --- reporting (mirrors core selfcheck convention) ---------------------------

function report(assertions: Assertion[]): void {
  console.log("");
  console.log("=== web watchlist resolveWatchlistView self-check ===");
  for (const a of assertions) {
    const mark = a.ok ? "PASS" : "FAIL";
    console.log(`  [${mark}] ${a.name}${a.detail ? ` — ${a.detail}` : ""}`);
  }
  const failed = assertions.filter((a) => !a.ok);
  console.log("");
  if (failed.length === 0) {
    console.log(`PASS — ${assertions.length}/${assertions.length} assertions ok`);
    process.exit(0);
  } else {
    console.error(`FAIL — ${failed.length}/${assertions.length} assertions failed`);
    process.exit(1);
  }
}

main();
