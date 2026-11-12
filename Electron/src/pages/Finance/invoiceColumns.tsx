// Faturalar — ortak DataTable sütunları. Satır eylemleri diyalog açar (detay · belge · düzenle · onayla · sil · storno);
// izin kapıları ve statü koşulları önceki elle tabloyla AYNI. Geri çağrılar ref'te (sütunlar bir kez kurulur).
import { useMemo, useRef } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban, Check, Eye, Pencil, Printer, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { useLocalTable } from "@/hooks/useLocalTable";
import { factoryLocaleDateString } from "@/lib/factory-time";
import {
  money,
  partyName,
  settlementOf,
  SETTLEMENT_BADGE,
  SETTLEMENT_LABEL,
  INVOICE_STATUS_BADGE,
  INVOICE_TYPE_LABEL,
  type InvoiceRow,
} from "./service";
// Kuruş → tutar yalnız GÖSTERİM anında (allocationMath sözleşmesi).
import { fromKurus } from "./Allocations/allocationMath";

export interface InvoiceRowHandlers {
  onDetail: (inv: InvoiceRow) => void;
  onPrint: (inv: InvoiceRow) => void;
  onEdit: (inv: InvoiceRow) => void;
  onConfirm: (inv: InvoiceRow) => void;
  onCancel: (inv: InvoiceRow) => void;
  onDelete: (inv: InvoiceRow) => void;
}

const dateText = (inv: InvoiceRow) => factoryLocaleDateString(inv.issueDate, "tr-TR");
// Döviz faturada TL karşılığı aynı satırda — dönem toplamları tek birimde okunabilsin diye damgalanır.
const amountText = (inv: InvoiceRow) =>
  inv.currency !== "TRY" ? `${money(inv.grandTotal, inv.currency)} ≈ ${money(inv.grandTotalTry, "TRY")}` : money(inv.grandTotal, inv.currency);
/** Kapama TÜRETİLİR (kolon değil) ve yalnız CONFIRMED'da anlamlıdır — kural `settlementOf` başlığında. */
function settlementText(inv: InvoiceRow): string {
  const st = settlementOf(inv);
  if (!st) return "—";
  const state = `${st.overdue ? "Vadesi geçti · " : ""}${SETTLEMENT_LABEL[st.state]}`;
  return `${state} · ${money(fromKurus(st.paidK), inv.currency)} / ${money(fromKurus(st.openK), inv.currency)}`;
}

function AmountCell({ inv }: { inv: InvoiceRow }) {
  return (
    <span className="truncate tabular-nums">
      <span className="font-medium">{money(inv.grandTotal, inv.currency)}</span>
      {inv.currency !== "TRY" && <span className="ml-1.5 text-xs text-muted-foreground">≈ {money(inv.grandTotalTry, "TRY")}</span>}
    </span>
  );
}

function SettlementCell({ inv }: { inv: InvoiceRow }) {
  const st = settlementOf(inv);
  // Taslak/iptalde kapama sorusu YOKTUR — boş bırakmak değil, "soru yok" demek ("—").
  if (!st) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex items-center justify-end gap-1">
      {/* Gecikme rozeti yalnız AÇIK tutar varken (settlementOf bunu garanti eder). */}
      {st.overdue && <Badge className="shrink-0 bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200">Vadesi geçti</Badge>}
      <Badge className={`shrink-0 ${SETTLEMENT_BADGE[st.state]}`}>{SETTLEMENT_LABEL[st.state]}</Badge>
      <span className="truncate text-xs tabular-nums text-muted-foreground">
        {money(fromKurus(st.paidK), inv.currency)} / {money(fromKurus(st.openK), inv.currency)}
      </span>
    </span>
  );
}

