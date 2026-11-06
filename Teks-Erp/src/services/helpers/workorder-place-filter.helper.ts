// =============================================================================
// İş emri listesi — "şu an hangi fasonda" süzgeci (2026-11-04)
// =============================================================================
// `filter[fasonFirma]=<firma uuid,...>`. Yüklem tek kaynaktan (`roll-place.helper`,
// sipariş "Nerede?" ile ortak). "Hangi aşamada" sorusu `konumIstasyon`undur; ikinci
// seçici yok. Anahtar `buildWhereClause`tan ÖNCE okunup silinir (sızan anahtar 500).
// =============================================================================
import { Prisma, StationKind, StationType } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { readFilterList } from "../../utils/query-parser";
import { fasonItemNowWhere, workOrderAtFasonWhere } from "./roll-place.helper";

export const FASON_FIRM_FILTER = "fasonFirma";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const badFilter = (msg: string): AppError =>
  AppError.badRequest(msg, { code: "INVALID_FILTER_VALUE", field: FASON_FIRM_FILTER });

/**
 * `fasonFirma` → İE where parçası (diğer süzgeçlerle VE). Anahtarı okur + siler.
 * UUID olmayan ya da kayıtta olmayan firma 400 `INVALID_FILTER_VALUE` (fail-closed).
 */
export async function takeWorkOrderPlaceFilters(
  filters: Record<string, string | string[]>,
): Promise<Prisma.WorkOrderWhereInput[]> {
  const firmIds = [...new Set(readFilterList(filters[FASON_FIRM_FILTER]))];
  delete filters[FASON_FIRM_FILTER];
  if (!firmIds.length) return [];
  const bad = firmIds.find((id) => !UUID_RE.test(id));
  if (bad) throw badFilter(`Geçersiz fason firma kimliği: "${bad}"`);
  if ((await prisma.subcontractor.count({ where: { id: { in: firmIds } } })) !== firmIds.length) {
    throw badFilter("Seçilen fason firma bulunamadı.");
  }
  return [workOrderAtFasonWhere({ subcontractorId: { in: firmIds } })];
}

export interface PlaceOption {
  id: string;
  name: string;
  /** Liste süzgeçleri içinde şu an orada topu bulunan iş emri sayısı — seçilince liste toplamı. */
  workOrderCount: number;
}

/** "Şu an nerede" istasyon süzgeci seçeneği (`filter[konumIstasyon]`); `dis` = fason (dış) istasyon. */
export interface PlaceStationOption {
  id: string;
  name: string;
  kind: StationKind;
  dis: boolean;
}

export interface WorkOrderPlaceOptions {
  firms: PlaceOption[];
  /** Faceted DEĞİL: süzgeçte gösterilecek istasyonlar (tablet `station:read` taşımaz; panel kuralı `stationsForLocationFilter` ile aynı). */
  stations: PlaceStationOption[];
}

// Üretim akışı sırası (Electron `location.ts` FLOW_RANK ile aynı): KK1 → Fason → Kurşun/KK2 → Tambur → Depo.
const FLOW_RANK: Partial<Record<StationKind, number>> = { RAW_QC: 0, PROCESS_QC: 2, TAMBUR: 3, SHIPPING: 4, OTHER: 5 };

/** Pasif, rota adımı olamayan (`allowAsWorkOrderStep=false`) ve tezgah/devere istasyonu hariç — orada İE topu durmaz. */
export async function loadLocationFilterStations(): Promise<PlaceStationOption[]> {
  const rows = await prisma.station.findMany({
    where: { isActive: true, allowAsWorkOrderStep: true, kind: { notIn: [StationKind.WEAVING, StationKind.WARPING] } },
    select: { id: true, name: true, kind: true, type: true },
  });
  const rank = (s: (typeof rows)[number]) => (s.type === StationType.EXTERNAL ? 1 : (FLOW_RANK[s.kind] ?? 5));
  return rows
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "tr"))
    .map((s) => ({ id: s.id, name: s.name, kind: s.kind, dis: s.type === StationType.EXTERNAL }));
}

/**
 * Seçici seçenekleri (faceted): firma sayısı `firmBase` (liste süzgeçleri − `fasonFirma`,
 * `WorkOrderService.buildListWhere`ten) içinde → seçilince listenin toplamı. Pasif firma
 * yalnız sayısı > 0 ise listelenir; sayı azalan, sonra ad. Sabit 2 sorgu.
 */
export async function loadWorkOrderPlaceOptions(firmBase: Prisma.WorkOrderWhereInput): Promise<WorkOrderPlaceOptions> {
  const atFason = await prisma.subcontractorDispatchItem.findMany({
    where: fasonItemNowWhere({ workOrder: firmBase }),
    select: { dispatch: { select: { workOrderId: true, subcontractorId: true } } },
  });
  const firms = await prisma.subcontractor.findMany({ select: { id: true, name: true, isActive: true } });
  const sets = new Map<string, Set<string>>();
  for (const { dispatch } of atFason) {
    if (!dispatch.workOrderId) continue;
    sets.set(dispatch.subcontractorId, (sets.get(dispatch.subcontractorId) ?? new Set<string>()).add(dispatch.workOrderId));
  }
  const stations = await loadLocationFilterStations();
  return {
    stations,
    firms: firms
      .map((f) => ({ id: f.id, name: f.name, workOrderCount: sets.get(f.id)?.size ?? 0, isActive: f.isActive }))
      .filter((f) => f.isActive || f.workOrderCount > 0)
      .map(({ isActive: _a, ...o }) => o)
      .sort((a, b) => b.workOrderCount - a.workOrderCount || a.name.localeCompare(b.name, "tr")),
  };
}
