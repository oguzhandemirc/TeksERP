// =============================================================================
// MOCK SİMÜLASYON ADIMI — saf: (durum, an) → yeni durum
// =============================================================================
// Çalışan tezgah üretir ve ara sıra durur; duran tezgahta görevli gelir, hedef
// (+ pay) dolarsa patrona iletilir, müdahale edilen duruş kapanır. Aynı girdi aynı çıktı.
// =============================================================================
import type { FloorState, LiveLoom, LoomEvent, OpenStop } from "../types";
import { OWNER, SUDDEN_STOP_WEIGHTS } from "./catalog";
import { metersOf, openStopOf, reasonFields, stampEscalation } from "./createFloor";
import { createRandom, type Random } from "./random";

const MINUTE = 60_000;
/** Çalışan bir tezgahın ortalama durmadan koştuğu süre (sn) — salonu canlı tutar. */
const MEAN_RUN_SEC = 15 * 60;
/** Görevlinin bildirimi görüp tezgaha gelme ortalaması (sn). */
const MEAN_RESPONSE_SEC = 150;
/** Bir adımın en fazla ilerletebileceği süre — uyuyan sekme uyanınca sıçrama olmasın. */
const MAX_STEP_MS = 60_000;

const withEvents = (t: LiveLoom, ...added: LoomEvent[]): LoomEvent[] =>
  [...added, ...t.events].sort((a, b) => b.at - a.at).slice(0, 20);

// Önizleme tezgahının sayaçları DAİMA doludur (`createLoom`); `!` yalnız bu üreticide.
function advanceRunning(r: Random, t: LiveLoom, now: number, dtMs: number): LiveLoom {
  const shift = t.shift!;
  const rpm = Math.round(t.targetRpm! * r.range(0.9, 1));
  const picks = (rpm * dtMs) / MINUTE;
  const meters = metersOf(picks, t.picksPerCm!);
  // Önizleme tek yuvalıdır: levent dizisinin ilk elemanı.
  const beam = t.beams[0] ?? null;
  const remainingM = beam ? Math.max(0, beam.remainingM - meters * 1.08) : 0;
  const next: LiveLoom = {
    ...t,
    rpm,
    shift: {
      ...shift,
      picks: shift.picks + picks,
      meters: shift.meters + meters,
      runSec: shift.runSec + dtMs / 1000,
      plannedSec: shift.plannedSec + dtMs / 1000,
    },
    today: { runSec: t.today.runSec + dtMs / 1000, plannedSec: t.today.plannedSec + dtMs / 1000 },
    job: t.job ? { ...t.job, producedM: (t.job.producedM ?? 0) + meters } : null,
    beams: beam ? [{ ...beam, remainingM }] : [],
  };
  const beamEmpty = beam !== null && remainingM <= 0;
  if (!beamEmpty && r.next() >= dtMs / 1000 / MEAN_RUN_SEC) return next;
  const reason = beamEmpty ? "LEVENT_BAGLAMA" : r.weighted(SUDDEN_STOP_WEIGHTS);
  const open = openStopOf(reason, now, t.hall, null);
  return {
    ...next,
    rpm: 0,
    openStop: open,
    events: withEvents(
      next,
      { at: now, kind: "STOP", ...reasonFields(reason) },
      { at: open.notifiedAt!, kind: "NOTIFY", person: open.attendant! },
    ),
  };
}

function closeStop(r: Random, t: LiveLoom, open: OpenStop, now: number): LiveLoom {
  const old = t.beams[0];
  const beams = open.reasonCode === "LEVENT_BAGLAMA" && old ? [{ ...old, no: `${old.no}+`, remainingM: old.totalM ?? old.remainingM }] : t.beams;
  return {
    ...t,
    openStop: null,
    rpm: Math.round(t.targetRpm! * r.range(0.9, 1)),
    stops: [...t.stops, { reasonCode: open.reasonCode, label: open.label, lossClass: open.lossClass, startedAt: open.startedAt, endedAt: now }],
    events: withEvents(t, { at: now, kind: "RUN" }),
    beams,
  };
}

function advanceStopped(r: Random, t: LiveLoom, now: number, dtMs: number): LiveLoom {
  const unscheduled = t.openStop!.lossClass === "NON_SCHEDULED";
  let open: OpenStop = t.openStop!;
  const added: LoomEvent[] = [];
  if (open.respondedAt === null && !unscheduled && r.next() < dtMs / 1000 / MEAN_RESPONSE_SEC) {
    open = { ...open, respondedAt: now };
    added.push({ at: now, kind: "RESPOND", person: open.attendant! });
  }
  const stamped = stampEscalation(open, now);
  if (stamped !== open) {
    open = stamped;
    added.push({ at: open.escalatedAt!, kind: "ESCALATE", person: OWNER });
  }
  const plannedDelta = unscheduled ? 0 : dtMs / 1000;
  const mid: LiveLoom = {
    ...t,
    openStop: open,
    shift: { ...t.shift!, plannedSec: t.shift!.plannedSec + plannedDelta },
    today: { ...t.today, plannedSec: t.today.plannedSec + plannedDelta },
    events: added.length ? withEvents(t, ...added) : t.events,
  };
  const meanFixSec = (open.targetMin ?? 240) * 60 * 0.7;
  const fixed = open.respondedAt !== null && now - open.respondedAt > 20_000 && r.next() < dtMs / 1000 / meanFixSec;
  const unscheduledEnds = unscheduled && r.next() < dtMs / 1000 / 3600;
  return fixed || unscheduledEnds ? closeStop(r, mid, open, now) : mid;
}

/** Bir simülasyon adımı. `now` geçmişe giderse durum aynen döner. */
export function stepFloor(floor: FloorState, now: number): FloorState {
  const dtMs = Math.min(MAX_STEP_MS, now - floor.updatedAt);
  if (dtMs <= 0) return floor;
  const r = createRandom(floor.rng);
  const looms = floor.looms.map((t) => (t.openStop ? advanceStopped(r, t, now, dtMs) : advanceRunning(r, t, now, dtMs)));
  return { ...floor, looms, updatedAt: now, rng: r.state() };
}
