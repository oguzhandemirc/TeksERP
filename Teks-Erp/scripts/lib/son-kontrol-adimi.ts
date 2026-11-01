// =============================================================================
// İÇ "SON KONTROL" ADIMI — SY-P4 (TASARIM-2026-10-31 §8.5 md. 4 yol (a), #343 kararı)
// =============================================================================
// Son adımı fason rotada top kalitesiz (NULL) doğar (SY-G2 ölçümü). Çözüm VERİDİR: rotanın
// sonuna kalite veren iç istasyon adımı eklenir; kod/bayrak yok, adımı eklemeyen fabrika
// bayt-aynı. Kaliteyi bugün yalnız Tambur türü yazar (kesim kalitesi → `finalizeRollsAtLastStep`),
// bu yüzden istasyon TAMBUR türünde + muayene açık (`stepCanApplyQuality`) olmalı.
// Açık iş emirleri kendi adım snapshot'ını korur; yeni adım yalnız yeni iş emirlerine girer.
// =============================================================================
import { Prisma, StationKind, StationType } from "@prisma/client";
import prisma from "../../src/lib/prisma";
import { AuditService } from "../../src/services/audit.service";
import { OPEN_WORK_ORDER } from "../../src/services/helpers/live-ref-where.helper";
import { stepCanApplyQuality, stepDecidesDefects } from "../../src/services/helpers/quality-station.helper";
import { resolveRoute, RouteSwitchError, type RouteRef } from "./rota-gecis";

export const DEFAULT_FINAL_CHECK_CODE = "SON_KONTROL";
export const DEFAULT_FINAL_CHECK_NAME = "Son kontrol";

export type FinalCheckAction = "ADD_STEP" | "NOT_NEEDED";

export interface FinalCheckPlan {
  route: RouteRef;
  action: FinalCheckAction;
  /** Var olan istasyon (id dolu) ya da yaratılacak olan (id null). */
  station: { id: string | null; code: string; name: string };
  nextSequence: number;
  openWorkOrders: string[];
}

/** İstasyon kalite verebilir mi: iç + aktif + muayene açık + kesim kalitesini yazan tür (Tambur). */
export function stationGradesRolls(s: {
  type: StationType;
  kind: StationKind;
  isActive: boolean;
  inspectionEnabled: boolean;
}): boolean {
  return s.isActive && s.type === StationType.INTERNAL && stepCanApplyQuality(s) && stepDecidesDefects(s);
}

export async function planFinalCheck(routeRef: string, stationCode = DEFAULT_FINAL_CHECK_CODE): Promise<FinalCheckPlan> {
  const route = await resolveRoute(routeRef);
  if (!route.isActive) throw new RouteSwitchError(`rota pasif: ${routeRef}`);
  if (!route.lastStep) throw new RouteSwitchError(`rotanın adımı yok: ${routeRef}`);
  const existing = await prisma.station.findUnique({
    where: { code: stationCode },
    select: { id: true, code: true, name: true, type: true, kind: true, isActive: true, inspectionEnabled: true },
  });
  if (existing && !stationGradesRolls(existing)) {
    throw new RouteSwitchError(
      `istasyon kalite veremez: ${stationCode} (iç + aktif + Tambur türü + muayene açık olmalı)`,
    );
  }
  const maxSeq = await prisma.routeStep.aggregate({ where: { routeId: route.id }, _max: { sequence: true } });
  const openWos = await prisma.workOrder.findMany({
    where: { ...OPEN_WORK_ORDER, routeTemplateId: route.id },
    orderBy: { workOrderNumber: "asc" },
    select: { workOrderNumber: true },
  });
  return {
    route,
    // Son adım zaten iç ise top orada finalize olur — eklenecek bir şey yok (idempotent).
    action: route.lastStep.external ? "ADD_STEP" : "NOT_NEEDED",
    station: existing
      ? { id: existing.id, code: existing.code, name: existing.name }
      : { id: null, code: stationCode, name: DEFAULT_FINAL_CHECK_NAME },
    nextSequence: (maxSeq._max.sequence ?? 0) + 1,
    openWorkOrders: openWos.map((w) => w.workOrderNumber),
  };
}

/**
 * Yazım tek tx: istasyon (yoksa) + rotanın sonuna adım. Plan bayatsa (başkası adım ekledi /
 * rota değişti) `(routeId, sequence)` tekilliği ya da son-adım yeniden okuması yakalar → ATLANIR.
 */
export async function applyFinalCheck(
  plan: FinalCheckPlan,
  userId: string,
): Promise<{ written: boolean; stationId: string | null; stationCreated: boolean }> {
  if (plan.action !== "ADD_STEP") return { written: false, stationId: plan.station.id, stationCreated: false };
  let res: { stationId: string; stationCreated: boolean } | null;
  try {
    res = await prisma.$transaction(async (tx) => {
      const last = await tx.routeStep.findFirst({
        where: { routeId: plan.route.id },
        orderBy: { sequence: "desc" },
        select: { sequence: true, station: { select: { type: true } } },
      });
      if (!last || last.sequence !== plan.nextSequence - 1 || last.station.type !== StationType.EXTERNAL) return null;
      let stationId = plan.station.id;
      const stationCreated = stationId === null;
      if (stationId === null) {
        const s = await tx.station.create({
          data: {
            code: plan.station.code,
            name: plan.station.name,
            type: StationType.INTERNAL,
            kind: StationKind.TAMBUR,
            department: "KALITE",
            inspectionEnabled: true,
            createdById: userId,
            updatedById: userId,
          },
          select: { id: true },
        });
        stationId = s.id;
      }
      await tx.routeStep.create({ data: { routeId: plan.route.id, stationId, sequence: plan.nextSequence } });
      await tx.route.update({ where: { id: plan.route.id }, data: { updatedById: userId } });
      return { stationId, stationCreated };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") res = null;
    else throw e;
  }
  if (!res) return { written: false, stationId: plan.station.id, stationCreated: false };
  // Audit best-effort, tx DIŞINDA (çekirdek kural).
  if (res.stationCreated) {
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "STATION",
      recordId: res.stationId,
      newData: { code: plan.station.code, name: plan.station.name, type: "INTERNAL", kind: "TAMBUR", inspectionEnabled: true },
    });
  }
  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "ROUTE",
    recordId: plan.route.id,
    oldData: { lastStep: plan.route.lastStep?.stationName ?? null },
    newData: { addedStep: { stationCode: plan.station.code, sequence: plan.nextSequence } },
  });
  return { written: true, stationId: res.stationId, stationCreated: res.stationCreated };
}
