import Link from "next/link";

import { ReactionChip } from "@/components/chips";
import type { ReactionTone } from "@/components/chips";
import type {
  CrashDayBreadth,
  IndexCrashDetail,
  LeadingSector,
  PublishedHotEventSummary,
} from "@aguhot/core";

/**
 * Shared crash-calendar display helpers + detail subcomponents — Story 8.8.
 *
 * Collocated under `/crash-calendar/_components/` so the index page (`page.tsx`,
 * the month-grid calendar) and the detail route (`[date]/page.tsx`) reuse the
 * SAME pure helpers + detail renderers without duplicating logic. Only pure
 * display helpers + detail subcomponents live here; the month-grid component
 * (`CrashMonthGrid`) stays in the index page (only that page renders it — no
 * speculative abstraction, ponytail guard).
 *
 * Compliance / visual contracts honored (no new tokens):
 *   - red-up / green-down via `text-market-up` / `text-market-down` tokens.
 *   - `ReactionChip` (tone="up"/"down"/"flat") carries direction with a text
 *     label + color (a11y floor: color is never the sole signal).
 *   - `font-mono` for every numeric / return / amount figure.
 *   - Honest empty (NFR-5): null fields render "—", never zeroed, never faked.
 */

// --- Pure display helpers (lifted verbatim from the former index page) --------

