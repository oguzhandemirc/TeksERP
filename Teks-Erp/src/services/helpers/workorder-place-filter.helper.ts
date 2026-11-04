// =============================================================================
// İş emri listesi — "şu an hangi fasonda" / "şu an hangi aşamada" süzgeçleri
// =============================================================================
// `filter[fasonFirma]=<uuid,...>` · `filter[asama]=<istasyon uuid,...>`. Top
// yüklemi tek kaynaktan (`roll-place.helper`); İE ↔ top bağı `fasonda` süzgeci ve
// satır rozetiyle aynı (topun ŞU AN durduğu adım). Anahtarlar `buildWhereClause`tan
// ÖNCE okunup silinir (bu serviste allowlist yok, sızan anahtar 500 verir).
// =============================================================================
import { Prisma } from "@prisma/client";
import { validate as isUuidString } from "uuid";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { readFilterList } from "../../utils/query-parser";
import { outstandingItemOfOpenDispatch } from "./fason-open-dispatch.helper";
import { rollAtFasonWhere, rollAtStageWhere } from "./roll-place.helper";

export const FASON_FIRM_FILTER = "fasonFirma";
export const STAGE_FILTER = "asama";

/** İE'nin bir adımında ŞU AN `rollWhere`e uyan top duruyor. */
export function workOrderHasCurrentRoll(rollWhere: Prisma.RollWhereInput): Prisma.WorkOrderWhereInput {
  return { steps: { some: { currentRolls: { some: rollWhere } } } };
}


const badFilter = (msg: string): AppError => AppError.badRequest(msg, { code: "INVALID_FILTER_VALUE" });

/** Anahtarı okur + siler; uuid listesi döner (yoksa boş). Biçim hatası 400. */
function takeIdList(filters: Record<string, unknown>, key: string, what: string): string[] {
  if (!Object.prototype.hasOwnProperty.call(filters, key)) return [];
  const raw = filters[key];
  delete filters[key];
  if (raw !== undefined && typeof raw !== "string" && !Array.isArray(raw)) {
    throw badFilter(`Geçersiz '${key}' süzgeç değeri.`);
  }
  const ids = [...new Set(readFilterList(raw as string | string[] | undefined))];
  if (ids.some((id) => typeof id !== "string" || !isUuidString(id))) {
    throw badFilter(`Geçersiz '${key}' süzgeç değeri; ${what} kimlikleri virgülle ayrılmış UUID olmalıdır.`);
  }
  return ids;
}

/**
 * `fasonFirma` + `asama` → İE where parçaları (AND). Tanınmayan firma/istasyon
 * kimliği 400 `INVALID_FILTER_VALUE` (fail-closed; boş sonuç sessizce dönmez).
 */
export async function takeWorkOrderPlaceFilters(
  filters: Record<string, unknown>,
): Promise<Prisma.WorkOrderWhereInput[]> {
  const firmIds = takeIdList(filters, FASON_FIRM_FILTER, "firma");
  const stationIds = takeIdList(filters, STAGE_FILTER, "aşama");
  const [firmCount, stationCount] = await Promise.all([
    firmIds.length ? prisma.subcontractor.count({ where: { id: { in: firmIds } } }) : 0,
    stationIds.length ? prisma.station.count({ where: { id: { in: stationIds } } }) : 0,
  ]);
  if (firmCount !== firmIds.length) throw badFilter("Seçilen fason firma bulunamadı.");
  if (stationCount !== stationIds.length) throw badFilter("Seçilen üretim aşaması bulunamadı.");

  const conds: Prisma.WorkOrderWhereInput[] = [];
  if (firmIds.length) conds.push(workOrderHasCurrentRoll(rollAtFasonWhere({ subcontractorId: { in: firmIds } })));
  if (stationIds.length) conds.push(workOrderHasCurrentRoll(rollAtStageWhere(stationIds)));
  return conds;
}

export interface PlaceOption {
  id: string;
  name: string;
  /** Şu an orada topu bulunan (arşivlenmemiş) iş emri sayısı — süzgeçle aynı küme. */
  workOrderCount: number;
}

const byCountThenName = (a: PlaceOption, b: PlaceOption): number =>
  b.workOrderCount - a.workOrderCount || a.name.localeCompare(b.name, "tr");

function countDistinct(pairs: Array<[string, string]>): Map<string, number> {
  const sets = new Map<string, Set<string>>();
  for (const [key, woId] of pairs) {
    const s = sets.get(key) ?? new Set<string>();
    s.add(woId);
    sets.set(key, s);
  }
  return new Map([...sets].map(([k, s]) => [k, s.size]));
}

export interface WorkOrderPlaceOptions {
  firms: PlaceOption[];
  stages: PlaceOption[];
}

/**
 * Seçici seçenekleri (faceted): firma sayısı `firmBase` (liste süzgeçleri − fasonFirma)
 * içinde, aşama sayısı `stageBase` (− asama) içinde — seçilince listenin toplamıyla
 * aynı küme. Taban `WorkOrderService.buildListWhere`ten gelir (ikinci where yok).
 * Sabit 4 sorgu (İE sayısından bağımsız); çok olan önde, 0 olanlar sonda.
 */
export async function loadWorkOrderPlaceOptions(bases: {
  firmBase: Prisma.WorkOrderWhereInput;
  stageBase: Prisma.WorkOrderWhereInput;
}): Promise<WorkOrderPlaceOptions> {
  // roll.currentStep.workOrder ≡ workOrder.steps.some.currentRolls (aynı ilişki, ters yön).
  const [atFason, atStage, firms, stations] = await Promise.all([
    prisma.roll.findMany({
      where: { AND: [rollAtFasonWhere(), { currentStep: { workOrder: bases.firmBase } }] },
      select: {
        currentStep: { select: { workOrderId: true } },
        dispatchItems: { where: outstandingItemOfOpenDispatch(), select: { dispatch: { select: { subcontractorId: true } } } },
      },
    }),
    prisma.roll.findMany({
      where: { AND: [rollAtStageWhere(), { currentStep: { workOrder: bases.stageBase } }] },
      select: { currentStep: { select: { workOrderId: true, stationId: true } } },
    }),
    prisma.subcontractor.findMany({ select: { id: true, name: true, isActive: true } }),
    prisma.station.findMany({
      select: { id: true, name: true, isActive: true, allowAsWorkOrderStep: true },
    }),
  ]);

  const firmCounts = countDistinct(
    atFason.flatMap((r) =>
      r.currentStep ? r.dispatchItems.map((it): [string, string] => [it.dispatch.subcontractorId, r.currentStep!.workOrderId]) : [],
    ),
  );
  const stageCounts = countDistinct(
    atStage.flatMap((r): Array<[string, string]> => (r.currentStep ? [[r.currentStep.stationId, r.currentStep.workOrderId]] : [])),
  );
  // Pasif kayıt yalnız şu an orada iş varsa listelenir (yoksa seçilecek bir şey yok).
  const firmOpts = firms
    .map((f) => ({ id: f.id, name: f.name, workOrderCount: firmCounts.get(f.id) ?? 0, show: f.isActive }))
    .filter((f) => f.show || f.workOrderCount > 0)
    .map(({ show: _s, ...o }) => o)
    .sort(byCountThenName);
  const stageOpts = stations
    .map((s) => ({ id: s.id, name: s.name, workOrderCount: stageCounts.get(s.id) ?? 0, show: s.isActive && s.allowAsWorkOrderStep }))
    .filter((s) => s.show || s.workOrderCount > 0)
    .map(({ show: _s, ...o }) => o)
    .sort(byCountThenName);
  return { firms: firmOpts, stages: stageOpts };
}
