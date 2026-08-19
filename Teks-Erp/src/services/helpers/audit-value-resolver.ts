// =============================================================================
// AUDIT DEĞER ÇÖZÜMLEME — "91cd4281-…" değil "1216-GRİ" (Faz B2 devamı)
// =============================================================================
// Alan-bazlı diff okunur hâle geldiğinde geriye ikinci bir okunmazlık kalıyor:
// DEĞERİN kendisi. `Hedef renk: 91cd4281-acfe-… → bb826d50-acdd-…` satırı,
// alan adı Türkçe olsa bile hiçbir şey anlatmaz.
//
// SEKTÖR KARŞILIĞI: SAP `CDPOS` ham anahtarı saklar (`VALUE_OLD`/`VALUE_NEW`),
// metne çevirmeyi GÖRÜNTÜLEME katmanı yapar — veri sözlüğündeki kontrol
// tablosundan okuyarak. Biz de aynısını yapıyoruz: yazma yolu ham kalır
// (ucuz, sabit, geçmişe dönük doğru), çözümleme OKUMA anında olur.
//
// ⚠️ NEDEN YAZMA ANINDA DEĞİL: adı log'a kopyalasaydık, renk sonradan yeniden
// adlandırıldığında geçmiş kayıt ESKİ adı gösterirdi — ki bu bazen istenir ama
// bizim sorumuz "hangi kayda geçildi" olduğu için kimlik doğru cevaptır. Ayrıca
// her audit satırını şişirirdi (3.013 kayıt/gün).
//
// ⚠️ FAIL-OPEN: kayıt silinmiş/çözülemiyorsa ham UUID kalır. Denetim ekranını
// bir lookup hatası yüzünden düşürmek, biraz ham veri göstermekten kötüdür.
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import type { FieldChange } from "./audit-diff.helper";

/** Alan adı → hangi tablonun kimliği + hangi kolon insana okunur ad. */
const FIELD_SOURCES: Record<string, { table: string; label: string }> = {
  // Renk
  colorId: { table: "colors", label: "name" },
  targetColorId: { table: "colors", label: "name" },
  plannedColorId: { table: "colors", label: "name" },
  // Kumaş / ürün
  itemId: { table: "items", label: "name" },
  // Müşteri / şube
  customerId: { table: "customers", label: "name" },
  branchId: { table: "customer_branches", label: "name" },
  customerBranchId: { table: "customer_branches", label: "name" },
  // Üretim
  stationId: { table: "stations", label: "name" },
  currentStationId: { table: "stations", label: "name" },
  entryStationId: { table: "stations", label: "name" },
  machineId: { table: "machines", label: "name" },
  createdMachineId: { table: "machines", label: "name" },
  qualityGradeId: { table: "quality_grades", label: "name" },
  routeId: { table: "routes", label: "name" },
  // Özellik
  propertyId: { table: "fabric_properties", label: "name" },
  fabricPropertyId: { table: "fabric_properties", label: "name" },
  valueId: { table: "fabric_property_values", label: "name" },
  defectTypeId: { table: "defect_types", label: "name" },
  returnReasonId: { table: "return_reasons", label: "name" },
  // Fason
  subcontractorId: { table: "subcontractors", label: "name" },
  // Belge/kayıt kimlikleri
  orderId: { table: "orders", label: "orderNumber" },
  workOrderId: { table: "work_orders", label: "workOrderNumber" },
  batchId: { table: "batches", label: "batchNumber" },
  rollId: { table: "rolls", label: "barcode" },
  parentRollId: { table: "rolls", label: "barcode" },
  sackId: { table: "sacks", label: "sackNo" },
  shipmentId: { table: "shipments", label: "shipmentNo" },
  // Kişi
  userId: { table: "users", label: "fullName" },
  operatorId: { table: "users", label: "fullName" },
  assignedToId: { table: "users", label: "fullName" },
  printedById: { table: "users", label: "fullName" },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bekçi bu haritayı denetler (tablo/kolon gerçekten var mı). */
export const AUDIT_FIELD_SOURCES = FIELD_SOURCES;

export interface ResolvedChange extends FieldChange {
  /** Çözülebildiyse insana okunur karşılık; çözülemezse alan hiç doğmaz. */
  oldLabel?: string;
  newLabel?: string;
}

/**
 * Diff satırlarındaki UUID değerlerini ada çevirir — tablo başına TEK sorgu.
 *
 * Girdi birden çok log satırının diff'i olabilir (kayıt geçmişi listesi); hepsi
 * birlikte verilirse lookup'lar tek turda toplanır.
 */
export async function resolveChangeValues(
  changeSets: Array<FieldChange[] | null | undefined>,
): Promise<Map<string, string>> {
  const byTable = new Map<string, { label: string; ids: Set<string> }>();
  for (const set of changeSets) {
    if (!Array.isArray(set)) continue;
    for (const c of set) {
      const src = FIELD_SOURCES[c.field];
      if (!src) continue;
      for (const v of [c.old, c.new]) {
        if (typeof v !== "string" || !UUID_RE.test(v)) continue;
        const bucket = byTable.get(src.table) ?? { label: src.label, ids: new Set<string>() };
        bucket.ids.add(v);
        byTable.set(src.table, bucket);
      }
    }
  }

  const out = new Map<string, string>();
  for (const [table, { label, ids }] of byTable) {
    if (ids.size === 0) continue;
    try {
      // Tablo/kolon adları YUKARIDAKİ SABİT haritadan gelir — kullanıcı girdisi
      // değildir; değerler bind parametresidir.
      const rows = await prisma.$queryRaw<Array<{ id: string; label: string | null }>>(
        Prisma.sql`SELECT "id"::text AS id, ${Prisma.raw(`"${label}"`)}::text AS label
                   FROM ${Prisma.raw(`"${table}"`)}
                   WHERE "id" = ANY(${Array.from(ids)}::uuid[])`,
      );
      for (const r of rows) if (r.label) out.set(r.id, r.label);
    } catch {
      // Fail-open: bu tablo çözülemedi, ham UUID kalır.
    }
  }
  return out;
}

/** Tek diff dizisine çözülmüş etiketleri iliştirir. */
export function attachLabels(
  changes: unknown,
  labels: Map<string, string>,
): ResolvedChange[] | null {
  if (!Array.isArray(changes)) return null;
  return (changes as FieldChange[]).map((c) => {
    const out: ResolvedChange = { ...c };
    if (typeof c.old === "string" && labels.has(c.old)) out.oldLabel = labels.get(c.old);
    if (typeof c.new === "string" && labels.has(c.new)) out.newLabel = labels.get(c.new);
    return out;
  });
}
