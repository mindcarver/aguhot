import { ReactionChip } from "@/components/chips";
import type { IndexSurgeDetail, LeadingSurgeSector, SurgeDayBreadth } from "@aguhot/core";

import {
  BreadthSections,
  INDEX_LABEL,
  LinkedHotEvents,
  ReturnCell,
  WEEKDAY_CN,
  absPct,
  formatDay,
  signTone,
} from "../crash-calendar/_components/crash-day-shared";

export {
  BreadthSections,
  INDEX_LABEL,
  LinkedHotEvents,
  WEEKDAY_CN,
  absPct,
  formatDay,
  signTone,
};
export type { SurgeDayBreadth };

export function LeadingSurgeSectors({ sectors }: { sectors: LeadingSurgeSector[] }) {
  return (
    <div className="space-y-2">
      <h2 className="text-xl font-semibold text-ink-primary">领涨板块（申万一级）</h2>
      {sectors.length === 0 ? (
        <p className="text-sm text-ink-tertiary">该日领涨板块数据暂不可用。</p>
      ) : (
        <ul className="space-y-1.5">
          {sectors.map((sector) => (
            <li key={sector.sectorCode} className="flex items-center justify-between gap-2">
              <span className="text-sm text-ink-secondary">{sector.sectorName}</span>
              <ReactionChip tone="up" value={absPct(sector.pctChange)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SurgeForwardReturns({ indices }: { indices: IndexSurgeDetail[] }) {
  return (
    <div className="space-y-2">
      <h2 className="text-xl font-semibold text-ink-primary">上涨后历史实际收益</h2>
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
            {indices.map((index) => (
              <tr key={index.indexCode} className="border-t border-border-hairline">
                <td className="py-1.5 pr-4 text-ink-secondary">
                  {INDEX_LABEL[index.indexCode] ?? index.indexCode}
                </td>
                <ReturnCell v={index.forwardReturns?.t1 ?? null} />
                <ReturnCell v={index.forwardReturns?.t5 ?? null} />
                <ReturnCell v={index.forwardReturns?.t20 ?? null} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-tertiary">T+N = 大涨日后第 N 个交易日的实际收益；「—」为数据不足。</p>
    </div>
  );
}
