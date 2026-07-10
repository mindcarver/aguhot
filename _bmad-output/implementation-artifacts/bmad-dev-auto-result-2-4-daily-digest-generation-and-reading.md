---
status: 'done'
spec_file: '_bmad-output/implementation-artifacts/spec-2-4-daily-digest-generation-and-reading.md'
baseline_revision: '57e020486f10e898f2dc365055acb70dcd9f8006'
final_revision: '455ded02dddb49525f836ab11fca3ba0f7252976'
---

# BMad Dev Auto Result — Story 2.4 结构化日报生成与阅读

Status: done

## Summary

Turned the `/daily` 1.2 placeholder into a working daily-digest surface (Epic 2, FR10) and built the versioned async pipeline behind it, mirroring the 2.1/2.3 end-to-end shape (port → test stub → append-only writer → publish-orchestrator projection → BullMQ worker → web page → verify + e2e).

## Files Changed (22, in commit 455ded0)

- `packages/core/prisma/schema.prisma` + `migrations/20260710165125_daily_digest_read_models/migration.sql` — `DailyDigest` (append-only write) + `PublishedDailyDigest` (read model), no FK to hot_events (coverageDate-keyed aggregate).
- `packages/core/src/modules/digest/{types,digest-adapter,stub-digest-adapter,digest-service,index}.ts` — `DigestAdapter` port, `StubDigestAdapter` (TEST-ONLY), `generateDailyDigest` (eligible selection + AC2 conclusion validation + append-only), `getLatestDigest`.
- `packages/core/src/modules/publish-orchestrator/{publish-service,types,index}.ts` + `src/index.ts` — sibling `refreshPublishedDailyDigest` (coverageDate-keyed), `getPublishedDailyDigest`, `listPublishedDailyDigestCoverageDates` + types/barrel.
- `apps/worker/src/queues/daily-digest-queue.ts` + `index.ts` + `package.json` — 6th BullMQ worker (honest V1 skip), `verify:digest` script.
- `apps/web/app/(public)/daily/page.tsx` — dynamic daily-digest page (latest + `?date=` + degradation), replacing the placeholder.
- `apps/web/e2e/{seed-daily,daily.spec}.ts` + `package.json` — `@daily` e2e (5 tests) + seed.
- `_bmad-output/implementation-artifacts/deferred-work.md` — 13 implementation-registered defers + 2 review-registered + 1 dup removed.
- `_bmad-output/implementation-artifacts/.review-diff-2-4.patch` — review diff.

## Review Findings (final pass)

- intent_gap: 0 · bad_spec: 0 · patch: 4 (medium 3, low 1) · defer: 2 (low 2) · reject: 18
- Patches: (1) `listPublishedDailyDigestCoverageDates` DESC ordering assertion — guards `/daily` default-view; (2) `/daily` entry render-order (evidenceCount DESC) DOM assertion; (3) takedown→404 + versioned-artifact immutability assertions; (4) deferred-work duplicate entry removed.
- Defers: coverageDate UTC-midnight normalization + worker input validation (latent, deferred runtime); `ADVICE_KEYWORDS` synonym completeness (future LLM).
- 18 rejects — most notably: cross-run DB leakage (harmless; existing scripts don't read digest tables, new scripts self-clean), AiLabel `.bg-accent-warm` selector (established repo convention), traceId dropped in reads (mirrors all publish-orchestrator reads), `DailyDigestEntry` double-def (spec-sanctioned, mirrors 2.3 `ThemeRef`), worker hardcoded `considered:1` (V1-deferred runtime, unobservable).

## Verification Performed

- `prisma migrate deploy` + `prisma generate` — applied the pending `daily_digest_read_models` migration (was NOT applied to `aguhot_dev` despite the implementation claim; caught during review).
- `pnpm -r typecheck` — pass (5 packages).
- `pnpm -r lint` — pass.
- `pnpm --filter web build` (no `DATABASE_URL`) — success; `/daily` is `ƒ Dynamic`.
- `pnpm --filter worker verify:digest` — **PASS 26/26** (was 23, +3 review patches).
- `pnpm --filter worker verify:publish` 48/48 · `verify:themes` 24/24 — no regression.
- `pnpm --filter web e2e:daily` — **5/5 passed** (incl. new render-order assertion).
- `pnpm --filter web e2e` (home/navigation/design) — 17/17, no regression.

## Residual Risks

- V1 daily-digest worker is an untested runtime (mirrors theme-backfill/market-reaction; Redis integration deferred to CI).
- Prod never generates a digest until a real LLM provider + trigger (cron/enqueue) land — all deferred and registered.
- coverageDate non-midnight / malformed worker input is a latent read-mismatch (deferred to worker/cron landing).
- `ADVICE_KEYWORDS` synonyms incomplete for future LLM output (deferred).
- No follow-up review recommended (3 medium verification-strengthening patches + 1 low doc dedup; no API/security/data-integrity or broad behavioral change, production code unchanged this pass).

## Residual Artifacts

None — working tree clean after the two commits (`455ded0` reviewed diff, `6427ed9` spec-done bookkeeping). `apps/web/next-env.d.ts` (Next auto-generated dev↔prod type-path flip) was restored, not committed.
