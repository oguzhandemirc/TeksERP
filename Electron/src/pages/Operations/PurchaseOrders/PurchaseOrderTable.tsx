// =============================================================================
// ALIŞ SİPARİŞİ LİSTESİ
// =============================================================================
// ⚠️ LİSTE KARŞILANMA YÜZDESİ BASMAZ ve bu bilinçlidir: liste ucu kalem bazında
// `receivedQty` TAŞIMAZ (yalnız kalem/fiş SAYISI ve türetilmiş durum). Yüzdeyi
// burada uydurmak — örneğin "fiş var → yarısı geldi" gibi — hiçbir şeye
// dayanmayan bir sayı üretirdi. Rakam DETAYDA, kaynağından okunur.
//
// ⚠️ DURUM ROZETİ TEK BAŞINA RENK DEĞİL: yanında kısa ibare var ("bir kısmı
// geldi"). Renk körlüğü + eldivenli hızlı bakış.
//
// ⚠️ AKSİYONLAR DURUMA GÖRE ÇİZİLİR: düzenleme yalnız `OPEN`, iptal yalnız
// iptal edilmemiş siparişte. Gri bir düğme "burada bir yol var ama sana kapalı"
// der; oysa gerçek şudur — mal görmüş sipariş revize edilmez, yenisi açılır.
// =============================================================================
import { useMemo } from "react";
import type { ColumnDef, Table } from "@tanstack/react-table";
import { Eye, Pencil, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PermissionGate } from "@/components/PermissionGate";
import { DataTable } from "@/components/data-table/DataTable";
import { useLocalTable } from "@/hooks/useLocalTable";
import { SUPPLIER_KIND_TAG, supplierRefOf } from "@/components/forms/supplierParty";
import type { PurchaseOrderListRow } from "./service";
import { PO_STATUS_BADGE, PO_STATUS_HINT, PO_STATUS_LABEL } from "./labels";
import { EXPECTED_TONE_CLASS, expectedHint, expectedTone, fmtDate } from "./dates";

type Row = PurchaseOrderListRow;

interface Handlers {
  onDetail: (row: Row) => void;
  onEdit: (row: Row) => void;
  onCancel: (row: Row) => void;
}

const Sub = ({ children }: { children: React.ReactNode }) => <span className="ml-1.5 text-[11px] text-muted-foreground">{children}</span>;
// Short-close AYRI söylenir (G2 dikişi): CLOSED rozetinin "tüm kalemler karşılandı" ipucu short-closed siparişte
// YALAN olurdu — kapanış kullanıcı kararıydı, karşılanma değil.
const statusHint = (o: Row) => (o.shortClosedAt ? "kalanı gelmeyecek (kapatıldı)" : PO_STATUS_HINT[o.status]);

const PO_COLUMNS: ColumnDef<Row>[] = [
  {
    accessorKey: "orderNo",
    header: "Sipariş No",
    cell: ({ row: { original: o } }) => (
      <span className="font-mono text-xs">
        {o.orderNo}
        <Sub>{o.currency}</Sub>
      </span>
    ),
  },
  {
    id: "supplier",
    header: "Tedarikçi",
    size: 240,
    meta: { label: "Tedarikçi", exportValue: (o) => supplierRefOf(o)?.name ?? "" },
    cell: ({ row: { original: o } }) => {
      // C4 — DOLU bacak basılır (cari kart ya da fason firma). Rozet yalnız fason tarafta.
      const sup = supplierRefOf(o);
      return (
        <span>
          <span className="font-medium">{sup?.name ?? "—"}</span>
          {sup?.kind === "SUBCONTRACTOR" && (
            <span className="ml-1.5 rounded-badge bg-muted px-1 py-0.5 text-[10px] uppercase text-muted-foreground">
              {SUPPLIER_KIND_TAG.SUBCONTRACTOR}
            </span>
          )}
          {sup?.code && <Sub>{sup.code}</Sub>}
        </span>
      );
    },
  },
  { id: "orderDate", header: "Sipariş tarihi", meta: { label: "Sipariş tarihi", exportValue: (o) => fmtDate(o.orderDate) }, cell: ({ row }) => fmtDate(row.original.orderDate) },
  {
    id: "expectedDate",
    header: "Beklenen",
    meta: { label: "Beklenen", exportValue: (o) => fmtDate(o.expectedDate) },
    cell: ({ row: { original: o } }) => {
      const tone = expectedTone(o.expectedDate, o.status);
      const hint = expectedHint(tone);
      return (
        <span className={EXPECTED_TONE_CLASS[tone]}>
          {fmtDate(o.expectedDate)}
          {hint && <span className="ml-1.5 text-[11px]">{hint}</span>}
        </span>
      );
    },
  },
  { id: "lines", header: "Kalem", size: 80, meta: { label: "Kalem", align: "right", exportValue: (o) => o._count.lines }, cell: ({ row }) => <span className="tabular-nums">{row.original._count.lines}</span> },
  {
    id: "receipts",
    header: "Fiş",
    size: 80,
    meta: { label: "Fiş", align: "right", exportValue: (o) => o._count.goodsReceipts },
    cell: ({ row: { original: o } }) =>
      o._count.goodsReceipts > 0 ? <span className="tabular-nums">{o._count.goodsReceipts}</span> : <span className="text-muted-foreground">—</span>,
  },
  {
    id: "status",
    header: "Durum",
    size: 260,
    meta: { label: "Durum", exportValue: (o) => PO_STATUS_LABEL[o.status] },
    cell: ({ row: { original: o } }) => (
      <span>
        <Badge className={PO_STATUS_BADGE[o.status]}>{PO_STATUS_LABEL[o.status]}</Badge>
        <Sub>{statusHint(o)}</Sub>
      </span>
    ),
  },
];

