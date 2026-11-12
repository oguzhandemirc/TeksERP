// Pano kutularının ortak küçük parçaları — sekme, halka (SVG), renk noktası. Renkler belirteçten (`--chart-N`, tema).
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useTabsStore } from "@/store/tabs";
import type { PanoTarget } from "./pano-hedefler";
import type { PanoErisim } from "./usePanoErisim";

/** Lejant/halka dilim belirteçleri — 6'dan sonrası başa döner. */
export const CHART_BG = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-chart-6"] as const;
export const CHART_STROKE = ["stroke-chart-1", "stroke-chart-2", "stroke-chart-3", "stroke-chart-4", "stroke-chart-5", "stroke-chart-6"] as const;

export interface TabItem { key: string; label: string }

/** Kutu başlığındaki küçük sekme anahtarı (tek seçenekte düz etiket). */
export function BoxTabs({ items, active, onChange, label }: { items: TabItem[]; active: string; onChange: (k: string) => void; label: string }) {
  if (items.length <= 1) return items[0] ? <span className="text-xs text-muted-foreground">{items[0].label}</span> : null;
  return (
    <div role="tablist" aria-label={label} className="flex rounded-lg bg-muted p-0.5 text-xs">
      {items.map((s) => (
        <button key={s.key} type="button" role="tab" aria-selected={s.key === active} onClick={() => onChange(s.key)}
          className={cn("rounded-md px-2 py-1 font-medium", s.key === active ? "bg-card shadow-sm" : "text-muted-foreground")}>{s.label}</button>
      ))}
    </div>
  );
}

export interface RingPart { value: number; stroke: string }

/** Segmentli halka — toplam 0 ise soluk tam halka. Ortadaki içerik `children`. */
export function Ring({ parts, size = 112, thickness = 12, label, children }: { parts: RingPart[]; size?: number; thickness?: number; label: string; children?: ReactNode }) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={thickness} className="stroke-muted" />
        {total > 0 && parts.map((p, i) => {
          const len = (Math.max(0, p.value) / total) * c;
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={thickness} strokeLinecap="butt"
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} className={p.stroke} />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-tight">{children}</div>
    </div>
  );
}

/** Renk noktası + etiket. */
export function LegendDot({ color, children, className }: { color: string; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", color)} aria-hidden />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/** Tıklanabilir satır kabuğu — hedef açılamıyorsa düz satır. */
export function RowLink({ onClick, className, children }: { onClick?: () => void; className?: string; children: ReactNode }) {
  const base = cn("flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-left text-sm", className);
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(base, "transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>{children}</button>
  ) : <div className={base}>{children}</div>;
}

/** Hedef açılabiliyorsa tıklama işlevi, değilse undefined (izin + modül + rapor kapısı). */
export function useGo(erisim: PanoErisim): (t: PanoTarget) => (() => void) | undefined {
  const navigateActive = useTabsStore((s) => s.navigateActive);
  return (t) => (erisim.canGo(t) ? () => navigateActive(t.to) : undefined);
}