function ActionsCell({ inv, h }: { inv: InvoiceRow; h: InvoiceRowHandlers }) {
  return (
    <div className="flex items-center justify-end gap-1">
      {/* DETAY her statüde açılır (taslak dahil): satırları ve toplamları görmek okuma iznidir. */}
      <Button variant="outline" size="icon" className="h-7 w-7" title="Detay — satırlar, kapamalar, belge" aria-label="Detay" onClick={() => h.onDetail(inv)}>
        <Eye className="h-4 w-4" />
      </Button>
      {/* BELGE taslakta ÇIKMAZ (belge onayda donar); İPTAL edilmiş fatura filigranla basılabilir KALIR. */}
      {inv.status !== "DRAFT" && (
        <Button variant="outline" size="icon" className="h-7 w-7" title="Faturayı yazdır / önizle" aria-label="Yazdır" onClick={() => h.onPrint(inv)}>
          <Printer className="h-4 w-4" />
        </Button>
      )}
      {inv.status === "DRAFT" && (
        <>
          {/* DÜZENLE onaydan ÖNCE gelir: otomatik doğan 0 fiyatlı taslağın tek çıkışı silmek olmasın. */}
          <PermissionGate permission="finance:write">
            <Button variant="outline" size="sm" className="h-7" title="Taslağı düzenle — satırlar, vade, dış belge no, not" onClick={() => h.onEdit(inv)}>
              <Pencil className="mr-1 h-3.5 w-3.5" />
              Düzenle
            </Button>
          </PermissionGate>
          <PermissionGate permission="finance:invoice">
            <Button size="sm" className="h-7" onClick={() => h.onConfirm(inv)}>
              <Check className="mr-1 h-3.5 w-3.5" />
              Onayla
            </Button>
          </PermissionGate>
          <PermissionGate permission="finance:write">
            <Button
              size="icon"
              title="Taslağı sil"
              aria-label="Taslağı sil"
              className="h-7 w-7 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => h.onDelete(inv)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </PermissionGate>
        </>
      )}
      {inv.status === "CONFIRMED" && (
        <PermissionGate permission="finance:invoice">
          <Button variant="outline" size="sm" className="h-7" onClick={() => h.onCancel(inv)}>
            <Ban className="mr-1 h-3.5 w-3.5" />
            İptal (storno)
          </Button>
        </PermissionGate>
      )}
    </div>
  );
}

function invoiceColumns(h: { current: InvoiceRowHandlers }): ColumnDef<InvoiceRow>[] {
  return [
    { id: "docNo", accessorKey: "docNo", header: "Belge no", size: 150, meta: { label: "Belge no" }, cell: ({ getValue }) => <span className="font-mono text-xs">{String(getValue())}</span> },
    { id: "type", header: "Tür", size: 110, meta: { label: "Tür", exportValue: (inv) => INVOICE_TYPE_LABEL[inv.type] }, cell: ({ row }) => INVOICE_TYPE_LABEL[row.original.type] },
    { id: "cari", header: "Cari", size: 260, meta: { label: "Cari", exportValue: (inv) => partyName(inv.cari) }, cell: ({ row }) => <span className="font-medium">{partyName(row.original.cari)}</span> },
    { id: "issueDate", header: "Tarih", size: 110, meta: { label: "Tarih", exportValue: dateText }, cell: ({ row }) => <span className="tabular-nums">{dateText(row.original)}</span> },
    {
      id: "status",
      header: "Durum",
      size: 100,
      meta: { label: "Durum", exportValue: (inv) => INVOICE_STATUS_BADGE[inv.status].label },
      cell: ({ row }) => {
        const badge = INVOICE_STATUS_BADGE[row.original.status];
        return <Badge className={badge.cls}>{badge.label}</Badge>;
      },
    },
    { id: "grandTotal", header: "Tutar", size: 220, meta: { label: "Tutar", align: "right", exportValue: amountText }, cell: ({ row }) => <AmountCell inv={row.original} /> },
    { id: "settlement", header: "Kapanan / Açık", size: 300, meta: { label: "Kapanan / Açık", align: "right", exportValue: settlementText }, cell: ({ row }) => <SettlementCell inv={row.original} /> },
    {
      id: "actions",
      header: "",
      size: 260,
      enableHiding: false,
      meta: { label: "Eylemler", align: "right", exportValue: () => "" },
      cell: ({ row }) => <ActionsCell inv={row.original} h={h.current} />,
    },
  ];
}

export function useInvoiceTable(rows: InvoiceRow[], handlers: InvoiceRowHandlers) {
  const ref = useRef<InvoiceRowHandlers>(handlers);
  ref.current = handlers;
  const columns = useMemo(() => invoiceColumns(ref), []);
  return useLocalTable({ tableKey: "finance:invoices", data: rows, columns });
}
