// Mal kabul fişleri tablosu — ortak DataTable (tek satır hücre; sütun düzeni `goods-receipt:list` altında kayıtlı).
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { formatFactory } from "@/lib/factory-time";
import { SUPPLIER_KIND_TAG, supplierRefOf } from "@/components/forms/supplierParty";
import type { GoodsReceiptListRow as Row } from "./service";

/**
 * Sayaç backend `_count`undan (yarnMovements eski backend'de yok → ?? 0 kumaş sayacına düşer). ⚠️ İki sayaç da "ne
 * oldu"yu sayar (iptalli fişte satırlar da sayılır) — "ne kaldı" detaydaki `totals`tadır.
 */
function contentText(r: Row): string {
  const yarn = r._count.yarnMovements ?? 0;
  const cons = r._count.consumableMovements ?? 0;
  return [
    ...(r._count.rolls > 0 || yarn + cons === 0 ? [`${r._count.rolls} top`] : []),
    ...(yarn > 0 ? [`${yarn} iplik`] : []),
    ...(cons > 0 ? [`${cons} sarf`] : []),
  ].join(" + ");
}

export const GOODS_RECEIPT_COLUMNS: ColumnDef<Row>[] = [
  { accessorKey: "receiptNo", header: "Fiş No", cell: ({ row }) => <span className="font-mono text-xs">{row.original.receiptNo}</span> },
  {
    id: "createdAt",
    header: "Tarih",
    meta: { label: "Tarih", exportValue: (r) => formatFactory(r.createdAt, "dd MMM yyyy HH:mm") },
    cell: ({ row }) => formatFactory(row.original.createdAt, "dd MMM yyyy HH:mm"),
  },
  { id: "warehouse", header: "Depo", meta: { label: "Depo", exportValue: (r) => r.warehouse?.name ?? "" }, cell: ({ row }) => row.original.warehouse?.name ?? "—" },
  {
    id: "supplier",
    header: "Tedarikçi",
    size: 220,
    meta: { label: "Tedarikçi", exportValue: (r) => supplierRefOf(r)?.name ?? "" },
    cell: ({ row: { original: r } }) => {
      // C4 — DOLU bacak basılır (cari kart / fason firma); rozet yalnız fason tarafta.
      const sup = supplierRefOf(r);
      if (!sup) return <span className="text-muted-foreground">—</span>;
      return (
        <span>
          {sup.name}
          {sup.kind === "SUBCONTRACTOR" && (
            <span className="ml-1.5 rounded-badge bg-muted px-1 py-0.5 text-[10px] uppercase text-muted-foreground">
              {SUPPLIER_KIND_TAG.SUBCONTRACTOR}
            </span>
          )}
        </span>
      );
    },
  },
  {
    id: "deliveryNoteNo",
    header: "Tedarikçi İrs.",
    meta: { label: "Tedarikçi İrs.", exportValue: (r) => r.deliveryNoteNo ?? "" },
    cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.deliveryNoteNo ?? "—"}</span>,
  },
  // "Top" değil "İçerik": fiş iplik de taşıyabilir (Sınıf 5) — yalnız-iplik fiş "0 top" görünürse depocu
  // "kaydedilmemiş" sanıp ikinci kez girer (backend loadDetail uyarısının ikizi).
  { id: "content", header: "İçerik", meta: { label: "İçerik", align: "right", exportValue: contentText }, cell: ({ row }) => <span className="tabular-nums">{contentText(row.original)}</span> },
  {
    id: "status",
    header: "Durum",
    meta: { label: "Durum", exportValue: (r) => (r.status === "CANCELLED" ? "İptal" : "Aktif") },
    cell: ({ row: { original: r } }) => (
      <span className="inline-flex items-center gap-1.5">
        {r.status === "CANCELLED" ? <Badge variant="outline">İptal</Badge> : <Badge variant="default">Aktif</Badge>}
        {/* C2 — ham stok fişi ayırt edilir: toplar Bitmiş Depo değil Ham Stok sekmesinde durur. */}
        {r.rawStockEntry && <Badge variant="outline">Ham stok</Badge>}
      </span>
    ),
  },
];
