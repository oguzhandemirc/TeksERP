// =============================================================================
// MOCK SALON ÜRETİCİ — tohumdan deterministik başlangıç durumu
// =============================================================================
import { factoryDayStart, formatFactory } from "@/lib/factory-time";
import { escalationDueAt, shouldEscalate } from "../metrics";
import { ESCALATION_SETTINGS, reasonOf } from "../stopReasons";
import type { FloorState, LiveLoom, LoomEvent, OpenStop, Shift, StopRecord } from "../types";
import { ATTENDANTS, FABRICS, HALLS, OPENING_SCENARIOS, OWNER, SUDDEN_STOP_WEIGHTS } from "./catalog";
import { createRandom, type Random } from "./random";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const SHIFT_HOURS = 8;
/** Hedef metre için beklenen ortalama verim (mock profil ayarı). */
const TARGET_EFFICIENCY = 0.85;
/** Görevli bildiriminin duruştan sonra düştüğü gecikme (mock). */
const NOTIFY_DELAY_MS = 5_000;

/** Fabrika gününü 00–08 / 08–16 / 16–24 diye üçe böler (mock; gerçekte `ShiftDefinition`). */
export function shiftOf(now: number): Shift {
  const day = factoryDayStart(now).getTime();
  const slot = Math.min(2, Math.max(0, Math.floor((now - day) / (SHIFT_HOURS * HOUR))));
  const startsAt = day + slot * SHIFT_HOURS * HOUR;
  const name = ["3. vardiya", "1. vardiya", "2. vardiya"][slot]!;
  return { name, startsAt, endsAt: startsAt + SHIFT_HOURS * HOUR };
}

export const metersOf = (picks: number, picksPerCm: number): number => picks / (picksPerCm * 100);

/** Önizleme sözlüğünden ad + sınıf (gerçekte sunucu verir). */
export function reasonFields(reasonCode: string): { reasonCode: string; label: string; lossClass: StopRecord["lossClass"] } {
  const r = reasonOf(reasonCode);
  return { reasonCode, label: r.label, lossClass: r.lossClass };
}

/** Kapanmış geçmiş duruşlar — vardiya başı ile `limit` arasında, sırayla. */
function pastStops(r: Random, from: number, limit: number): StopRecord[] {
  const out: StopRecord[] = [];
  let t = from + r.range(5, 25) * MINUTE;
  const count = r.int(0, 5);
  for (let i = 0; i < count && t < limit - 3 * MINUTE; i += 1) {
    const reasonCode = r.weighted(SUDDEN_STOP_WEIGHTS);
    const target = reasonOf(reasonCode).targetMin ?? 10;
    const duration = Math.min(r.range(0.4, 1.6) * target * MINUTE, limit - t);
    out.push({ ...reasonFields(reasonCode), startedAt: t, endedAt: t + duration });
    t += duration + r.range(8, 40) * MINUTE;
  }
  return out;
}

function eventsOf(stops: StopRecord[], open: OpenStop | null, hall: string): LoomEvent[] {
  const attendant = ATTENDANTS[hall]!;
  const events: LoomEvent[] = [];
  for (const d of stops) {
    events.push({ at: d.startedAt, kind: "STOP", reasonCode: d.reasonCode, label: d.label, lossClass: d.lossClass });
    events.push({ at: d.startedAt + NOTIFY_DELAY_MS, kind: "NOTIFY", person: attendant });
    events.push({ at: d.startedAt + (d.endedAt - d.startedAt) * 0.3, kind: "RESPOND", person: attendant });
    events.push({ at: d.endedAt, kind: "RUN" });
  }
  if (open) events.push(...openStopEvents(open));
  return events.sort((a, b) => b.at - a.at).slice(0, 20);
}

export function openStopEvents(a: OpenStop): LoomEvent[] {
  const list: LoomEvent[] = [
    { at: a.startedAt, kind: "STOP", reasonCode: a.reasonCode, label: a.label, lossClass: a.lossClass },
    { at: a.notifiedAt!, kind: "NOTIFY", person: a.attendant! },
  ];
  if (a.respondedAt !== null) list.push({ at: a.respondedAt, kind: "RESPOND", person: a.attendant! });
  if (a.escalatedAt !== null) list.push({ at: a.escalatedAt, kind: "ESCALATE", person: OWNER });
  return list;
}

export function openStopOf(reasonCode: string, startedAt: number, hall: string, respondedAt: number | null): OpenStop {
  return {
    ...reasonFields(reasonCode),
    startedAt,
    targetMin: reasonOf(reasonCode).targetMin,
    graceMin: ESCALATION_SETTINGS.graceMin,
    attendant: ATTENDANTS[hall]!,
    notifiedAt: startedAt + NOTIFY_DELAY_MS,
    respondedAt,
    escalatedAt: null,
  };
}

/** Hedef + pay dolduysa patrona iletim damgası, iletimin olması gereken ana yazılır. */
export function stampEscalation(a: OpenStop, now: number): OpenStop {
  if (!shouldEscalate(a, now)) return a;
  return { ...a, escalatedAt: escalationDueAt(a) };
}

