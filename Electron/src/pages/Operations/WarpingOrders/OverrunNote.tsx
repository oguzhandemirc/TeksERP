// Hedef üstü metre "Fazla devere +X m" etiketi + ücret etkisi (kabul önizlemesi ve mutabakat şeridi ortak). Engel değil, bilgi.
import { overrunInfo } from "./report-model";
import type { WarpingOrder } from "./types";

export interface OverrunCtx {
  fee?: WarpingOrder["fee"] | null;
  totalEnds?: number | null;
}

export function OverrunNote({ diffM, ctx, className }: { diffM: string; ctx?: OverrunCtx; className?: string }) {
  const o = overrunInfo(diffM, ctx?.fee, ctx?.totalEnds);
  if (!o) return null;
  return (
    <span className={className} data-testid="warping-overrun">
      <span className="rounded-badge bg-sky-500/15 px-1.5 py-0.5 text-xs font-medium text-sky-800 dark:text-sky-300">{o.label}</span>
      {o.feeNote && <span className="ml-1.5 text-xs text-muted-foreground">{o.feeNote}</span>}
    </span>
  );
}
