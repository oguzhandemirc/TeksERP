// Armür ızgarası çizimi: başlıkta çerçeve no (döner çerçeve turuncu), gövdede kaldırma hücreleri,
// sağda salt-okunur atkı seçici bloğu (1./2./3., iplik renginde). Tıklama olayı üstte tek dinleyicide çözülür
// (`data-pick`/`data-frame` hücre, `data-leno` başlık). `direction` yalnız ÇİZİM sırasını çevirir; `data-pick` veri satırıdır.
import { useLayoutEffect, useRef, type MouseEvent } from "react";
import { rowsInDisplayOrder, type WeaveDirection } from "@/components/weave/weave-direction";
import { yarnColor } from "@/components/weave/weave-palette";
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
  /** Varsayılan "top-down" (eski çağıranlar için bugünkü çizim). */
  direction?: WeaveDirection;
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
        <div key={i} role="columnheader" className={cn(HEAD, "font-semibold text-foreground")}>{i + 1}.</div>
      ))}
    </div>
  );
}

export function LiftPlanGrid({ plan, frames, rows, leno, selector, selCount, canWrite, direction = "top-down", onClick }: Props) {
  const header = <HeaderRow frames={frames} leno={leno} selCount={selCount} canWrite={canWrite} />;
  const box = useRef<HTMLDivElement>(null);
  // Alttan yukarı görünümde 1. atkı en altta: uzun ızgara kutusu açılışta alta kaydırılır.
  useLayoutEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = direction === "bottom-up" ? el.scrollHeight : 0;
  }, [direction]);
  return (
    <div ref={box} className="max-h-[70vh] w-fit max-w-full overflow-auto rounded-md border p-2" onClick={onClick} role="grid" aria-label="Armür ızgarası">
      {direction === "top-down" && header}
      {rowsInDisplayOrder(rows, direction).map((r) => (
        <div key={r} className="flex" role="row" data-row={r}>
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
          {Array.from({ length: selCount }, (_, i) => {
            const on = selector?.[r] === i + 1;
            return (
              <div key={i} role="gridcell" aria-label={`Atkı ${r + 1}: ${i + 1}. iplik`} aria-selected={on}
                className={cn(CELL, !on && "bg-muted/50")} style={on ? { background: yarnColor(i + 1) } : undefined} />
            );
          })}
        </div>
      ))}
      {direction === "bottom-up" && header}
    </div>
  );
}
