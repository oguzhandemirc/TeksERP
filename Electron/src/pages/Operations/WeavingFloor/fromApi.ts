// =============================================================================
// TEL → EKRAN — `GET /api/loom-floor` cevabını `FloorState`e çevirir (saf, birim testli)
// =============================================================================
// Ölçülmeyen alan UYDURULMAZ: sayaç (atkı/metre), devir ve uyarı zinciri kişisi bugün
// yok → `null`; ekran "—" basar ya da bloğu çizmez. Levent yalnız sunucu ölçüyorsa dolar.
// =============================================================================
import type { LoomFloorDto, WireLoom, WireLossClass } from "./service";
import type { FloorState, LiveLoom, LoomEvent, LossClass, OpenStop, StopRecord, StopTotal } from "./types";

const UNCLASSIFIED_LABEL = "Sebep bekleniyor";
const FALLBACK_FABRIC_COLOR = "#999999";
const MAX_EVENTS = 20;

/** MINOR süre sınıfıdır, sebep sınıfı değil — ekranda plansız kayıp gibi çizilir. */
function lossClassOf(c: WireLossClass | null): LossClass | null {
  if (c === null) return null;
  return c === "MINOR" ? "UNPLANNED" : c;
}

const ms = (iso: string): number => Date.parse(iso);

/** Gün kırılımı aynı sebebi levent ayrımıyla iki satıra bölebilir — sebep başına birleştirilir. */
function dayBreakdownOf(l: WireLoom): StopTotal[] {
  const byCode = new Map<string, StopTotal>();
  for (const r of l.today.breakdown) {
    const key = r.reasonCode ?? "";
    const prev = byCode.get(key);
    byCode.set(key, {
      reasonCode: r.reasonCode,
      label: prev?.label ?? r.reasonLabel ?? r.reasonCode ?? UNCLASSIFIED_LABEL,
      lossClass: prev?.lossClass ?? lossClassOf(r.lossClass),
      count: (prev?.count ?? 0) + r.stopCount,
      ms: (prev?.ms ?? 0) + r.stopSec * 1000,
    });
  }
  return [...byCode.values()];
}

function labelOf(code: string | null, labels: ReadonlyMap<string, string>, fallback: string | null = null): string {
  if (code === null) return UNCLASSIFIED_LABEL;
  return fallback ?? labels.get(code) ?? code;
}

function openStopOf(l: WireLoom, labels: ReadonlyMap<string, string>): OpenStop | null {
  const s = l.openStop;
  // İzlenmeyen tezgahın durumu bilinmez — açık duruş da sayılara girmez (sunucu `countFloor`).
  if (!s || l.state === "UNMONITORED") return null;
  return {
    reasonCode: s.reasonCode,
    label: labelOf(s.reasonCode, labels, s.reasonLabel),
    lossClass: lossClassOf(s.lossClass),
    startedAt: ms(s.startedAt),
    targetMin: s.targetMinutes,
    graceMin: s.graceMinutes,
    attendant: null,
    notifiedAt: null,
    respondedAt: null,
    escalatedAt: null,
  };
}

function stopsAndEvents(l: WireLoom, labels: ReadonlyMap<string, string>): { stops: StopRecord[]; events: LoomEvent[] } {
  const stops: StopRecord[] = [];
  const events: LoomEvent[] = [];
  for (const s of l.recentStops) {
    const base = { reasonCode: s.reasonCode, label: labelOf(s.reasonCode, labels), lossClass: lossClassOf(s.lossClass) };
    events.push({ at: ms(s.startedAt), kind: "STOP", ...base });
    if (s.endedAt !== null) {
      stops.push({ ...base, startedAt: ms(s.startedAt), endedAt: ms(s.endedAt) });
      events.push({ at: ms(s.endedAt), kind: "RUN" });
    }
  }
  events.sort((a, b) => b.at - a.at);
  return { stops, events: events.slice(0, MAX_EVENTS) };
}

function loomOf(l: WireLoom): LiveLoom {
  const dayBreakdown = dayBreakdownOf(l);
  const labels = new Map(dayBreakdown.filter((r) => r.reasonCode !== null).map((r) => [r.reasonCode!, r.label]));
  const { stops, events } = stopsAndEvents(l, labels);
  return {
    id: l.id,
    code: l.code,
    hall: l.hallName,
    monitored: l.state !== "UNMONITORED",
    loomType: null,
    targetRpm: l.targetUnitsPerMin,
    rpm: null,
    picksPerCm: null,
    openStop: openStopOf(l, labels),
    shift: null,
    today: { runSec: l.today.aptSec, plannedSec: l.today.potSec },
    stops,
    dayBreakdown,
    events,
    job: l.job
      ? {
          no: l.job.weavingOrderNumber,
          fabric: [l.job.itemName, l.job.colorName].filter(Boolean).join(" · "),
          color: l.job.colorHex ?? FALLBACK_FABRIC_COLOR,
          plannedM: l.job.plannedM,
          producedM: null,
        }
      : null,
    beams: (l.beams ?? []).map((b) => ({ no: b.beamNo, slot: b.position, warpSpec: b.warpSpecCode, totalM: b.plannedLengthM, remainingM: b.remainingM })),
    source: l.source,
  };
}

export function fromApi(dto: LoomFloorDto): FloorState {
  const looms = dto.looms.map(loomOf);
  const halls = dto.halls.map((h) => h.hallName);
  for (const t of looms) if (!halls.includes(t.hall)) halls.push(t.hall);
  return {
    shift: dto.shift ? { name: dto.shift.name, startsAt: ms(dto.shift.startsAt), endsAt: ms(dto.shift.endsAt) } : null,
    halls,
    looms,
    updatedAt: ms(dto.asOf),
    rng: 0,
  };
}
