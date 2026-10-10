// Tek tezgah kartı — numara, canlı figür, alt şerit: çalışırken "bugün %" çubuğu,
// dururken halka + büyük sayaç ("bugün %" figürün köşesinde — sayaç ezilmesin); uyarı
// zinciri sağ üstte. Tıklanınca detay.
import { memo } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { AlertChainMini, StatusShape, TimerRing } from "./Markers";
import { LoomFigure } from "./LoomFigure";
import { STATUS_COLOR, STATUS_LABEL, TIER_COLOR, TIER_LABEL, hsl, statusOf } from "./palette";
import { escalationTierOf, formatTimer, targetProgress, todayAvailabilityPct } from "./metrics";
import { reasonOf } from "./stopReasons";
import type { LiveLoom, OpenStop } from "./types";

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
    <span className="shrink-0 whitespace-nowrap text-xs font-semibold tabular-nums text-muted-foreground" title="Bugünkü çalışma süresi payı: çalışılan süre / planlı süre (plan dışı duruş sayılmaz)">
      <span className="text-[0.85em] font-medium">bugün </span>
      {pct === null ? "—" : `%${pct}`}
    </span>
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

function ariaLabelOf(t: LiveLoom, now: number): string {
  const today = todayAvailabilityPct(t);
  const todayText = today === null ? "" : `, bugün %${today}`;
  if (!t.openStop) return `Tezgah ${t.code}, çalışıyor${todayText}`;
  const r = reasonOf(t.openStop.reasonCode);
  return `Tezgah ${t.code}, duruyor: ${r.label}, ${formatTimer(now - t.openStop.startedAt)}, ${TIER_LABEL[escalationTierOf(t.openStop, now)]}${todayText}`;
}

function LoomCardImpl({ loom: t, now, star, onSelect }: Props) {
  const status = statusOf(t);
  const color = STATUS_COLOR[status];
  const stop = t.openStop;
  const reason = stop ? reasonOf(stop.reasonCode) : null;
  const tier = stop ? escalationTierOf(stop, now) : null;
  const justStopped = stop !== null && now - stop.startedAt < 4_000;
  const ringColor = tier === "ESCALATED" ? "var(--ds-escalated)" : color;
  return (
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
      <div className="flex h-5 items-center justify-between gap-1">
        <span className="flex items-center gap-1 text-[1.35em] font-extrabold leading-none tabular-nums" style={{ color: hsl("var(--ds-ink)") }}>
          {t.code}
          {star && <Star className="h-4 w-4 fill-current" style={{ color: hsl("var(--ds-over)") }} aria-label="Vardiyanın yıldızı" />}
        </span>
        {stop && tier !== "UNTRACKED" ? (
          <AlertChainMini stop={stop} tier={tier!} now={now} compact />
        ) : (
          <StatusShape status={status} className="h-5 w-5" />
        )}
      </div>
      <div className="relative">
        <LoomFigure
          running={!stop}
          rpm={t.rpm}
          beamRatio={t.beam ? t.beam.remainingM / t.beam.totalM : 0}
          fabricColor={t.job?.color ?? "#999"}
          statusColor={color}
          className={cn("w-full transition-opacity", stop && "opacity-45")}
        />
        {reason && (
          <StatusShape
            status={status}
            icon={reason.icon}
            className="absolute left-1/2 top-1/2 h-[3.2em] w-[3.2em] -translate-x-1/2 -translate-y-1/2 drop-shadow"
          />
        )}
        {stop && (
          <span className="absolute bottom-0 right-0 rounded-md px-1 leading-tight" style={{ background: hsl("var(--ds-tile)", 0.85) }}>
            <TodayPct pct={todayAvailabilityPct(t)} />
          </span>
        )}
      </div>
      {stop ? <StoppedFooter stop={stop} now={now} /> : <RunningFooter loom={t} />}
      <span className="sr-only">{STATUS_LABEL[status]}</span>
    </button>
  );
}

export const LoomCard = memo(LoomCardImpl);
