// =============================================================================
// MOCK SİMÜLASYON ADIMI — saf: (durum, an) → yeni durum
// =============================================================================
// Çalışan tezgah üretir ve ara sıra durur; duran tezgahta görevli gelir, hedef
// (+ pay) dolarsa patrona iletilir, müdahale edilen duruş kapanır. Aynı girdi aynı çıktı.
// =============================================================================
import { reasonOf } from "../stopReasons";
import type { FloorState, LiveLoom, LoomEvent, OpenStop } from "../types";
import { OWNER, SUDDEN_STOP_WEIGHTS } from "./catalog";
import { metersOf, openStopOf, stampEscalation } from "./createFloor";
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

function advanceRunning(r: Random, t: LiveLoom, now: number, dtMs: number): LiveLoom {
  const rpm = Math.round(t.targetRpm * r.range(0.9, 1));
  const picks = (rpm * dtMs) / MINUTE;
  const meters = metersOf(picks, t.picksPerCm);
  const remainingM = t.beam ? Math.max(0, t.beam.remainingM - meters * 1.08) : 0;
  const next: LiveLoom = {
    ...t,
    rpm,
    shift: {
      ...t.shift,
      picks: t.shift.picks + picks,
      meters: t.shift.meters + meters,
      runSec: t.shift.runSec + dtMs / 1000,
      plannedSec: t.shift.plannedSec + dtMs / 1000,
    },
    today: { runSec: t.today.runSec + dtMs / 1000, plannedSec: t.today.plannedSec + dtMs / 1000 },
    job: t.job ? { ...t.job, producedM: t.job.producedM + meters } : null,
    beam: t.beam ? { ...t.beam, remainingM } : null,
  };
  const beamEmpty = t.beam !== null && remainingM <= 0;
  if (!beamEmpty && r.next() >= dtMs / 1000 / MEAN_RUN_SEC) return next;
  const reason = beamEmpty ? "LEVENT_BAGLAMA" : r.weighted(SUDDEN_STOP_WEIGHTS);
  const open = openStopOf(reason, now, t.hall, null);
  return {
    ...next,
    rpm: 0,
    openStop: open,
    events: withEvents(next, { at: now, kind: "STOP", reasonCode: reason }, { at: open.notifiedAt, kind: "NOTIFY", person: open.attendant }),
  };
}

function closeStop(r: Random, t: LiveLoom, open: OpenStop, now: number): LiveLoom {
  const beam = open.reasonCode === "LEVENT_BAGLAMA" && t.beam ? { ...t.beam, no: `${t.beam.no}+`, remainingM: t.beam.totalM } : t.beam;
  return {
    ...t,
    openStop: null,
    rpm: Math.round(t.targetRpm * r.range(0.9, 1)),
    stops: [...t.stops, { reasonCode: open.reasonCode, startedAt: open.startedAt, endedAt: now }],
    events: withEvents(t, { at: now, kind: "RUN" }),
    beam,
  };
}

function advanceStopped(r: Random, t: LiveLoom, now: number, dtMs: number): LiveLoom {
  const reason = reasonOf(t.openStop!.reasonCode);
  const unscheduled = reason.lossClass === "NON_SCHEDULED";
  let open: OpenStop = t.openStop!;
  const added: LoomEvent[] = [];
  if (open.respondedAt === null && !unscheduled && r.next() < dtMs / 1000 / MEAN_RESPONSE_SEC) {
    open = { ...open, respondedAt: now };
    added.push({ at: now, kind: "RESPOND", person: open.attendant });
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
    shift: { ...t.shift, plannedSec: t.shift.plannedSec + plannedDelta },
    today: { ...t.today, plannedSec: t.today.plannedSec + plannedDelta },
    events: added.length ? withEvents(t, ...added) : t.events,
  };
  const meanFixSec = (reason.targetMin ?? 240) * 60 * 0.7;
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
