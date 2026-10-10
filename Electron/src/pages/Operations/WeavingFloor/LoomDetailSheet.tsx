// Tezgah detayı (sağdan açılan panel): figür, açık duruş + uyarı zinciri,
// vardiya rakamları, sebebe göre duruşlar, son olaylar, dokuma işi ve levent.
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { JobAndBeam, ShiftFigures, StopBreakdown } from "./DetailBlocks";
import { StatusShape, TimerRing } from "./Markers";
import { LoomFigure } from "./LoomFigure";
import { AlertChainTimeline, EscalationDueLine, RecentEvents } from "./Timelines";
import { LOOM_TYPE_LABEL, STATE_SOURCE_LABEL, STATUS_COLOR, STATUS_LABEL, TIER_COLOR, TIER_LABEL, hsl, statusOf } from "./palette";
import { reasonIconOf } from "./stopReasons";
import { escalationTierOf, figureBeamRatio, formatNumber, formatTimer, targetProgress } from "./metrics";
import type { LiveLoom, OpenStop } from "./types";

interface Props {
  loom: LiveLoom | null;
  now: number;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-sm font-bold text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function OpenStopPanel({ stop, now }: { stop: OpenStop; now: number }) {
  const status = stop.lossClass ?? "UNPLANNED";
  const tier = escalationTierOf(stop, now);
  const color = TIER_COLOR[tier];
  const edge = tier === "ESCALATED" ? "var(--ds-escalated)" : STATUS_COLOR[status];
  return (
    <div
      className="space-y-4 rounded-2xl p-4"
      style={{ background: hsl(STATUS_COLOR[status], 0.08), boxShadow: `inset 0 0 0 1.5px ${hsl(edge, 0.5)}` }}
    >
      <div className="flex items-center gap-3">
        <StatusShape status={status} icon={reasonIconOf(stop.reasonCode, stop.lossClass)} className="h-14 w-14 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-lg font-extrabold">{stop.label}</div>
          <div className="text-sm font-semibold" style={{ color: hsl(color) }}>{TIER_LABEL[tier]}</div>
        </div>
        <div className="flex items-center gap-2">
          {tier !== "UNTRACKED" && <TimerRing progress={targetProgress(stop, now)} color={color} className="h-8 w-8" />}
          <div className="text-right">
            <div className="whitespace-nowrap text-3xl font-extrabold leading-none tabular-nums" style={{ color: hsl(color) }}>
              {formatTimer(now - stop.startedAt)}
            </div>
            {stop.targetMin !== null && <div className="mt-1 text-xs font-medium text-muted-foreground">hedef {stop.targetMin} dk</div>}
          </div>
        </div>
      </div>
      {tier !== "UNTRACKED" && (stop.attendant ? <AlertChainTimeline stop={stop} now={now} /> : <EscalationDueLine stop={stop} />)}
    </div>
  );
}

function DetailBody({ loom: t, now }: { loom: LiveLoom; now: number }) {
  const status = statusOf(t);
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 pr-8">
        <StatusShape status={status} className="h-7 w-7" />
        <div className="min-w-0">
          <SheetTitle className="text-2xl font-extrabold">Tezgah {t.code}</SheetTitle>
          <SheetDescription className="text-sm">
            {[t.hall, t.loomType ? LOOM_TYPE_LABEL[t.loomType] : null, STATUS_LABEL[status], t.monitored && t.stateSource ? `kaynak: ${STATE_SOURCE_LABEL[t.stateSource].toLowerCase()}` : null].filter(Boolean).join(" · ")}
            {status === "RUN" && t.rpm !== null ? ` · ${formatNumber(t.rpm)} atkı/dk` : ""}
          </SheetDescription>
        </div>
      </div>
      <div className="rounded-2xl p-4" style={{ background: hsl("var(--ds-floor)") }}>
        <LoomFigure
          running={status === "RUN"}
          rpm={t.rpm ?? 0}
          beamRatio={figureBeamRatio(t)}
          fabricColor={t.job?.color ?? "#999"}
          statusColor={STATUS_COLOR[status]}
          className="mx-auto h-36 w-auto"
        />
      </div>
      {t.openStop && <OpenStopPanel stop={t.openStop} now={now} />}
      {t.shift && (
        <Section title="Bu vardiya">
          <ShiftFigures loom={t} />
        </Section>
      )}
      <Section title={t.dayBreakdown ? "Bugünkü duruşlar" : "Duruşlar"}>
        <StopBreakdown loom={t} now={now} />
      </Section>
      {(t.job || t.beams.length > 0) && (
        <Section title={t.beams.length === 0 ? "Dokuma işi" : t.job ? "Dokuma işi ve levent" : "Levent"}>
          <JobAndBeam loom={t} />
        </Section>
      )}
      <Section title="Son olaylar">
        {t.events.length > 0 ? <RecentEvents events={t.events} now={now} /> : <p className="text-sm text-muted-foreground">Kayıtlı olay yok.</p>}
      </Section>
    </div>
  );
}

export function LoomDetailSheet({ loom, now, onClose }: Props) {
  return (
    <Sheet open={loom !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        {loom && <DetailBody loom={loom} now={now} />}
      </SheetContent>
    </Sheet>
  );
}
