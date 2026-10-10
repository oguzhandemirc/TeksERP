// Detay zaman çizgileri: açık duruşun uyarı zinciri ve tezgahın son olayları.
// Saatler fabrika diliminden (`formatFactory`), çıplak toLocale yok.
import { BellRing, CirclePlay, CircleStop, Crown, Hand, Scroll, type LucideIcon } from "lucide-react";
import { formatFactory } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { TIER_COLOR, hsl } from "./palette";
import { escalationDueAt, escalationTierOf, formatShortDuration } from "./metrics";
import type { LoomEvent, LoomEventKind, OpenStop, Person } from "./types";

const clock = (ms: number) => formatFactory(ms, "HH:mm");

/** Zincirin son halkası — kişi değil makam; iletilene dek ad bilinmez. */
const OWNER_ROLE: Person = { id: "owner", name: "Patron", role: "OWNER" };

function Avatar({ person }: { person: Person }) {
  const initials = person.name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2);
  const color = person.role === "OWNER" ? "var(--ds-escalated)" : "var(--ds-planned)";
  return (
    <span
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold"
      style={{ background: hsl(color, 0.16), color: hsl(color) }}
      aria-hidden="true"
    >
      {person.role === "OWNER" ? <Crown className="h-3.5 w-3.5" /> : initials}
    </span>
  );
}

interface ChainStep {
  Icon: LucideIcon;
  title: string;
  person: Person;
  at: number | null;
  color: string;
}

const NO_ATTENDANT: Person = { id: "-", name: "Görevli atanmadı", role: "ATTENDANT" };

/**
 * Bildirim kanalı yokken (gerçek veri, bu dilim) zincir yerine tek satır: hedef + pay
 * ve patrona iletimin olması gereken saat. Saat fabrika diliminden.
 */
export function EscalationDueLine({ stop }: { stop: OpenStop }) {
  const due = escalationDueAt(stop);
  if (stop.targetMin === null || due === null) return null;
  return (
    <p className="text-sm text-muted-foreground">
      Hedef {stop.targetMin} dk{stop.graceMin > 0 ? ` + pay ${stop.graceMin} dk` : ""} · patrona iletim zamanı{" "}
      <span className="font-semibold tabular-nums text-foreground">{clock(due)}</span>
    </p>
  );
}

/** Uyarı zinciri (detay): üç kademe, gerçekleşen yanar, bekleyen soluk ve beklenen saatiyle. */
export function AlertChainTimeline({ stop, now }: { stop: OpenStop; now: number }) {
  const tier = escalationTierOf(stop, now);
  const ownerDue = escalationDueAt(stop);
  const attendant = stop.attendant ?? NO_ATTENDANT;
  const steps: ChainStep[] = [
    { Icon: BellRing, title: "Görevliye bildirildi", person: attendant, at: stop.notifiedAt, color: "var(--ds-ink)" },
    { Icon: Hand, title: stop.respondedAt ? "Görevli tezgahta" : "Görevli bekleniyor", person: attendant, at: stop.respondedAt, color: "var(--ds-run)" },
    { Icon: Crown, title: tier === "ESCALATED" ? "Patrona iletildi" : "Hedef aşılırsa patrona", person: OWNER_ROLE, at: stop.escalatedAt, color: "var(--ds-escalated)" },
  ];
  return (
    <ol className="relative space-y-3" aria-label="Uyarı zinciri">
      {steps.map((s, i) => {
        const done = s.at !== null && s.at <= now;
        const expected = i === 2 && !done ? ownerDue : null;
        return (
          <li key={s.title} className={cn("flex items-center gap-3", !done && "opacity-55")}>
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
              style={{ background: done ? hsl(s.color, 0.16) : "transparent", color: hsl(s.color), boxShadow: done ? undefined : `inset 0 0 0 1.5px ${hsl(s.color, 0.4)}` }}
            >
              <s.Icon className="h-4 w-4" strokeWidth={2.4} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{s.title}</div>
              <div className="text-xs text-muted-foreground">{s.person.name}</div>
            </div>
            <Avatar person={s.person} />
            <span className="w-12 text-right text-sm font-semibold tabular-nums" style={{ color: done && i === 2 ? hsl(TIER_COLOR.ESCALATED) : undefined }}>
              {done ? clock(s.at!) : expected ? `~${clock(expected)}` : "—"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const EVENT_STYLE: Record<LoomEventKind, { Icon: LucideIcon; color: string; text: string }> = {
  RUN: { Icon: CirclePlay, color: "var(--ds-run)", text: "Çalıştı" },
  STOP: { Icon: CircleStop, color: "var(--ds-unplanned)", text: "Durdu" },
  NOTIFY: { Icon: BellRing, color: "var(--ds-ink)", text: "Bildirim" },
  RESPOND: { Icon: Hand, color: "var(--ds-run)", text: "Müdahale" },
  ESCALATE: { Icon: Crown, color: "var(--ds-escalated)", text: "Patrona iletildi" },
  DOFF: { Icon: Scroll, color: "var(--ds-planned)", text: "Top indi" },
};

/** Son olaylar — en yeni üstte; duruşun sebebi aynı satırda. */
export function RecentEvents({ events, now }: { events: readonly LoomEvent[]; now: number }) {
  const visible = events.filter((e) => e.at <= now).slice(0, 10);
  return (
    <ol className="space-y-1.5" aria-label="Son olaylar">
      {visible.map((e, i) => {
        const style = EVENT_STYLE[e.kind];
        return (
          <li key={`${e.at}-${e.kind}-${i}`} className="flex items-center gap-2.5 text-sm">
            <span className="w-11 shrink-0 tabular-nums text-muted-foreground">{clock(e.at)}</span>
            <style.Icon className="h-4 w-4 shrink-0" style={{ color: hsl(style.color) }} />
            <span className="font-medium">{e.label ?? style.text}</span>
            {e.person && <span className="text-muted-foreground">{e.person.name}</span>}
            {i === 0 && <span className="ml-auto text-xs text-muted-foreground">{formatShortDuration(now - e.at)} önce</span>}
          </li>
        );
      })}
    </ol>
  );
}