interface LoomSeed {
  seq: number;
  hall: (typeof HALLS)[number];
  shift: Shift;
  now: number;
}

function createLoom(r: Random, seed: LoomSeed, open: OpenStop | null): LiveLoom {
  const { hall, shift, now } = seed;
  const targetRpm = hall.loomType === "RAPIER" ? r.int(38, 48) * 10 : r.int(65, 85) * 10;
  const picksPerCm = r.int(18, 32);
  const limit = open ? Math.max(shift.startsAt, open.startedAt) : now;
  const stops = pastStops(r, shift.startsAt, limit);
  const elapsedSec = Math.max(0, (now - shift.startsAt) / 1000);
  const openSec = open ? (now - limit) / 1000 : 0;
  const stopSec = stops.reduce((a, d) => a + (d.endedAt - d.startedAt) / 1000, 0) + openSec;
  const unscheduledSec = open && open.lossClass === "NON_SCHEDULED" ? openSec : 0;
  const runSec = Math.max(0, elapsedSec - stopSec);
  const picks = (runSec / 60) * targetRpm * r.range(0.86, 0.99);
  const meters = metersOf(picks, picksPerCm);
  const fabric = r.pick(FABRICS);
  const plannedM = r.int(8, 30) * 100;
  const totalM = r.int(30, 50) * 100;
  const code = String(seed.seq).padStart(2, "0");
  // Günün önceki vardiyaları (mock): her hol kendi ortalamasında (%91/%83/%75 ± 6) çalışmış sayılır.
  const earlierSec = Math.max(0, (shift.startsAt - factoryDayStart(now).getTime()) / 1000);
  const hallMean = 0.91 - HALLS.indexOf(hall) * 0.08;
  const earlierRunSec = earlierSec * Math.min(1, r.range(hallMean - 0.06, hallMean + 0.06));
  const plannedSec = Math.max(0, elapsedSec - unscheduledSec);
  return {
    id: `tz-${code}`,
    code,
    hall: hall.name,
    monitored: true,
    stateSource: "simule",
    loomType: hall.loomType,
    targetRpm,
    rpm: open ? 0 : Math.round(targetRpm * r.range(0.9, 1)),
    picksPerCm,
    openStop: open,
    shift: {
      picks,
      meters,
      targetMeters: metersOf(SHIFT_HOURS * 60 * targetRpm * TARGET_EFFICIENCY, picksPerCm),
      runSec,
      plannedSec,
    },
    today: { runSec: earlierRunSec + runSec, plannedSec: earlierSec + plannedSec },
    stops,
    dayBreakdown: null,
    events: eventsOf(stops, open, hall.name),
    job: {
      no: `DK${formatFactory(now, "ddMMyy")}${String(1000 + seed.seq * 7).slice(-4)}`,
      fabric: fabric.name,
      color: fabric.color,
      plannedM,
      producedM: Math.min(plannedM, r.range(0.1, 0.9) * plannedM + meters),
    },
    // 9 numaralı tezgahın leventi bitmek üzere — "levent az" uyarısı açılışta görünsün.
    beams: [{ no: `LV-${String(200 + seed.seq)}`, slot: 1, warpSpec: null, totalM, remainingM: Math.round(totalM * (seed.seq === 9 ? 0.04 : r.range(0.12, 0.92))) }],
    source: "SIMULATED",
  };
}

/** Açılış senaryolarını tezgahlara deterministik dağıtır: sıra no → senaryo. */
function assignScenarios(r: Random, total: number): Map<number, (typeof OPENING_SCENARIOS)[number]> {
  const seqs = Array.from({ length: total }, (_, i) => i + 1);
  for (let i = seqs.length - 1; i > 0; i -= 1) {
    const j = Math.floor(r.next() * (i + 1));
    [seqs[i], seqs[j]] = [seqs[j]!, seqs[i]!];
  }
  return new Map(OPENING_SCENARIOS.map((s, i) => [seqs[i]!, s]));
}

export function createFloor(seed: number, now: number): FloorState {
  const r = createRandom(seed);
  const shift = shiftOf(now);
  const total = HALLS.reduce((a, h) => a + h.count, 0);
  const scenarios = assignScenarios(r, total);
  const looms: LiveLoom[] = [];
  let seq = 0;
  for (const hall of HALLS) {
    for (let i = 0; i < hall.count; i += 1) {
      seq += 1;
      const s = scenarios.get(seq);
      const startedAt = s ? now - s.ageMin * MINUTE : 0;
      const open = s
        ? stampEscalation(openStopOf(s.reason, startedAt, hall.name, s.respondMin === null ? null : startedAt + s.respondMin * MINUTE), now)
        : null;
      looms.push(createLoom(r, { seq, hall, shift, now }, open));
    }
  }
  return { shift, halls: HALLS.map((h) => h.name), looms, updatedAt: now, rng: r.state() };
}
