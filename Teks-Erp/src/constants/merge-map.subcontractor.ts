// =============================================================================
// BİRLEŞTİRME HARİTASI — Fason firma bacağı
// =============================================================================
// ⚠️ SÖZLEŞME DEĞİŞMEDİ: bu dosya yalnız SATIRLARI taşır. `MERGE_MAP` tek nesne
// olarak `merge-map.ts`ten çıkmaya devam eder ve `master-data-merge.service`in
// jenerik sürücüsü (`MERGE_MAP[entity]` döngüsü) hiçbir değişiklik görmez.
//
// NEDEN BÖLÜNDÜ (2026-09-13): dosya `max-lines` sınırına (300) dayandı ve içinde
// DÖRT AYRI İŞ vardı — dört birleştirilebilir varlığın kuralları. Tavan burada
// gerçek bir dikiş gösterdi; her yeni model haritayı büyüteceği için (dokuma P2/P3)
// tavanı yükseltmek sınırı anlamsızlaştırırdı.
// =============================================================================
import type { MoveRule } from "./merge-map";

export const SUBCONTRACTOR_MERGE_RULES: MoveRule[] = [
    { kind: "MOVE", model: "SubcontractorDispatch", table: "subcontractor_dispatches", column: "subcontractorId", label: "Fason sevk" },
    {
      kind: "MOVE",
      model: "SubcontractorDispatch",
      table: "subcontractor_dispatches",
      column: "plannedSubcontractorId",
      label: "Fason sevk (planlanan firma)",
    },
    { kind: "MOVE", model: "SubcontractorReceipt", table: "subcontractor_receipts", column: "subcontractorId", label: "Fason kabul" },
    { kind: "MOVE", model: "WarpBeam", table: "warp_beams", column: "subcontractorId", label: "Levent (fason sarım / fason tedarik)" },
    { kind: "MOVE", model: "KartelaDispatch", table: "kartela_dispatches", column: "subcontractorId", label: "Kartela sevk" },
    { kind: "MOVE", model: "KartelaReceipt", table: "kartela_receipts", column: "subcontractorId", label: "Kartela kabul" },
    { kind: "MOVE", model: "RouteStep", table: "route_steps", column: "plannedSubcontractorId", label: "Rota adımı (planlanan firma)" },
    { kind: "MOVE", model: "WorkOrderStep", table: "work_order_steps", column: "plannedSubcontractorId", label: "İş emri adımı (planlanan firma)" },
    {
      kind: "CONFLICT",
      model: "SubcontractorToCategory",
      table: "subcontractor_category_links",
      column: "subcontractorId",
      label: "Firma kategorisi",
      uniqueOn: ["subcontractorId", "categoryId"],
      policy: "UNION_COMPOSITE_PK",
      why:
        "⚠️ Composite PK (`@@id([subcontractorId, categoryId])`), surrogate `id` YOK. " +
        "`updateMany` ile PK'nın yarısını değiştirmek çakışan satırda P2002 verir ve " +
        "`skipDuplicates` bir UPDATE'te yoktur → çakışmayanı taşı, çakışanı SİL.",
    },
    // —— Ticaret / ön muhasebe bacağı (fason firma = tedarikçi bacağı) ————————
    { kind: "MOVE", model: "WeavingOrder", table: "weaving_orders", column: "subcontractorId", label: "Dokuma işi (fason)" },
    { kind: "MOVE", model: "GoodsReceipt", table: "goods_receipts", column: "subcontractorId", label: "Mal kabul fişi (fason tedarikçi)" },
    { kind: "MOVE", model: "PurchaseOrder", table: "purchase_orders", column: "subcontractorId", label: "Alış siparişi (fason tedarikçi)" },
    {
      kind: "CONFLICT",
      model: "CariAccount",
      table: "cari_accounts",
      column: "subcontractorId",
      label: "Cari hesap",
      uniqueOn: ["subcontractorId"],
      policy: "BLOCK",
      why:
        "Müşteri tarafındakiyle aynı gerekçe: iki cari hesabın kapanışı defter kararıdır. " +
        "Kısıt kolonun KENDİSİNDE, yani çakışma ancak iki tarafın da hesabı varsa doğar.",
    },
];
