// Tek tezgah kartı — numara, canlı figür, alt şerit: çalışırken "bugün %" çubuğu,
// dururken halka + büyük sayaç ("bugün %" figürün köşesinde — sayaç ezilmesin); uyarı
// zinciri sağ üstte; takılı levent figürün sol altında (ilk bitecek olanın kalanı). Tıklanınca detay.
import { memo } from "react";
import { Cylinder, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { FloorHint, FocusHint } from "./FloorHint";
import { AlertChainMini, StatusShape, TimerRing } from "./Markers";
import { LoomFigure } from "./LoomFigure";
import { STAR_HINT, TODAY_PCT_HINT, beamHintOf, loomHintOf, sourceHintOf, type HintModel } from "./loomHints";
import { STATE_SOURCE_LABEL, STATUS_COLOR, STATUS_LABEL, TIER_COLOR, TIER_LABEL, hsl, statusOf, type StatusKey } from "./palette";
import { criticalBeamOf, escalationTierOf, figureBeamRatio, formatNumber, formatTimer, isBeamLow, targetProgress, todayAvailabilityPct, type EscalationTier } from "./metrics";
import { reasonIconOf } from "./stopReasons";
import type { BeamState, LiveLoom, OpenStop, StateSource } from "./types";

interface Props {
  loom: LiveLoom;
  now: number;
  star: boolean;
  onSelect: (id: string) => void;
}

const HOUR_MS = 3_600_000;

/** Kart sayacı: saatin altında `DD:SS`; üstünde rakamlar büyük, birimler küçük (`1 sa 35 dk` kesilmeden sığar). */
function CardTimer({ ms, color, ring }: { ms: number; color: string; ring: boolean }) {
  const long = ms >= HOUR_MS;
  // Satır bir boyut kabıdır (cqi): dar kartta yazı küçülür, hiçbir zaman kesilmez.
  const fontSize = long ? `min(1.3em, ${ring ? 19 : 22}cqi)` : "min(1.35em, 22cqi)";
  const min = Math.floor(ms / 60_000);
  return (
    <span className="whitespace-nowrap font-extrabold leading-none tabular-nums tracking-tight" style={{ color: hsl(color), fontSize }}>
      {long ? (
        <>
          {Math.floor(min / 60)}
          <small className="ml-px text-[0.6em] font-bold">sa</small> {String(min % 60).padStart(2, "0")}
          <small className="ml-px text-[0.6em] font-bold">dk</small>
        </>
      ) : (
        formatTimer(ms)
      )}
    </span>
  );
}

/** "bugün %84" — tezgahın bugünkü çalışma SÜRESİ payı (üst şeridin "şu an %"i ADET payıdır). */
function TodayPct({ pct }: { pct: number | null }) {
  return (
    <FloorHint hint={TODAY_PCT_HINT}>
      <span className="shrink-0 whitespace-nowrap text-xs font-semibold tabular-nums text-muted-foreground">
        <span className="text-[0.85em] font-medium">bugün </span>
        {pct === null ? "—" : `%${pct}`}
      </span>
    </FloorHint>
  );
}

/** Levent rozeti: kalan metre (az kalınca uyarı rengi); levent no ve diğer yuvalar ipucunda. */
function BeamBadge({ beams }: { beams: BeamState[] }) {
  const b = criticalBeamOf(beams);
  if (!b) return null;
  const low = isBeamLow(b);
  return (
    <FloorHint hint={beamHintOf(beams)}>
      <span
        className="absolute bottom-0 left-0 flex items-center gap-0.5 rounded-md px-1 text-xs font-semibold leading-tight tabular-nums"
        style={{ background: hsl("var(--ds-tile)", 0.85), color: hsl(low ? "var(--ds-over)" : "var(--ds-ink)", low ? 1 : 0.7) }}
        data-testid="beam-badge"
      >
        <Cylinder className="h-3 w-3 shrink-0" aria-hidden />
        {formatNumber(b.remainingM)} m{beams.length > 1 && <small className="ml-0.5 font-medium">+{beams.length - 1}</small>}
      </span>
    </FloorHint>
  );
}

function StoppedFooter({ stop, now }: { stop: OpenStop; now: number }) {
  const tier = escalationTierOf(stop, now);
  const color = TIER_COLOR[tier];
  const ring = tier !== "UNTRACKED";
  return (
    <div className="flex h-6 items-center gap-1.5" style={{ containerType: "inline-size" }}>
      {ring && <TimerRing progress={targetProgress(stop, now)} color={color} className="h-5 w-5 shrink-0" />}
      <CardTimer ms={Math.max(0, now - stop.startedAt)} color={color} ring={ring} />
    </div>
  );
}

function RunningFooter({ loom }: { loom: LiveLoom }) {
  const pct = todayAvailabilityPct(loom);
  return (
    <div className="flex h-6 items-center gap-2">
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full" style={{ background: hsl("var(--ds-ink)", 0.1) }}>
        <div className="h-full rounded-full transition-[width] duration-1000" style={{ width: `${pct ?? 0}%`, background: hsl("var(--ds-run)") }} />
      </div>
      <TodayPct pct={pct} />
    </div>
  );
}

function UnmonitoredFooter({ hint }: { hint: HintModel }) {
  return (
    <div className="flex h-6 items-center text-xs font-semibold text-muted-foreground">
      <FloorHint hint={hint}>
        <span>{STATUS_LABEL.UNMONITORED}</span>
      </FloorHint>
    </div>
  );
}

/** Durumun kaynağı figürün sol üstünde: "Ölçülen" / "Elle" / "Simüle" — elle veri ölçülmüş gibi okunmasın. */
function SourceTag({ source }: { source: StateSource }) {
  return (
    <FloorHint hint={sourceHintOf(source)}>
      <span
        data-testid="source-tag"
        className="absolute left-0 top-0 rounded-md px-1 text-[0.7em] font-semibold leading-tight text-muted-foreground"
        style={{ background: hsl("var(--ds-tile)", 0.85) }}
      >
        {STATE_SOURCE_LABEL[source]}
      </span>
    </FloorHint>
  );
}

function sourceText(t: LiveLoom): string {
  return t.stateSource && t.stateSource !== "cikarim" ? ` (${STATE_SOURCE_LABEL[t.stateSource].toLowerCase()})` : "";
}

function beamText(t: LiveLoom): string {
  const b = criticalBeamOf(t.beams);
  return b ? `, levent ${b.no} ${formatNumber(b.remainingM)} m kaldı` : "";
}

function ariaLabelOf(t: LiveLoom, now: number): string {
  if (!t.monitored) return `Tezgah ${t.code}, veri yok${beamText(t)}`;
  const today = todayAvailabilityPct(t);
  const todayText = today === null ? "" : `, bugün %${today}`;
  if (!t.openStop) return `Tezgah ${t.code}, çalışıyor${sourceText(t)}${todayText}${beamText(t)}`;
  return `Tezgah ${t.code}, duruyor${sourceText(t)}: ${t.openStop.label}, ${formatTimer(now - t.openStop.startedAt)}, ${TIER_LABEL[escalationTierOf(t.openStop, now)]}${todayText}${beamText(t)}`;
}

/** Ad sığmazsa önce küçülür (boyut kabı), yine sığmazsa kırpılır; tam ad ipucunda. */
function nameFontSize(code: string): string {
  const fit = Math.floor(100 / Math.max(1, code.length * 0.62));
  return `max(0.8em, min(1.35em, ${fit}cqi))`;
}

interface HeaderProps {
  t: LiveLoom;
  stop: OpenStop | null;
  tier: EscalationTier | null;
  status: StatusKey;
  star: boolean;
  hint: HintModel;
  now: number;
}

function CardHeader({ t, stop, tier, status, star, hint, now }: HeaderProps) {
  return (
    <div className="flex h-5 items-center justify-between gap-1">
      <span className="min-w-0 flex-1" style={{ containerType: "inline-size" }}>
        <FloorHint hint={hint}>
          <span
            className="block truncate font-extrabold leading-none tabular-nums"
            style={{ color: hsl("var(--ds-ink)"), fontSize: nameFontSize(t.code) }}
            data-testid="loom-name"
          >
            {t.code}
          </span>
        </FloorHint>
      </span>
      {star && (
        <FloorHint hint={STAR_HINT}>
          <span className="shrink-0">
            <Star className="h-4 w-4 fill-current" style={{ color: hsl("var(--ds-over)") }} aria-label="Vardiyanın yıldızı" />
          </span>
        </FloorHint>
      )}
      {stop && stop.attendant && tier !== "UNTRACKED" ? (
        <AlertChainMini stop={stop} tier={tier!} now={now} compact />
      ) : (
        <FloorHint hint={hint}>
          <span className="inline-flex shrink-0">
            <StatusShape status={status} className="h-5 w-5" />
          </span>
        </FloorHint>
      )}
    </div>
  );
}

function LoomCardImpl({ loom: t, now, star, onSelect }: Props) {
  const status = statusOf(t);
  const color = STATUS_COLOR[status];
  const stop = t.monitored ? t.openStop : null;
  const reasonIcon = stop ? reasonIconOf(stop.reasonCode, stop.lossClass) : null;
  const tier = stop ? escalationTierOf(stop, now) : null;
  const justStopped = stop !== null && now - stop.startedAt < 4_000;
  const ringColor = tier === "ESCALATED" ? "var(--ds-escalated)" : color;
  const hint = loomHintOf(t, now);
  return (
    <FocusHint hint={hint}>
      <button
        type="button"
        onClick={() => onSelect(t.id)}
        aria-label={ariaLabelOf(t, now)}
        className={cn(
          "group relative flex min-w-0 flex-col gap-1 rounded-2xl p-2.5 text-left outline-none transition-transform",
          "hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring",
          tier === "ESCALATED" && "ds-breathe",
          justStopped && "ds-just-stopped",
        )}
        style={{
          background: hsl("var(--ds-tile)"),
          boxShadow: `inset 0 0 0 ${stop ? 2 : 1}px ${stop ? hsl(ringColor, 0.85) : hsl("var(--ds-ink)", 0.1)}`,
        }}
      >
        <CardHeader t={t} stop={stop} tier={tier} status={status} star={star} hint={hint} now={now} />
        <div className="relative">
          <LoomFigure
            running={status === "RUN"}
            rpm={t.rpm ?? 0}
            beamRatio={figureBeamRatio(t)}
            fabricColor={t.job?.color ?? "#999"}
            statusColor={color}
            className={cn("w-full transition-opacity", status !== "RUN" && "opacity-45")}
          />
          {reasonIcon && (
            <FloorHint hint={hint}>
              <span className="absolute left-1/2 top-1/2 h-[3.2em] w-[3.2em] -translate-x-1/2 -translate-y-1/2" data-testid="reason-icon">
                <StatusShape status={status} icon={reasonIcon} className="h-full w-full drop-shadow" />
              </span>
            </FloorHint>
          )}
          {t.monitored && t.stateSource && t.stateSource !== "cikarim" && <SourceTag source={t.stateSource} />}
          <BeamBadge beams={t.beams} />
          {stop && (
            <span className="absolute bottom-0 right-0 rounded-md px-1 leading-tight" style={{ background: hsl("var(--ds-tile)", 0.85) }}>
              <TodayPct pct={todayAvailabilityPct(t)} />
            </span>
          )}
        </div>
        {!t.monitored ? <UnmonitoredFooter hint={hint} /> : stop ? <StoppedFooter stop={stop} now={now} /> : <RunningFooter loom={t} />}
        <span className="sr-only">{STATUS_LABEL[status]}</span>
      </button>
    </FocusHint>
  );
}

export const LoomCard = memo(LoomCardImpl);
