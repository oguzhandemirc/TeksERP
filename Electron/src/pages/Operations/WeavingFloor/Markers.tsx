// Küçük görsel işaretler: durum şekli, sayaç halkası, uyarı zinciri.
// Her durum renkten BAĞIMSIZ bir şekil taşır (renk körlüğünde de ayrışsın).
import { BellRing, Crown, Hand } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EscalationTier } from "./metrics";
import { STATUS_COLOR, hsl, type StatusKey } from "./palette";
import type { ReasonIcon } from "./stopReasons";
import type { OpenStop } from "./types";

const SHAPE_PATH: Record<StatusKey, string> = {
  // çalışıyor: daire · arıza: sekizgen (dur levhası) · ayar: eşkenar dörtgen
  // planlı: yuvarlak kare · plan dışı: kesik çizgili daire
  RUN: "M12 2a10 10 0 1 1 0 20a10 10 0 1 1 0-20Z",
  UNPLANNED: "M7.9 1.5h8.2l5.9 5.9v8.2l-5.9 5.9H7.9L2 15.6V7.4Z",
  SETUP: "M12 1 23 12 12 23 1 12Z",
  PLANNED: "M6 2h12a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4Z",
  NON_SCHEDULED: "M12 2a10 10 0 1 1 0 20a10 10 0 1 1 0-20Z",
};

interface ShapeProps {
  status: StatusKey;
  icon?: ReasonIcon;
  className?: string;
}

/** Durum şekli + içinde sebep simgesi. */
export function StatusShape({ status, icon: Icon, className }: ShapeProps) {
  const color = hsl(STATUS_COLOR[status]);
  const hollow = status === "NON_SCHEDULED";
  return (
    <span className={cn("relative inline-grid place-items-center", className)}>
      <svg viewBox="0 0 24 24" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <path
          d={SHAPE_PATH[status]}
          fill={hollow ? "transparent" : color}
          stroke={color}
          strokeWidth={hollow ? 1.6 : 0}
          strokeDasharray={hollow ? "3 2.4" : undefined}
        />
      </svg>
      {Icon && <Icon className={cn("relative h-[52%] w-[52%]", hollow ? "" : "text-white")} strokeWidth={2.4} />}
    </span>
  );
}

interface RingProps {
  progress: number;
  color: string;
  className?: string;
}

/** Hedef sürenin tüketilen kısmı — dolan halka. */
export function TimerRing({ progress, color, className }: RingProps) {
  const C = 2 * Math.PI * 9;
  return (
    <svg viewBox="0 0 24 24" className={cn("-rotate-90", className)} aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="3.5" />
      <circle cx="12" cy="12" r="9" fill="none" stroke={hsl(color)} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${C * progress} ${C}`} />
    </svg>
  );
}

interface ChainProps {
  stop: OpenStop;
  tier: EscalationTier;
  now: number;
  /** Kartın dar köşesi için küçük boy (16 px halka, 3 px bağ). */
  compact?: boolean;
  className?: string;
}

/** Uyarı zinciri: görevliye bildirildi → müdahalede → patrona iletildi. */
export function AlertChainMini({ stop, tier, now, compact = false, className }: ChainProps) {
  const steps = [
    { Icon: BellRing, lit: stop.notifiedAt <= now, color: "var(--ds-ink)", label: `${stop.attendant.name} bildirim aldı` },
    { Icon: Hand, lit: stop.respondedAt !== null, color: "var(--ds-run)", label: stop.respondedAt ? "Görevli tezgahta" : "Görevli henüz gelmedi" },
    { Icon: Crown, lit: tier === "ESCALATED", color: "var(--ds-escalated)", label: tier === "ESCALATED" ? "Patrona iletildi" : "Patrona iletilmedi" },
  ];
  return (
    <span className={cn("inline-flex shrink-0 items-center", className)} aria-label={steps.map((s) => s.label).join(", ")} role="img">
      {steps.map(({ Icon, lit, color, label }, i) => (
        <span key={label} className="inline-flex items-center" title={label}>
          {i > 0 && <span className={cn("h-px", compact ? "w-[3px]" : "w-1.5")} style={{ background: lit ? hsl(color) : hsl("var(--ds-ink)", 0.2) }} />}
          <span
            className={cn("grid place-items-center rounded-full", compact ? "h-4 w-4" : "h-5 w-5")}
            style={{
              background: lit ? hsl(color, 0.16) : "transparent",
              color: lit ? hsl(color) : hsl("var(--ds-ink)", 0.28),
              boxShadow: lit ? undefined : `inset 0 0 0 1px ${hsl("var(--ds-ink)", 0.16)}`,
            }}
          >
            <Icon className={compact ? "h-2.5 w-2.5" : "h-3.5 w-3.5"} strokeWidth={2.6} />
          </span>
        </span>
      ))}
    </span>
  );
}
