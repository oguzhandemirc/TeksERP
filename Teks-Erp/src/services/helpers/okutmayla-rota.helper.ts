// =============================================================================
// TeksERP — OKUTMAYLA (esnek) ROTA: okutulan istasyona göre adım çözümü — TEK KAYNAK (K29, 2026-11-03)
// =============================================================================
// Ayar `production.routeMode = SCAN` iken tablet/istasyon belge okutması (kart barkodu) hangi istasyonda
// yapılırsa iş orada devam eder. Bu dosya iki parçadır:
//   • `planScanRoute` — SAF karar (bekçi doğrudan sınar): var olan adımı aç · ileri adıma taşı (öndekiler ATLANDI)
//     · adım EKLE (sahada eklendi) · ENGEL (açık iş başka istasyonda / atlanamaz / renk veren adım) · null (bugünkü yol).
//   • `loadScanRouteFacts` — kararın girdisini DB'den okur (tx içinde TAZE okunur; önizleme tx dışında).
// Kurşun/KK (`station-step-resolve`) ve Tambur (`tambur.service`) kart çözümü ile `/api/scan-route` uçları
// YALNIZ buradan geçer. Manuel taşıma (`workorder-manual-move`) AYRI semantiktir: o kaynak hareketi kapatır ve
// renk sentezler; okutma yolu hareketi GERİ ALIR (istasyondan geçmiş sayılmaz) ve renk sentezlemez.
// =============================================================================
import { sequentialTx } from "./tx-sequential-relations.helper";
import { Prisma, RollStatus, StepStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { ACTIVE_OPERATION } from "./roll-operation.helper";
import { ACTIVE_MOVEMENT } from "./roll-movement.helper";
import { stepCanApplyColor } from "./step-capability.helper";
import {
  readProductionRouteMode,
  readProductionScanRouteStations,
} from "../system-setting.service";

type Db = Pick<Prisma.TransactionClient, "workOrder" | "workOrderStep" | "roll" | "rollOperation" | "rollMeterReading" | "kursunBypassAssignment" | "station" | "systemSetting">;

/** Adımın okutma kararına giren gerçekleri (bellek). */
export interface ScanRouteStepFact {
  id: string;
  stepSequence: number;
  stationId: string;
  stationName: string;
  status: StepStatus;
  /** Şu an bu adımda duran (IN_PRODUCTION) top sayısı. */
  rollCount: number;
  /** Bu adımdaki toplardan birinde iş başladı (aktif operasyon / metre okuması), fasonda mal dışarıda ya da kurşun dağıtımı açık. */
  startedWork: boolean;
  /** Adımın geçmişi var (kapanmış aktif hareket) — böyle adım ATLANDI yapılmaz. */
  hasHistory: boolean;
  notSkippable: boolean;
  appliesColor: boolean;
  /** Açık kurşun dağıtımı (bypass) — "yapıldı ama izsiz"; okutma yolu ona dokunmaz (bugünkü yol). */
  bypassOpen: boolean;
}

export interface ScanRouteFacts {
  workOrderId: string;
  steps: ScanRouteStepFact[];
  /** Adımsız (rotasız) İE'de partide bekleyen, henüz hiçbir adıma girmemiş top sayısı. */
  entryPendingCount: number;
}

export type ScanRouteBlockCode = "SCAN_ROUTE_OPEN_ELSEWHERE" | "SCAN_ROUTE_MANDATORY_STEP" | "SCAN_ROUTE_COLOR_STEP";

export type ScanRoutePlan =
  | { kind: "OPEN_EXISTING"; targetStepId: string }
  | { kind: "MOVE"; targetStepId: string; skipStepIds: string[]; fromStepIds: string[]; warnings: string[] }
  | { kind: "INSERT"; insertSeq: number; skipStepIds: string[]; fromStepIds: string[]; warnings: string[]; rework: boolean }
  | { kind: "BLOCKED"; code: ScanRouteBlockCode; stepId: string; stationName: string; rollCount: number; message: string };

export const SCAN_ROUTE_REWORK_WARNING = "Bu istasyon daha önce atlanmıştı — yeniden işlem olarak eklendi.";

const LIVE: StepStatus[] = [StepStatus.PENDING, StepStatus.ACTIVE];

/**
 * SAF karar. `null` = okutma yolu bu durumda söz sahibi değil → çağıran BUGÜNKÜ çözümü koşar
 * (toplar zaten burada / hiç top yok / tamamlanmış adımın yeniden açılması / kurşun dağıtımı).
 */
export function planScanRoute(facts: ScanRouteFacts, station: { id: string; name: string }): ScanRoutePlan | null {
  const steps = [...facts.steps].sort((a, b) => a.stepSequence - b.stepSequence);
  const here = steps.filter((s) => s.stationId === station.id);
  const withRolls = here.find((s) => s.rollCount > 0);
  if (withRolls) return { kind: "OPEN_EXISTING", targetStepId: withRolls.id };

  const sources = steps.filter((s) => s.rollCount > 0);
  if (sources.length === 0 && facts.entryPendingCount === 0) return null;
  if (sources.some((s) => s.bypassOpen)) return null;

  // Bu istasyonun hâlâ yapılmamış (geçmişsiz, başlamamış) adımı varsa oraya taşınır; yoksa ve son adımı
  // TAMAMLANMIŞSA bugünkü yeniden açma yolu (null); yoksa adım eklenir.
  const open = here.find((s) => LIVE.includes(s.status) && !s.hasHistory);
  const last = here[here.length - 1];
  if (!open && last && last.status === StepStatus.COMPLETED) return null;

  const busy = sources.find((s) => s.startedWork);
  if (busy) {
    return {
      kind: "BLOCKED",
      code: "SCAN_ROUTE_OPEN_ELSEWHERE",
      stepId: busy.id,
      stationName: busy.stationName,
      rollCount: busy.rollCount,
      message: `"${busy.stationName}" adımında iş sürüyor (${busy.rollCount} top). Önce o adımı bitirin ya da bitmiş sayıp geçin.`,
    };
  }

  // Ekleme yeri: işi yapılmış (tamamlanmış/atlanmış/geçmişli) ya da topların durduğu (aktif) son adımın arkası;
  // topların durduğu başlamamış adım öndeki bekleyen sayılır → ATLANDI.
  const anchorSeq = steps
    .filter((s) => s.status === StepStatus.COMPLETED || s.status === StepStatus.SKIPPED || s.hasHistory || s.rollCount > 0)
    .reduce((m, s) => Math.max(m, s.stepSequence), 0);
  const targetSeq = open ? open.stepSequence : anchorSeq + 1;
  const skip = steps.filter((s) => s.stepSequence < targetSeq && LIVE.includes(s.status) && !s.hasHistory && !s.startedWork && s.id !== open?.id);

  const mandatory = skip.find((s) => s.notSkippable);
  if (mandatory) {
    return {
      kind: "BLOCKED",
      code: "SCAN_ROUTE_MANDATORY_STEP",
      stepId: mandatory.id,
      stationName: mandatory.stationName,
      rollCount: mandatory.rollCount,
      message: `"${mandatory.stationName}" adımı atlanamaz. Kumaşı önce "${mandatory.stationName}" istasyonunda okutun.`,
    };
  }
  const color = skip.find((s) => s.appliesColor);
  if (color) {
    return {
      kind: "BLOCKED",
      code: "SCAN_ROUTE_COLOR_STEP",
      stepId: color.id,
      stationName: color.stationName,
      rollCount: color.rollCount,
      message: `"${color.stationName}" renk veren adımdır, okutmayla atlanamaz. Konumu panelden düzeltin.`,
    };
  }

  const fromStepIds = sources.map((s) => s.id);
  const skipStepIds = skip.map((s) => s.id);
  if (open) return { kind: "MOVE", targetStepId: open.id, skipStepIds, fromStepIds, warnings: [] };
  const rework = here.some((s) => s.status === StepStatus.SKIPPED);
  return { kind: "INSERT", insertSeq: targetSeq, skipStepIds, fromStepIds, warnings: rework ? [SCAN_ROUTE_REWORK_WARNING] : [], rework };
}

/**
 * "Bu adımda iş başladı" — adımda AÇIK hareketle duran topun bu adımda AKTİF operasyonu ya da aktif metre okuması var.
 * TEK tanım (Prisma parçası); bellek yüklemi `ScanRouteStepFact.startedWork` buradan doldurulur.
 */
export function startedWorkRollWhere(stepId: string): Prisma.RollWhereInput {
  return {
    currentStepId: stepId,
    status: RollStatus.IN_PRODUCTION,
    // Hareketi kapanmış (adım bitirilmiş, sonraki okutmayı bekleyen) top "iş sürüyor" sayılmaz.
    movements: { some: { ...ACTIVE_MOVEMENT, workOrderStepId: stepId, exitedAt: null } },
    OR: [
      { operations: { some: { ...ACTIVE_OPERATION, workOrderStepId: stepId } } },
      { meterReadings: { some: { revokedAt: null, workOrderStepId: stepId } } },
    ],
  };
}

/** Okutma kararının girdisi; tx içinde çağrılırsa TAZE (WO kilidinden sonra). */
export async function loadScanRouteFacts(db: Db, workOrderId: string): Promise<ScanRouteFacts> {
  const steps = await sequentialTx(db).workOrderStep.findMany({
    where: { workOrderId },
    orderBy: { stepSequence: "asc" },
    select: {
      id: true, stepSequence: true, stationId: true, status: true,
      station: { select: { name: true, type: true, appliesColor: true, scanNotSkippable: true } },
      requiredCategory: { select: { appliesColor: true } },
    },
  });
  const facts: ScanRouteStepFact[] = [];
  for (const s of steps) {
    // Sıralı await (tx içinde paralel sorgu yasak).
    const inProd = await db.roll.count({ where: { currentStepId: s.id, status: RollStatus.IN_PRODUCTION } });
    const away = await db.roll.count({ where: { currentStepId: s.id, status: { in: [RollStatus.AT_SUBCONTRACTOR, RollStatus.RETURNED_FROM_SUBCONTRACTOR] } } });
    const worked = inProd > 0 ? await db.roll.count({ where: startedWorkRollWhere(s.id) }) : 0;
    const history = await db.workOrderStep.count({ where: { id: s.id, movements: { some: { ...ACTIVE_MOVEMENT, exitedAt: { not: null } } } } });
    const bypass = await db.kursunBypassAssignment.count({ where: { workOrderStepId: s.id, completedAt: null, cancelledAt: null } });
    facts.push({
      id: s.id,
      stepSequence: s.stepSequence,
      stationId: s.stationId,
      stationName: s.station.name,
      status: s.status,
      rollCount: inProd + away,
      startedWork: worked > 0 || away > 0,
      hasHistory: history > 0,
      notSkippable: s.station.scanNotSkippable,
      appliesColor: stepCanApplyColor(s.station, s.requiredCategory),
      bypassOpen: bypass > 0,
    });
  }
  const entryPendingCount = await db.roll.count({ where: entryPendingRollWhere(workOrderId) });
  return { workOrderId, steps: facts, entryPendingCount };
}

/** Rotasız İE'de partide bekleyen, hiçbir adıma girmemiş top (adımsız bağlama — `scanRouted`). */
export function entryPendingRollWhere(workOrderId: string): Prisma.RollWhereInput {
  return { batch: { workOrderId }, currentStepId: null, status: RollStatus.IN_PRODUCTION };
}

/**
 * Okutmayla rota bu istasyonda etkin mi: ayar SCAN ∧ (kapsam ALL ∨ istasyonda "Okutunca adım eklenebilir").
 * SEQUENTIAL'da (varsayılan) her zaman false → çağıranların hepsi bugünkü yolda kalır.
 */
export async function scanRouteEnabledFor(stationId: string | null, db: Pick<Db, "station" | "systemSetting"> = prisma): Promise<boolean> {
  if (!stationId) return false;
  if ((await readProductionRouteMode(db)) !== "SCAN") return false;
  if ((await readProductionScanRouteStations(db)) === "ALL") return true;
  const st = await db.station.findUnique({ where: { id: stationId }, select: { scanAddAllowed: true } });
  return st?.scanAddAllowed === true;
}