/** UTC-midnight Date (@db.Date) → `YYYY-MM-DD`, using UTC getters to avoid TZ drift. */
export function formatDay(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Chinese weekday suffix for a UTC date (`日/一/二/三/四/五/六`). */
export const WEEKDAY_CN = ["日", "一", "二", "三", "四", "五", "六"];

/** Broad-index code → Chinese label (申万一级三大宽基). */
export const INDEX_LABEL: Record<string, string> = {
  sh000001: "上证综指",
  sz399001: "深证成指",
  sz399006: "创业板指",
};

export function signTone(n: number): ReactionTone {
  if (n > 0) return "up";
  if (n < 0) return "down";
  return "flat";
}

/** `1.23` / `-0.85` → `"+1.23%"` / `"-0.85%"` (returns-table cell, no label ⇒ sign needed). */
export function signedPct(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

/** `1.23` / `-0.85` → `"1.23%"` (chip magnitude — the 涨/跌 label + tone carry direction). */
export function absPct(n: number): string {
  return `${Math.abs(n).toFixed(2)}%`;
}

// --- Inherited detail subcomponents (Segments: 领跌板块 / 前瞻收益 / 当日热点) ----

/**
 * Leading-down sectors (申万一级) for one crash day. ReactionChip tone="down" +
 * magnitude. Honest empty when no sectors were materialized (NFR-5: never faked).
 */
export function LeadingSectors({ sectors }: { sectors: LeadingSector[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-ink-secondary">领跌板块（申万一级）</h3>
      {sectors.length === 0 ? (
        // NFR-5: no sector bars for the day ⇒ honest line, never faked.
        <p className="text-sm text-ink-tertiary">该日领跌板块数据暂不可用。</p>
      ) : (
        <ul className="space-y-1.5">
          {sectors.map((s) => (
            <li key={s.sectorCode} className="flex items-center justify-between gap-2">
              <span className="text-sm text-ink-secondary">{s.sectorName}</span>
              <ReactionChip tone="down" value={absPct(s.pctChange)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Forward-returns table — three broad indices × T+1/T+5/T+20 historical actual
 * returns. `font-mono`, red-up/green-down via tokens, null → "—" (NFR-5).
 * `overflow-x-auto` for NFR-4 mobile readability.
 */
export function ForwardReturnsTable({ indices }: { indices: IndexCrashDetail[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-ink-secondary">前瞻收益（大跌后历史实际）</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-tertiary">
              <th className="py-1.5 pr-4 font-medium">指数</th>
              <th className="py-1.5 pr-4 font-medium">T+1</th>
              <th className="py-1.5 pr-4 font-medium">T+5</th>
              <th className="py-1.5 font-medium">T+20</th>
            </tr>
          </thead>
          <tbody>
            {indices.map((idx) => (
              <tr key={idx.indexCode} className="border-t border-border-hairline">
                <td className="py-1.5 pr-4 text-ink-secondary">
                  {INDEX_LABEL[idx.indexCode] ?? idx.indexCode}
                </td>
                <ReturnCell v={idx.forwardReturns.t1} />
                <ReturnCell v={idx.forwardReturns.t5} />
                <ReturnCell v={idx.forwardReturns.t20} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-tertiary">
        T+N = 大跌日后第 N 个交易日该指数实际收益；「—」为数据不足，不编造。
      </p>
    </div>
  );
}

export function ReturnCell({ v }: { v: number | null }) {
  if (v === null) {
    return <td className="py-1.5 pr-4 font-mono text-ink-tertiary">—</td>;
  }
  const tone = v > 0 ? "text-market-up" : v < 0 ? "text-market-down" : "text-ink-secondary";
  return <td className={`py-1.5 pr-4 font-mono ${tone}`}>{signedPct(v)}</td>;
}

/**
 * Same-day published HotEvents (Story 8.5 linkage). Rank = listPublishedHotEvents'
 * saliency DESC return order (filter preserves it); honest empty state + honest
 * truncation (NFR-2/NFR-5). Each links to `/events/[hotEventId]`.
 */
export function LinkedHotEvents({
  events,
  total,
}: {
  events: PublishedHotEventSummary[];
  total: number;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-ink-secondary">当日热点事件</h3>
      {events.length === 0 ? (
        // NFR-5: no published HotEvent first-published this crash day → honest line, never faked.
        <p className="text-sm text-ink-tertiary">该日暂无关联热点事件。</p>
      ) : (
        <>
          <ol className="space-y-1.5">
            {events.map((e, i) => (
              <li key={e.hotEventId} className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-ink-tertiary">#{i + 1}</span>
                <Link
                  href={`/events/${e.hotEventId}`}
                  className="text-sm text-ink-secondary underline-offset-4 hover:text-ink-primary hover:underline"
                >
                  {e.title}
                </Link>
              </li>
            ))}
          </ol>
          {total > events.length ? (
            <p className="font-mono text-xs text-ink-tertiary">
              共 {total} 条，仅展示前 {events.length} 条。
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

// --- Breadth (Story 8.7 consumption) — five sections --------------------------

/**
 * The five market-breadth sections for one crash day (Story 8.8, consuming 8.7's
 * `published_crash_days.breadth`). Renders ALL FIVE sections in order:
 *   1. 涨跌停广度 — limit-up/down counts + max consecutive board + broken-board count
 *   2. 涨跌家数   — advancing / declining / flat (+ advance/decline ratio when complete)
 *   3. 两市成交额 — total turnover (绝对成交额 only; 放量比对 deferred — AD-3 has no multi-day
 *      turnover series in the read model, NFR-5 forbids fabricating a comparison)
 *   4. 龙虎榜     — 上榜家数 + 机构净买 vs 游资净买 + Top-N 个股 (defensive parse of `unknown`)
 *   5. 融资融券余额变化 — margin balance change (T-1, nullable → "—")
 *
 * `breadth === null` (sidecar did not run that day / pre-breadth era) → the WHOLE
 * group renders a single honest "该日广度数据暂不可用" line and returns (AC2). The
 * INHERITED four segments (broad indices / sectors / returns / hot events) still
 * render on the page — breadth absence never blocks the page.
 *
 * NFR-5 inside a present `breadth`: nullable fields render "—", never zeroed, never
 * fabricated. The dragon-tiger `dragonTiger` is `unknown | null` (8.7 passes the Json
 * through without re-validating); it is defensively narrowed here — a wrong shape or
 * a null yields an honest segment-level or field-level empty, never an exception and
 * never fabricated stocks.
 */
export function BreadthSections({ breadth }: { breadth: CrashDayBreadth | null }) {
  if (breadth === null) {
    // AC2: honest whole-group empty. Inherited 4 segments render separately on the page.
    return (
      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-ink-primary">市场广度</h2>
        <p className="text-sm text-ink-tertiary">该日广度数据暂不可用。</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <h2 className="text-xl font-semibold text-ink-primary">市场广度</h2>

      {/* (1) 涨跌停广度 — limit-up/down counts (ReactionChip), 连板/炸板 counts (font-mono). */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-ink-secondary">涨跌停广度</h3>
        <div className="flex flex-wrap items-center gap-2">
          <ReactionChip tone="up" value={`${breadth.limitUpCount} 家涨停`} />
          <ReactionChip tone="down" value={`${breadth.limitDownCount} 家跌停`} />
        </div>
        <p className="font-mono text-xs text-ink-tertiary">
          最高连板 {breadth.consecutiveBoardMax} / 炸板 {breadth.brokenBoardCount} 家
        </p>
      </div>

      {/* (2) 涨跌家数 — 涨/跌/平; all null → "—"; when both 涨/跌 present, append 涨跌比. */}
      <AdvanceDeclineSection
        advancingCount={breadth.advancingCount}
        decliningCount={breadth.decliningCount}
        flatCount={breadth.flatCount}
      />

      {/* (3) 两市成交额 — absolute turnover only (亿). No 放量比对 (deferred per Design Notes). */}
      <TurnoverSection totalTurnover={breadth.totalTurnover} />

      {/* (4) 龙虎榜 — defensive parse of `dragonTiger: unknown | null`. */}
      <DragonTigerSection dragonTiger={breadth.dragonTiger} />

      {/* (5) 融资融券余额变化 — T-1, nullable → "—". */}
      <MarginSection marginBalanceChange={breadth.marginBalanceChange} />
    </section>
  );
}

/** (2) 涨跌家数 + 涨跌比 (advance/decline ratio). All three null → "—". */
function AdvanceDeclineSection({
  advancingCount,
  decliningCount,
  flatCount,
}: {
  advancingCount: number | null;
  decliningCount: number | null;
  flatCount: number | null;
}) {
  const allNull =
    advancingCount === null && decliningCount === null && flatCount === null;
  const showRatio = advancingCount !== null && decliningCount !== null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-ink-secondary">涨跌家数</h3>
      {allNull ? (
        <p className="font-mono text-sm text-ink-tertiary">—</p>
      ) : (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-3 font-mono text-sm">
            <span className="text-market-up">涨 {fmtCount(advancingCount)}</span>
            <span className="text-market-down">跌 {fmtCount(decliningCount)}</span>
            <span className="text-ink-secondary">平 {fmtCount(flatCount)}</span>
          </div>
          {showRatio ? (
            <p className="font-mono text-xs text-ink-tertiary">
              涨跌比 {advancingCount!}/{decliningCount!}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** (3) 两市成交额 — absolute turnover formatted to 亿 (2 decimals). null → "—". */
function TurnoverSection({ totalTurnover }: { totalTurnover: number | null }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-ink-secondary">两市成交额</h3>
      {totalTurnover === null ? (
        <p className="font-mono text-sm text-ink-tertiary">—</p>
      ) : (
        <p className="font-mono text-sm text-ink-primary">{fmtYi(totalTurnover)} 亿</p>
      )}
    </div>
  );
}

/** (5) 融资融券余额变化 — T-1, nullable → "—". Formatted to 亿 when present. */
function MarginSection({ marginBalanceChange }: { marginBalanceChange: number | null }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-ink-secondary">融资融券余额变化</h3>
      {marginBalanceChange === null ? (
        <p className="font-mono text-sm text-ink-tertiary">—</p>
      ) : (
        <p className="font-mono text-sm text-ink-primary">{fmtYiSigned(marginBalanceChange)} 亿</p>
      )}
      <p className="font-mono text-xs text-ink-tertiary">前一交易日（T-1）数据。</p>
    </div>
  );
}

// --- 龙虎榜 defensive parsing ------------------------------------------------

/** Expected shape of the 8.6 dragon-tiger Json aggregate (8.7 passes it as `unknown`). */
interface DragonTigerAggregate {
  stockCount?: number;
  institutionalNetBuy?: string;
  hotMoneyNetBuy?: string;
  topStocks?: DragonTigerTopStock[];
}

interface DragonTigerTopStock {
  code?: string;
  name?: string;
  netBuy?: string;
  reason?: string;
}

/** Top-N cap for the dragon-tiger stock list (defensive; V1 tiny scale). */
const DRAGON_TIGER_TOP_CAP = 8;

/**
 * (4) 龙虎榜 — 上榜家数 + 机构净买 vs 游资净买 + Top-N 个股. `dragonTiger` is
 * `unknown | null` (8.7 passthrough); defensively narrowed. null or wrong shape →
 * segment-level "该日龙虎榜数据暂不可用"; missing fields → field-level "—".
 */
function DragonTigerSection({ dragonTiger }: { dragonTiger: unknown | null }) {
  if (dragonTiger === null) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-ink-secondary">龙虎榜</h3>
        <p className="text-sm text-ink-tertiary">该日龙虎榜数据暂不可用。</p>
      </div>
    );
  }

  const parsed = narrowDragonTiger(dragonTiger);
  if (parsed === null) {
    // Non-null but wrong shape — honest segment-level empty, no exception (AC4).
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-ink-secondary">龙虎榜</h3>
        <p className="text-sm text-ink-tertiary">该日龙虎榜数据暂不可用。</p>
      </div>
    );
  }

  const top = (parsed.topStocks ?? []).slice(0, DRAGON_TIGER_TOP_CAP);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-ink-secondary">龙虎榜</h3>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-sm">
        <div>
          <dt className="inline text-ink-tertiary">上榜 </dt>
          <dd className="inline text-ink-primary">{fmtCount(parsed.stockCount)} 家</dd>
        </div>
        <div>
          <dt className="inline text-ink-tertiary">机构净买 </dt>
          <dd className="inline text-ink-primary">{fmtAmount(parsed.institutionalNetBuy)}</dd>
        </div>
        <div>
          <dt className="inline text-ink-tertiary">游资净买 </dt>
          <dd className="inline text-ink-primary">{fmtAmount(parsed.hotMoneyNetBuy)}</dd>
        </div>
      </dl>
      {top.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-tertiary">
                <th className="py-1.5 pr-4 font-medium">代码</th>
                <th className="py-1.5 pr-4 font-medium">名称</th>
                <th className="py-1.5 pr-4 font-medium">净买</th>
                <th className="py-1.5 font-medium">上榜原因</th>
              </tr>
            </thead>
            <tbody>
              {top.map((s, i) => (
                <tr key={`${s.code ?? i}:${i}`} className="border-t border-border-hairline">
                  <td className="py-1.5 pr-4 font-mono text-ink-secondary">
                    {s.code ?? "—"}
                  </td>
                  <td className="py-1.5 pr-4 text-ink-secondary">{s.name ?? "—"}</td>
                  <td className="py-1.5 pr-4 font-mono text-ink-secondary">
                    {fmtAmount(s.netBuy)}
                  </td>
                  <td className="py-1.5 text-xs text-ink-tertiary">{s.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Type-narrow `unknown` → `DragonTigerAggregate | null`. Returns null for a shape
 * the renderer cannot trust (non-object, or an object that is not a plausible
 * dragon-tiger aggregate). Field-level optionality is preserved (each field is
 * individually degraded to "—" at render time). Never throws, never `as any`.
 */
function narrowDragonTiger(v: unknown): DragonTigerAggregate | null {
  if (typeof v !== "object" || v === null) return null;
  const obj = v as Record<string, unknown>;
  // Plausibility gate: stockCount (a number) is the canonical "this is a real
  // dragon-tiger aggregate" signal per 8.6's golden shape {stockCount,...}. A
  // non-null but wrong-shape object (e.g. {error:"rate-limited", ...}) → null →
  // segment-level「该日龙虎榜数据暂不可用」(NFR-5: never dress wrong-shape data up
  // as a real-but-empty listing with「—」placeholders).
  if (typeof obj.stockCount !== "number") return null;

  const result: DragonTigerAggregate = { stockCount: obj.stockCount };
  if (typeof obj.institutionalNetBuy === "string") result.institutionalNetBuy = obj.institutionalNetBuy;
  if (typeof obj.hotMoneyNetBuy === "string") result.hotMoneyNetBuy = obj.hotMoneyNetBuy;
  if (Array.isArray(obj.topStocks)) {
    result.topStocks = obj.topStocks
      .map((row) => narrowTopStock(row))
      .filter((r): r is DragonTigerTopStock => r !== null);
  }
  return result;
}

function narrowTopStock(v: unknown): DragonTigerTopStock | null {
  if (typeof v !== "object" || v === null) return null;
  const obj = v as Record<string, unknown>;
  const result: DragonTigerTopStock = {};
  if (typeof obj.code === "string") result.code = obj.code;
  if (typeof obj.name === "string") result.name = obj.name;
  if (typeof obj.netBuy === "string") result.netBuy = obj.netBuy;
  if (typeof obj.reason === "string") result.reason = obj.reason;
  return result;
}

// --- Number / amount formatting (display-only; never changes semantics) -------

/** Count → string; null → "—" (NFR-5: never zeroed). */
function fmtCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return String(n);
}

/**
 * Format a raw yuan amount (string from the dragon-tiger Json, e.g. "120000000")
 * to a display string. 亿 / 万 / 元 tiers; null/undefined/empty/non-numeric → "—".
 * Display-only — the stored string is untouched.
 */
function fmtAmount(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "—";
  const trimmed = raw.trim();
  if (trimmed === "") return "—";
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return "—";
  return fmtYiSigned(n);
}

/** Absolute yuan (number) → 亿 (2 decimals). e.g. 1.2e9 → "12.00". */
function fmtYi(yuan: number): string {
  return (yuan / 1e8).toFixed(2);
}

/** Signed yuan (number) → 亿 with explicit sign. e.g. 1.2e9 → "+12.00", -5e8 → "-5.00". */
function fmtYiSigned(yuan: number): string {
  const yi = yuan / 1e8;
  const sign = yi > 0 ? "+" : "";
  return `${sign}${yi.toFixed(2)}`;
}
