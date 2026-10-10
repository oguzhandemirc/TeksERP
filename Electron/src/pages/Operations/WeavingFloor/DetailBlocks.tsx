// Detay panelinin rakam blokları: vardiya üretimi, duruş dağılımı, dokuma işi + levent.
import { Cylinder } from "lucide-react";
import { StatusShape } from "./Markers";
import { STATUS_COLOR, hsl } from "./palette";
import { reasonIconOf } from "./stopReasons";
import { availabilityPct, formatNumber, formatShortDuration, performancePct, stopTotalsOf } from "./metrics";
import type { LiveLoom } from "./types";

function Figure({ value, label, unit }: { value: string; label: string; unit?: string }) {
  return (
    <div className="rounded-xl px-3 py-2.5" style={{ background: hsl("var(--ds-floor)") }}>
      <div className="text-xl font-extrabold tabular-nums" style={{ color: hsl("var(--ds-ink)") }}>
        {value}
        {unit && <span className="ml-0.5 text-sm font-bold text-muted-foreground">{unit}</span>}
      </div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
    </div>
  );
}

const percent = (n: number | null) => (n === null ? "—" : `%${n}`);

export function ShiftFigures({ loom: t }: { loom: LiveLoom }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Figure value={t.shift ? formatNumber(t.shift.meters) : "—"} unit={t.shift ? "m" : undefined} label="Üretim" />
      <Figure value={t.shift ? formatNumber(t.shift.picks / 1000) : "—"} unit={t.shift ? "bin" : undefined} label="Atkı" />
      <Figure value={percent(availabilityPct(t))} label="Vardiya çalışma" />
      <Figure value={percent(performancePct(t))} label="Hız" />
    </div>
  );
}

/** Sebebe göre duruş süresi — yatay çubuklar, en uzun üstte. */
export function StopBreakdown({ loom: t, now }: { loom: LiveLoom; now: number }) {
  const rows = stopTotalsOf(t, now);
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t.dayBreakdown ? "Bugün duruş yok." : "Bu vardiyada duruş yok."}</p>;
  const longest = Math.max(1, rows[0]!.ms);
  return (
    <ul className="space-y-2" aria-label="Sebebe göre duruşlar">
      {rows.map(({ reasonCode, label, lossClass, ms, count }) => {
        const status = lossClass ?? "UNPLANNED";
        return (
          <li key={reasonCode ?? "-"} className="flex items-center gap-2.5">
            <StatusShape status={status} icon={reasonIconOf(reasonCode, lossClass)} className="h-6 w-6 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {count}× · {formatShortDuration(ms)}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: hsl("var(--ds-ink)", 0.08) }}>
                <div className="h-full rounded-full" style={{ width: `${Math.max(4, (ms / longest) * 100)}%`, background: hsl(STATUS_COLOR[status]) }} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Bar({ ratio, color }: { ratio: number; color: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full" style={{ background: hsl("var(--ds-ink)", 0.08) }}>
      <div className="h-full rounded-full transition-[width] duration-1000" style={{ width: `${Math.min(1, Math.max(0, ratio)) * 100}%`, background: color }} />
    </div>
  );
}

/** Kalan iplik bu oranın altına inince levent uyarı rengine döner. */
const LOW_BEAM_RATIO = 0.08;

export function JobAndBeam({ loom: t }: { loom: LiveLoom }) {
  const beamRatio = t.beam ? t.beam.remainingM / t.beam.totalM : 0;
  const beamLow = beamRatio < LOW_BEAM_RATIO;
  return (
    <div className="space-y-4">
      {t.job && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="h-4 w-4 rounded-full" style={{ background: t.job.color, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.15)" }} />
            <span className="font-semibold">{t.job.fabric}</span>
            <span className="ml-auto text-sm tabular-nums text-muted-foreground">{t.job.no}</span>
          </div>
          {t.job.producedM !== null && t.job.plannedM ? (
            <>
              <Bar ratio={t.job.producedM / t.job.plannedM} color={hsl("var(--ds-run)")} />
              <div className="text-sm tabular-nums text-muted-foreground">
                {formatNumber(t.job.producedM)} / {formatNumber(t.job.plannedM)} m
              </div>
            </>
          ) : (
            t.job.plannedM !== null && <div className="text-sm tabular-nums text-muted-foreground">Plan {formatNumber(t.job.plannedM)} m</div>
          )}
        </div>
      )}
      {t.beam && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Cylinder className="h-4 w-4" style={{ color: hsl(beamLow ? "var(--ds-over)" : "var(--ds-ink)") }} />
            <span className="font-semibold">Levent {t.beam.no}</span>
            <span className="ml-auto text-sm font-semibold tabular-nums" style={{ color: beamLow ? hsl("var(--ds-over)") : undefined }}>
              {formatNumber(t.beam.remainingM)} m kaldı
            </span>
          </div>
          <Bar ratio={beamRatio} color={hsl(beamLow ? "var(--ds-over)" : "var(--ds-warp)")} />
        </div>
      )}
    </div>
  );
}
