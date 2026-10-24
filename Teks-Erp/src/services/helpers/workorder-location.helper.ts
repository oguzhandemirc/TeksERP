// =============================================================================
// TERBİYE İŞ EMRİ "ŞU AN NEREDE" — MALIN DAĞILIMI (TEK KAYNAK, 2026-10-24)
// =============================================================================
// Cevap TOPTAN okunur: canlı topun durduğu adım (`Roll.currentStepId → step.station`)
// = topun şu an bulunduğu istasyon. Birden çok partili iş emrinde adım statüleri
// (ACTIVE/PENDING) aynı anda birçok adımda açık kalır; tek "aktif adım" malın
// nerede olduğunu söylemez. `work-order-current-step.helper` PLAN imlecidir (tek
// istasyon: üretim zinciri raporu + bulut `aktifIstasyonId`); bu dosya FİZİKSEL
// dağılımdır. İkisi ayrı sorudur — birini ötekinin yerine kullanma.
//
// Canlı top = `currentStepId` dolu VE statü IN_PRODUCTION | AT_SUBCONTRACTOR.
// Depoya inen top adımdan düşer (currentStepId NULL), ölü statüler
// (`K18_DEAD_STATUSES`, SCRAP, SHIPPED) burada hiç yoktur.
//
// BOĞAZ İKİZİ: bellek-içi sınıflama `classifyWorkOrderLocation` ↔ Prisma süzgeci
// `workOrderLocationClassWhere` (+ ≥2 istasyon için `$queryRaw` id kümesi). Biri
// değişirse öteki de; bekçi `test_workorder_location.ts` her fikstür iş emri için
// "özetteki sınıf == süzgecin döndürdüğü sınıf" eşitliğini ölçer.
// =============================================================================
import { Prisma, RollStatus, StationKind, StationType, WorkOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { readFilterList } from "../../utils/query-parser";
import { OPEN_OUTSTANDING } from "./fason-open-dispatch.helper";

export const WORK_ORDER_LOCATION_CLASSES = [
  "BASLAMADI",
  "TEK_ISTASYON",
  "BOLUNMUS",
  "FASONDA",
  "BITTI",
] as const;
export type WorkOrderLocationClass = (typeof WORK_ORDER_LOCATION_CLASSES)[number];

/** Konumu sayılan top statüleri — liste dışı bırakılan her statü "istasyonda değil" demektir. */
export const LOCATION_LIVE_STATUSES: readonly RollStatus[] = [
  RollStatus.IN_PRODUCTION,
  RollStatus.AT_SUBCONTRACTOR,
];

/** Prisma ikizi: adımın `currentRolls` ilişkisinde "canlı" top. */
export const LOCATION_LIVE_ROLL = {
  status: { in: [...LOCATION_LIVE_STATUSES] },
} satisfies Prisma.RollWhereInput;

/** Bellek ikizi — `LOCATION_LIVE_ROLL` ile aynı küme (currentStepId dolu varsayılır). */
export function isLocationLiveStatus(status: RollStatus): boolean {
  return LOCATION_LIVE_STATUSES.includes(status);
}

export interface WorkOrderLocationStation {
  istasyonId: string;
  ad: string;
  /** `StationKind` — panel istasyon rengini buradan çözer (`toneFor`). */
  tur: StationKind;
  /** EXTERNAL (fason) istasyon mu. */
  dis: boolean;
  topSayisi: number;
  metre: number;
  /** Bu istasyondaki toplardan FASONCUDA olanlar (kalanı fabrikada sevk bekliyor). */
  fasondaTop: number;
  /** Açık + teslim bekleyen sevkin fasoncuları (yalnız `fasondaTop > 0` iken dolu). */
  fasoncular: string[];
}

export interface WorkOrderLocation {
  sinif: WorkOrderLocationClass;
  canliTop: number;
  /** Top sayısı çoktan aza; eşitlikte metre, sonra ad. */
  istasyonlar: WorkOrderLocationStation[];
}

/** Sınıflamanın bellek tarafı — süzgecin (`workOrderLocationClassWhere`) aynası. */
export function classifyWorkOrderLocation(
  woStatus: WorkOrderStatus,
  groups: ReadonlyArray<{ stationId: string; status: RollStatus; count: number }>,
): WorkOrderLocationClass {
  const live = groups.filter((g) => g.count > 0 && isLocationLiveStatus(g.status));
  if (live.length === 0) return woStatus === WorkOrderStatus.PLANNED ? "BASLAMADI" : "BITTI";
  if (live.every((g) => g.status === RollStatus.AT_SUBCONTRACTOR)) return "FASONDA";
  return new Set(live.map((g) => g.stationId)).size >= 2 ? "BOLUNMUS" : "TEK_ISTASYON";
}

const HAS_LIVE: Prisma.WorkOrderWhereInput = {
  steps: { some: { currentRolls: { some: LOCATION_LIVE_ROLL } } },
};
const HAS_INHOUSE_LIVE: Prisma.WorkOrderWhereInput = {
  steps: { some: { currentRolls: { some: { status: RollStatus.IN_PRODUCTION } } } },
};

/**
 * Canlı topları ≥2 FARKLI istasyona dağılmış iş emirleri (bellek tarafındaki
 * `Set(stationId).size >= 2`nin SQL ikizi). Fabrika genelinde canlı top kümesi
 * küçüktür (üretimdeki mal); sorgu `currentStepId` dolu satırları gruplar.
 */
export async function findSplitWorkOrderIds(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ workOrderId: string }>>`
    SELECT s."workOrderId"
    FROM rolls r
    JOIN work_order_steps s ON s.id = r."currentStepId"
    WHERE r."currentStepId" IS NOT NULL
      AND r.status::text IN (${Prisma.join(LOCATION_LIVE_STATUSES.map((s) => s as string))})
    GROUP BY s."workOrderId"
    HAVING COUNT(DISTINCT s."stationId") >= 2`;
  return rows.map((r) => r.workOrderId);
}

