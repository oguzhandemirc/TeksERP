// Tahsilat / Ödeme tablosu — ortak DataTable (tek satır hücre; sütun düzeni `finance:payments` altında kullanıcıya kayıtlı).
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PermissionGate } from "@/components/PermissionGate";
import { useDrillTarget } from "@/components/layout/tabs/use-tab-target";
import { useLocalTable } from "@/hooks/useLocalTable";
import { factoryLocaleDateString } from "@/lib/factory-time";
import { cashTxnSearchPath } from "./CashTransactions/cashTxnRules";
import { money, partyName, type PaymentRow } from "./service";
import { PAYMENT_METHOD_LABEL } from "./paymentFilters";

interface Handlers {
  onPrint: (row: PaymentRow) => void;
  onCancel: (row: PaymentRow) => void;
}

const boxName = (p: PaymentRow) => p.cashBox?.name ?? p.bankAccount?.name ?? "";

const PAYMENT_COLUMNS: ColumnDef<PaymentRow>[] = [
  {
    accessorKey: "docNo",
    header: "Belge No",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.docNo}</span>,
  },
  {
    id: "direction",
    header: "Yön",
    meta: { label: "Yön", exportValue: (p) => (p.direction === "IN" ? "Tahsilat" : "Ödeme") },
    cell: ({ row: { original: p } }) => (
      <Badge variant="outline" className={p.direction === "IN" ? "text-emerald-600" : "text-amber-700"}>
        {p.direction === "IN" ? "Tahsilat" : "Ödeme"}
      </Badge>
    ),
  },
  {
    id: "cari",
    header: "Cari",
    meta: { label: "Cari", exportValue: (p) => partyName(p.cari) },
    cell: ({ row }) => <span className="font-medium">{partyName(row.original.cari)}</span>,
  },
  {
    id: "method",
    header: "Yöntem",
    meta: { label: "Yöntem", exportValue: (p) => PAYMENT_METHOD_LABEL[p.method] ?? p.method },
    cell: ({ row }) => PAYMENT_METHOD_LABEL[row.original.method] ?? row.original.method,
  },
  {
    id: "account",
    header: "Kasa / Banka",
    meta: { label: "Kasa / Banka", exportValue: boxName },
    cell: ({ row }) => <span className="text-muted-foreground">{boxName(row.original) || "—"}</span>,
  },
  {
    id: "cashLedger",
    header: "Kasa defteri",
    meta: { label: "Kasa defteri", exportValue: (p) => p.cashTransaction?.docNo ?? "" },
    cell: ({ row: { original: p } }) =>
      p.cashTransaction ? (
        <CashLedgerLink docNo={p.cashTransaction.docNo} />
      ) : (
        <span
          className="text-xs text-muted-foreground"
          title="Defter satırı yok — geçmiş kayıt (backfill bekliyor) ya da eski sunucu"
        >
          —
        </span>
      ),
  },
  {
    id: "paymentDate",
    header: "Tarih",
    meta: { label: "Tarih", exportValue: (p) => factoryLocaleDateString(p.paymentDate, "tr-TR") },
    cell: ({ row }) => factoryLocaleDateString(row.original.paymentDate, "tr-TR"),
  },
  {
    id: "amount",
    header: "Tutar",
    meta: { label: "Tutar", align: "right", exportValue: (p) => money(p.amount, p.currency) },
    cell: ({ row: { original: p } }) => (
      <span className="font-medium">
        {p.status === "CANCELLED" ? (
          <span className="line-through">{money(p.amount, p.currency)}</span>
        ) : (
          money(p.amount, p.currency)
        )}
      </span>
    ),
  },
];

function paymentColumnsActions({ onPrint, onCancel }: Handlers): ColumnDef<PaymentRow> {
  return {
    id: "actions",
    header: () => <span className="sr-only">Eylemler</span>,
    enableHiding: false,
    size: 130,
    meta: { label: "Eylemler", align: "right" },
    cell: ({ row: { original: p } }) => (
      <div className="flex items-center justify-end">
        {/* Makbuz KAYIT anında donduğu için her satırda basılabilir (iptal edilmiş olan İPTAL filigranıyla) —
              faturadan farkı budur: makbuzun taslak hâli YOKTUR. */}
        <Button
          variant="outline"
          size="icon"
          className="mr-1 h-7 w-7"
          title="Makbuzu yazdır / önizle"
          onClick={() => onPrint(p)}
        >
          <Printer className="h-4 w-4" />
        </Button>
        {p.status === "ACTIVE" && (
          <PermissionGate permission="finance:payment">
            <Button variant="outline" size="sm" onClick={() => onCancel(p)}>
              <Ban className="mr-1 h-3.5 w-3.5" />
              İptal
            </Button>
          </PermissionGate>
        )}
      </div>
    ),
  };
}

const paymentColumns = (h: Handlers): ColumnDef<PaymentRow>[] => [
  ...PAYMENT_COLUMNS,
  paymentColumnsActions(h),
];

/** Tablo sayfada kurulur — standart "Sütunlar" menüsü süzgeç çubuğunda. */
export function usePaymentTable(rows: PaymentRow[], { onPrint, onCancel }: Handlers) {
  const columns = useMemo(() => paymentColumns({ onPrint, onCancel }), [onPrint, onCancel]);
  return useLocalTable({ tableKey: "finance:payments", data: rows, columns });
}

export const cancelledPaymentRow = (p: PaymentRow) => (p.status === "CANCELLED" ? "opacity-60" : undefined);

/** Ödemenin kasa/banka defteri satırı — tıklayınca Kasa Hareketleri o belge no ile açılır. */
function CashLedgerLink({ docNo }: { docNo: string }) {
  const drill = useDrillTarget(cashTxnSearchPath(docNo));
  return (
    <button
      type="button"
      className="font-mono text-xs text-primary hover:underline"
      title="Kasa defteri satırını aç"
      onClick={drill.onClick}
      onAuxClick={drill.onAuxClick}
      onContextMenu={drill.onContextMenu}
    >
      {docNo}
    </button>
  );
}
