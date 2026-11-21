// Armür ızgarası çizimi: başlıkta çerçeve no (döner çerçeve turuncu), gövdede kaldırma hücreleri,
// sağda salt-okunur atkı seçici bloğu (1./2./3.). Tıklama olayı üstte tek dinleyicide çözülür
// (`data-pick`/`data-frame` hücre, `data-leno` başlık).
import type { MouseEvent } from "react";
import { cn } from "@/lib/utils";
import type { LiftPlan } from "../types";

const CELL = "h-4 w-4 shrink-0 border border-border/60";
const HEAD = "h-4 w-4 shrink-0 text-center text-[9px] leading-4 tabular-nums";

interface Props {
  plan: LiftPlan;
  frames: number;
  rows: number;
  leno: ReadonlySet<number>;
  /** Atkı başına 1-tabanlı iplik no; null = seçici yok. */
  selector: number[] | null;
  selCount: number;
  canWrite: boolean;
  onClick: (e: MouseEvent<HTMLDivElement>) => void;
}

function HeaderRow({ frames, leno, selCount, canWrite }: Pick<Props, "frames" | "leno" | "selCount" | "canWrite">) {
  return (
    <div className="flex" role="row">
      <span className="w-10 shrink-0" />
      {Array.from({ length: frames }, (_, c) => (
        <div key={c} role="columnheader" data-leno={canWrite ? c + 1 : undefined}
          title={leno.has(c + 1) ? "Döner çerçeve" : canWrite ? "Döner çerçeve olarak işaretle" : undefined}
          className={cn(HEAD, leno.has(c + 1) ? "rounded-sm bg-amber-500 font-semibold text-white" : "text-muted-foreground", canWrite && "cursor-pointer")}>
          {c + 1}
        </div>
      ))}
      {selCount > 0 && <span className="w-3 shrink-0" />}
      {Array.from({ length: selCount }, (_, i) => (
        <div key={i} role="columnheader" className={cn(HEAD, "font-semibold text-sky-700 dark:text-sky-400")}>{i + 1}.</div>
      ))}
    </div>
  );
}

export function LiftPlanGrid({ plan, frames, rows, leno, selector, selCount, canWrite, onClick }: Props) {
  return (
    <div className="overflow-auto rounded-md border p-2" onClick={onClick} role="grid" aria-label="Armür ızgarası">
      <HeaderRow frames={frames} leno={leno} selCount={selCount} canWrite={canWrite} />
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex" role="row">
          <span className="w-10 shrink-0 pr-1 text-right text-[10px] tabular-nums text-muted-foreground">{r + 1}</span>
          {Array.from({ length: frames }, (_, c) => {
            const v = plan[r]?.[c];
            return (
              <div key={c} role="gridcell" aria-selected={v === 1} data-pick={v === undefined ? undefined : r} data-frame={c}
                className={cn(CELL, v === 1 ? "bg-foreground" : leno.has(c + 1) ? "bg-amber-100 dark:bg-amber-950" : "bg-background",
                  canWrite && v !== undefined && "cursor-pointer")} />
            );
          })}
          {selCount > 0 && <span className="w-3 shrink-0" />}
          {Array.from({ length: selCount }, (_, i) => (
            <div key={i} role="gridcell" aria-label={`Atkı ${r + 1}: ${i + 1}. iplik`} aria-selected={selector?.[r] === i + 1}
              className={cn(CELL, selector?.[r] === i + 1 ? "bg-sky-600" : "bg-sky-50 dark:bg-sky-950")} />
          ))}
        </div>
      ))}
    </div>
  );
}