/** Tek sınıfın Prisma süzgeci; `splitIds` yalnız BOLUNMUS/TEK_ISTASYON için okunur. */
export function workOrderLocationClassWhere(
  cls: WorkOrderLocationClass,
  splitIds: readonly string[],
): Prisma.WorkOrderWhereInput {
  switch (cls) {
    case "BASLAMADI":
      return { status: WorkOrderStatus.PLANNED, NOT: HAS_LIVE };
    case "BITTI":
      return { status: { not: WorkOrderStatus.PLANNED }, NOT: HAS_LIVE };
    case "FASONDA":
      return { AND: [HAS_LIVE, { NOT: HAS_INHOUSE_LIVE }] };
    case "BOLUNMUS":
      // Boş küme → hiçbir satır; `in: []` Prisma'da "eşleşme yok" demektir (notIn: [] değil).
      return { AND: [HAS_INHOUSE_LIVE, { id: { in: [...splitIds] } }] };
    case "TEK_ISTASYON":
      return splitIds.length > 0
        ? { AND: [HAS_INHOUSE_LIVE, { id: { notIn: [...splitIds] } }] }
        : HAS_INHOUSE_LIVE;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Liste süzgeçleri `filter[konumIstasyon]` (istasyon id CSV — "en az bir canlı topu
 * bu istasyonda") ve `filter[konumSinifi]` (sınıf CSV). Tanınmayan değer 400
 * (fail-closed). Anahtarlar `filters`ten SİLİNİR: bu serviste `buildWhereClause`
 * tanımadığı her anahtarı Prisma'ya kopyalar ("Unknown argument" 500).
 */
export async function readWorkOrderLocationFilters(
  filters: Record<string, string | string[]>,
): Promise<Prisma.WorkOrderWhereInput[]> {
  const stationIds = readFilterList(filters.konumIstasyon);
  const classes = readFilterList(filters.konumSinifi);
  delete filters.konumIstasyon;
  delete filters.konumSinifi;

  const out: Prisma.WorkOrderWhereInput[] = [];
  if (stationIds.length > 0) {
    const bad = stationIds.find((id) => !UUID_RE.test(id));
    if (bad) {
      throw AppError.badRequest(`Geçersiz istasyon kimliği: "${bad}"`, {
        code: "INVALID_FILTER_VALUE",
        field: "konumIstasyon",
      });
    }
    out.push({
      steps: { some: { stationId: { in: stationIds }, currentRolls: { some: LOCATION_LIVE_ROLL } } },
    });
  }
  if (classes.length > 0) {
    const known = new Set<string>(WORK_ORDER_LOCATION_CLASSES);
    const bad = classes.find((c) => !known.has(c));
    if (bad) {
      throw AppError.badRequest(
        `Tanınmayan konum sınıfı: "${bad}" (geçerli: ${WORK_ORDER_LOCATION_CLASSES.join(", ")})`,
        { code: "INVALID_FILTER_VALUE", field: "konumSinifi" },
      );
    }
    const picked = classes as WorkOrderLocationClass[];
    const needsSplit = picked.some((c) => c === "BOLUNMUS" || c === "TEK_ISTASYON");
    const splitIds = needsSplit ? await findSplitWorkOrderIds() : [];
    const parts = picked.map((c) => workOrderLocationClassWhere(c, splitIds));
    out.push(parts.length === 1 ? parts[0] : { OR: parts });
  }
  return out;
}

type LocStep = {
  id: string;
  station?: { id: string; name: string; type: StationType; kind: StationKind } | null;
};

/**
 * Sayfadaki iş emirlerine konum özetini ekler — sayfa başına 1 gruplu top
 * sorgusu (+ fasonda top varsa 1 sevk sorgusu); N+1 yok.
 */
export async function loadWorkOrderLocations(
  wos: ReadonlyArray<{ id: string; status: WorkOrderStatus; steps: ReadonlyArray<LocStep> }>,
): Promise<Map<string, WorkOrderLocation>> {
  const stepInfo = new Map<string, { woId: string; station: NonNullable<LocStep["station"]> }>();
  for (const w of wos) {
    for (const st of w.steps) if (st.station) stepInfo.set(st.id, { woId: w.id, station: st.station });
  }
  const stepIds = [...stepInfo.keys()];
  const grouped = stepIds.length
    ? await prisma.roll.groupBy({
        by: ["currentStepId", "status"],
        where: { currentStepId: { in: stepIds }, ...LOCATION_LIVE_ROLL },
        _count: { _all: true },
        _sum: { currentQty: true },
      })
    : [];

  // Fasoncu adı: açık + teslim bekleyen sevkin firması, adım bazında.
  const firmsByStep = new Map<string, Set<string>>();
  if (grouped.some((g) => g.status === RollStatus.AT_SUBCONTRACTOR)) {
    const dispatches = await prisma.subcontractorDispatch.findMany({
      where: { workOrderId: { in: wos.map((w) => w.id) }, ...OPEN_OUTSTANDING },
      select: { stepId: true, subcontractor: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    });
    for (const d of dispatches) {
      if (!d.stepId || !d.subcontractor?.name) continue;
      const set = firmsByStep.get(d.stepId) ?? new Set<string>();
      set.add(d.subcontractor.name);
      firmsByStep.set(d.stepId, set);
    }
  }

  const perWo = new Map<string, Map<string, WorkOrderLocationStation>>();
  const groupsByWo = new Map<string, Array<{ stationId: string; status: RollStatus; count: number }>>();
  for (const g of grouped) {
    const info = g.currentStepId ? stepInfo.get(g.currentStepId) : undefined;
    if (!info) continue;
    const count = g._count._all;
    const meters = Number(g._sum.currentQty ?? 0);
    const st = info.station;
    const byStation = perWo.get(info.woId) ?? new Map<string, WorkOrderLocationStation>();
    const entry = byStation.get(st.id) ?? {
      istasyonId: st.id,
      ad: st.name,
      tur: st.kind,
      dis: st.type === StationType.EXTERNAL,
      topSayisi: 0,
      metre: 0,
      fasondaTop: 0,
      fasoncular: [],
    };
    entry.topSayisi += count;
    entry.metre += meters;
    if (g.status === RollStatus.AT_SUBCONTRACTOR) {
      entry.fasondaTop += count;
      for (const f of firmsByStep.get(g.currentStepId as string) ?? []) {
        if (!entry.fasoncular.includes(f)) entry.fasoncular.push(f);
      }
    }
    byStation.set(st.id, entry);
    perWo.set(info.woId, byStation);
    const list = groupsByWo.get(info.woId) ?? [];
    list.push({ stationId: st.id, status: g.status, count });
    groupsByWo.set(info.woId, list);
  }

  const out = new Map<string, WorkOrderLocation>();
  for (const w of wos) {
    const istasyonlar = [...(perWo.get(w.id)?.values() ?? [])]
      .map((e) => ({ ...e, metre: Math.round(e.metre * 10) / 10 }))
      .sort((a, b) => b.topSayisi - a.topSayisi || b.metre - a.metre || a.ad.localeCompare(b.ad, "tr"));
    out.set(w.id, {
      sinif: classifyWorkOrderLocation(w.status, groupsByWo.get(w.id) ?? []),
      canliTop: istasyonlar.reduce((s, e) => s + e.topSayisi, 0),
      istasyonlar,
    });
  }
  return out;
}

/** Liste satırlarına `konum` alanını ekler (ek alan — eski istemci görmezden gelir). */
export async function withWorkOrderLocation<
  T extends { id: string; status: WorkOrderStatus; steps: ReadonlyArray<LocStep> },
>(wos: T[]): Promise<Array<T & { konum: WorkOrderLocation }>> {
  const map = await loadWorkOrderLocations(wos);
  return wos.map((w) => ({ ...w, konum: map.get(w.id) as WorkOrderLocation }));
}
