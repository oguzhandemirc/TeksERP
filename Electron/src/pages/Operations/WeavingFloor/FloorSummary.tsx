// Üst özet şeridi — dört büyük cevap: kaç tezgah çalışıyor, kaçı duruyor (sınıf
// şekilleriyle), "şu an %" (şu an çalışan tezgah oranı), vardiya hedefi; sağda saat.
import { formatFactory } from "@/lib/factory-time";
import { StatusShape, TimerRing } from "./Markers";
import { STATUS_LABEL, hsl, statusOf, type StatusKey } from "./palette";
import { formatNumber, formatShortDuration, summarizeFloor } from "./metrics";
import type { FloorState } from "./types";

interface Props {
  floor: FloorState;
  now: number;
}

const STOP_CLASSES: StatusKey[] = ["UNPLANNED", "SETUP", "PLANNED", "NON_SCHEDULED"];

function Block({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex min-w-0 items-center gap-3 px-4 py-3 ${className ?? ""}`}>{children}</div>;
}

function Caption({ children }: { children: React.ReactNode }) {
  return <div className="whitespace-nowrap text-[0.8em] font-medium text-muted-foreground">{children}</div>;
}

function StoppedBreakdown({ floor }: { floor: FloorState }) {
  const counts = new Map<StatusKey, number>();
  for (const t of floor.looms) {
    const s = statusOf(t);
    if (s !== "RUN" && s !== "UNMONITORED") counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {STOP_CLASSES.filter((s) => counts.get(s)).map((s) => (
        <span key={s} className="inline-flex items-center gap-1 text-[0.85em] font-semibold tabular-nums" title={STATUS_LABEL[s]}>
          <StatusShape status={s} className="h-3.5 w-3.5" />
          {counts.get(s)}
          <span className="sr-only">{STATUS_LABEL[s]}</span>
        </span>
      ))}
    </div>
  );
}

export function FloorSummary({ floor, now }: Props) {
  const s = summarizeFloor(floor.looms, now);
  const targetRatio = s.meters !== null && s.targetMeters ? Math.min(1, s.meters / s.targetMeters) : 0;
  const ink = { color: hsl("var(--ds-ink)") };
  return (
    <section
      aria-label="Salon özeti"
      className="grid grid-cols-2 overflow-hidden rounded-2xl md:grid-cols-[auto_auto_auto_minmax(14rem,1fr)_auto] md:divide-x"
      style={{ background: hsl("var(--ds-tile)"), boxShadow: `inset 0 0 0 1px ${hsl("var(--ds-ink)", 0.08)}` }}
    >
      <Block>
        <StatusShape status="RUN" className="h-7 w-7" />
        <div>
          <div className="text-[2em] font-extrabold leading-none tabular-nums" style={ink}>
            {s.running}
            <span className="text-[0.5em] font-bold text-muted-foreground">/{s.monitored}</span>
          </div>
          <Caption>Çalışıyor{s.unmonitored > 0 ? ` · ${s.unmonitored} veri yok` : ""}</Caption>
        </div>
      </Block>
      <Block>
        <StatusShape status="UNPLANNED" className="h-7 w-7" />
        <div>
          <div className="text-[2em] font-extrabold leading-none tabular-nums" style={ink}>{s.stopped}</div>
          <StoppedBreakdown floor={floor} />
        </div>
      </Block>
      <Block>
        <TimerRing progress={(s.runningNowPct ?? 0) / 100} color="var(--ds-run)" className="h-10 w-10" />
        <div title="Şu an çalışan tezgah adedi / tüm tezgahlar — süreye değil ADEDE bakar (kartlardaki “bugün %” süre payıdır)">
          <div className="text-[2em] font-extrabold leading-none tabular-nums" style={ink}>
            <span className="mr-1 text-[0.45em] font-bold uppercase tracking-wide text-muted-foreground">şu an</span>
            {s.runningNowPct === null ? "—" : `%${s.runningNowPct}`}
          </div>
          <Caption>Çalışan tezgah payı (adet)</Caption>
        </div>
      </Block>
      <Block className="col-span-2 md:col-span-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[1.5em] font-extrabold tabular-nums" style={ink}>{s.meters === null ? "—" : `${formatNumber(s.meters)} m`}</span>
            {s.targetMeters !== null && (
              <span className="text-[0.85em] font-semibold tabular-nums text-muted-foreground">hedef {formatNumber(s.targetMeters)} m</span>
            )}
          </div>
          <div className="mt-1.5 h-2.5 overflow-hidden rounded-full" style={{ background: hsl("var(--ds-ink)", 0.1) }}>
            <div className="h-full rounded-full transition-[width] duration-1000" style={{ width: `${targetRatio * 100}%`, background: hsl("var(--ds-run)") }} />
          </div>
          <Caption>{s.meters === null ? "Vardiya metresi — sayaç bağlı değil" : "Vardiya hedefi"}</Caption>
        </div>
      </Block>
      <Block className="col-span-2 justify-between md:col-span-1 md:justify-start">
        <div className="text-right">
          <div className="text-[2em] font-extrabold leading-none tabular-nums" style={ink}>{formatFactory(now, "HH:mm")}</div>
          <Caption>
            {floor.shift ? `${floor.shift.name} · ${formatShortDuration(floor.shift.endsAt - now)} kaldı` : "Vardiya tanımı yok"}
          </Caption>
        </div>
      </Block>
    </section>
  );
}