function poActions({ onDetail, onEdit, onCancel }: Handlers): ColumnDef<Row> {
  return {
    id: "actions",
    header: () => <span className="sr-only">Eylemler</span>,
    enableHiding: false,
    size: 120,
    meta: { label: "Eylemler", align: "right" },
    cell: ({ row: { original: o } }) => {
      const cancelled = o.status === "CANCELLED";
      // ⚠️ `PARTIAL`/`CLOSED` durumu aktif bir mal kabul fişinin VARLIĞINI KANITLAR; backend iptali reddeder. Düğme
      // yine çizilir (sebep ve çözüm iptal diyaloğunda, fiş numaralarıyla) ama ipucu bunu ÖNCEDEN söyler.
      const goodsReceived = o.status === "PARTIAL" || o.status === "CLOSED";
      return (
        // Satır tıklaması detayı açıyor; buradaki düğmeler onu tetiklemesin.
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="outline" size="icon" className="h-7 w-7" title="Detay ve kalemler" onClick={() => onDetail(o)}>
            <Eye className="h-4 w-4" />
          </Button>
          <PermissionGate permission="purchase-order:write">
            <>
              {/* Mal görmüş sipariş revize EDİLMEZ (backend 409) → düğme yalnız OPEN'da çizilir. */}
              {o.status === "OPEN" && (
                <Button variant="outline" size="icon" className="h-7 w-7" title="Siparişi düzenle" onClick={() => onEdit(o)}>
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
              {!cancelled && (
                <Button
                  variant="outline"
                  size="icon"
                  title={goodsReceived ? "Siparişi iptal et — bu siparişe mal kabul edilmiş, önce ilgili fişler iptal edilmeli" : "Siparişi iptal et"}
                  className="h-7 w-7 text-destructive"
                  onClick={() => onCancel(o)}
                >
                  <Ban className="h-4 w-4" />
                </Button>
              )}
            </>
          </PermissionGate>
        </div>
      );
    },
  };
}

/** Tablo sayfada kurulur — standart "Sütunlar" menüsü süzgeç çubuğunda. Düzen `purchase:orders` altında kayıtlı. */
export function usePurchaseOrderTable(rows: Row[], { onDetail, onEdit, onCancel }: Handlers) {
  const columns = useMemo(() => [...PO_COLUMNS, poActions({ onDetail, onEdit, onCancel })], [onDetail, onEdit, onCancel]);
  return useLocalTable({ tableKey: "purchase:orders", data: rows, columns });
}

const cancelledRow = (o: Row) => (o.status === "CANCELLED" ? "opacity-60" : undefined);

export function PurchaseOrderTable({ table, onDetail }: { table: Table<Row>; onDetail: (row: Row) => void }) {
  return <DataTable<Row> table={table} markEntity="purchaseOrder" onRowClick={onDetail} rowClassName={cancelledRow} exportName="Alış siparişleri" />;
}
