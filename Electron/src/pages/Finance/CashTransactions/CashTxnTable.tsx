// =============================================================================
// KASA HAREKETLERİ TABLOSU
// =============================================================================
// ⚠️ TUTAR YÖNLÜ BASILIR ve yön `row.direction`'dan okunur — türden yeniden
// TÜRETİLMEZ (saf katman notu). İşaret (+/−) her zaman yazılır: renk tek başına
// erişilebilir bir ayrım değildir ve gri tonlu/parlak ekranda kaybolur.
//
// ⚠️ İPTAL SATIRI SİLİNMİŞ GİBİ GÖSTERİLMEZ: soluklaşır ve tutarı üstü çizili
// basılır (`PaymentsPage` emsali). Defterde duruyor olması bilgidir.
// =============================================================================

import { useMemo } from "react";
import type { ColumnDef, Table } from "@tanstack/react-table";
import { AlertTriangle, Ban } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { DataTable } from "@/components/data-table/DataTable";
import { useLocalTable } from "@/hooks/useLocalTable";
import { money } from "../service";
import { fmtDate } from "../Cheques/dates";
import { useDrillTarget } from "@/components/layout/tabs/use-tab-target";
import {
  DIRECTION_TONE,
  KIND_LABEL,
  STATUS_LABEL,
  accountNameOf,
  isPaymentLedgerRow,
  paymentSearchPath,
  withSign,
} from "./cashTxnRules";
import type { CashTxnRow } from "./service";
import { currencyMismatchOf } from "./currencyMismatch";

interface Handlers {
  onCancel: (row: CashTxnRow) => void;
  /** D4-H3: masraf bağları — yalnız `finance.masraf.bagAlani` OPTIONAL iken verilir (OFF'ta tablo bayt-aynı). */
  onAllocations?: (row: CashTxnRow) => void;
}

const amountTextOf = (r: CashTxnRow) => withSign(r.direction, money(r.amount, r.currency));

const CASH_TXN_COLUMNS: ColumnDef<CashTxnRow>[] = [
  {
    accessorKey: "docNo",
    header: "Belge No",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.docNo}</span>,
  },
  {
    id: "kind",
    header: "Tür",
    meta: { label: "Tür", exportValue: (r) => KIND_LABEL[r.kind] },
    cell: ({ row: { original: r } }) => (
      <Badge variant="outline" className={DIRECTION_TONE[r.direction]}>
        {KIND_LABEL[r.kind]}
      </Badge>
    ),
  },
  {
    id: "account",
    header: "Hesap",
    meta: { label: "Hesap", exportValue: accountNameOf },
    cell: ({ row }) => <span className="font-medium">{accountNameOf(row.original)}</span>,
  },
  {
    id: "txnDate",
    header: "Tarih",
    meta: { label: "Tarih", exportValue: (r) => fmtDate(r.txnDate) },
    cell: ({ row }) => fmtDate(row.original.txnDate),
  },
  {
    id: "amount",
    header: "Tutar",
    meta: { label: "Tutar", align: "right", exportValue: amountTextOf },
    cell: ({ row: { original: r } }) => {
      const cancelled = r.status === "CANCELLED";
      const amountText = amountTextOf(r);
      return (
        <span className={`font-medium ${cancelled ? "" : DIRECTION_TONE[r.direction]}`}>
          {cancelled ? <span className="line-through">{amountText}</span> : amountText}
          <CurrencyMismatchBadge row={r} />
        </span>
      );
    },
  },
  {
    id: "category",
    header: "Kategori",
    meta: { label: "Kategori", exportValue: (r) => r.category ?? "" },
    cell: ({ row }) => <span className="text-muted-foreground">{row.original.category ?? "—"}</span>,
  },
  {
    id: "description",
    header: "Açıklama",
    size: 280,
    meta: {
      label: "Açıklama",
      exportValue: (r) => [r.description, r.reference].filter(Boolean).join(" · "),
    },
    cell: ({ row: { original: r } }) => (
      <span className="text-muted-foreground">
        {r.description ?? "—"}
        {r.reference && <span className="ml-1 text-xs">· {r.reference}</span>}
      </span>
    ),
  },
  {
    id: "source",
    header: "Kaynak",
    meta: { label: "Kaynak", exportValue: (r) => r.payment?.docNo ?? "" },
    cell: ({ row: { original: r } }) =>
      r.payment ? <PaymentLink payment={r.payment} /> : <span className="text-muted-foreground">—</span>,
  },
  {
    id: "status",
    header: "Durum",
    meta: {
      label: "Durum",
      exportValue: (r) => STATUS_LABEL[r.status === "CANCELLED" ? "CANCELLED" : "ACTIVE"],
    },
    cell: ({ row: { original: r } }) =>
      r.status === "CANCELLED" ? (
        <Badge className="bg-muted text-muted-foreground">{STATUS_LABEL.CANCELLED}</Badge>
      ) : (
        <span className="text-xs text-muted-foreground">{STATUS_LABEL.ACTIVE}</span>
      ),
  },
];

function cashTxnColumnsActions({ onCancel, onAllocations }: Handlers): ColumnDef<CashTxnRow> {
  return {
    id: "actions",
    header: () => <span className="sr-only">Eylemler</span>,
    enableHiding: false,
    size: 170,
    meta: { label: "Eylemler", align: "right" },
    cell: ({ row: { original: r } }) => (
      <div className="flex items-center justify-end">
        {onAllocations && r.kind === "EXPENSE" && (
          <Button variant="ghost" size="sm" className="mr-1" onClick={() => onAllocations(r)}>
            Bağlar
          </Button>
        )}
        {r.status !== "CANCELLED" && !isPaymentLedgerRow(r) && (
          <PermissionGate permission="finance:payment">
            <Button variant="outline" size="sm" onClick={() => onCancel(r)}>
              <Ban className="mr-1 h-3.5 w-3.5" />
              İptal
            </Button>
          </PermissionGate>
        )}
      </div>
    ),
  };
}

const cashTxnColumns = (h: Handlers): ColumnDef<CashTxnRow>[] => [
  ...CASH_TXN_COLUMNS,
  cashTxnColumnsActions(h),
];

/** Tablo sayfada kurulur — standart "Sütunlar" menüsü süzgeç çubuğunda. Düzen `finance:cash-txn` altında kayıtlı. */
export function useCashTxnTable(rows: CashTxnRow[], { onCancel, onAllocations }: Handlers) {
  const columns = useMemo(() => cashTxnColumns({ onCancel, onAllocations }), [onCancel, onAllocations]);
  return useLocalTable({ tableKey: "finance:cash-txn", data: rows, columns });
}

const cancelledRow = (r: CashTxnRow) => (r.status === "CANCELLED" ? "opacity-60" : undefined);

export function CashTxnTable({
  table,
  isError,
  onRetry,
}: {
  table: Table<CashTxnRow>;
  isError?: boolean;
  onRetry?: () => void;
}) {
  return (
    <DataTable<CashTxnRow>
      table={table}
      isError={isError}
      onRetry={onRetry}
      rowClassName={cancelledRow}
      exportName="Kasa hareketleri"
    />
  );
}

/** Ödemeden doğan satırın kaynağı — tıklayınca Tahsilat/Ödeme listesi o belge no ile açılır (yerinde; orta tık yeni sekme). */
function PaymentLink({ payment }: { payment: NonNullable<CashTxnRow["payment"]> }) {
  const drill = useDrillTarget(paymentSearchPath(payment.docNo));
  return (
    <button
      type="button"
      className="text-left text-primary hover:underline"
      title="Tahsilat/Ödeme kaydını aç"
      onClick={drill.onClick}
      onAuxClick={drill.onAuxClick}
      onContextMenu={drill.onContextMenu}
    >
      <span className="font-mono text-xs">{payment.docNo}</span>
      <span className="ml-1 text-xs text-muted-foreground">
        {payment.direction === "IN" ? "Tahsilat" : "Ödeme"} · {payment.cari.name}
      </span>
    </button>
  );
}

/** Belge ≠ hesap para birimi — uyarı rozeti + ipucu (yalnız gösterim). */
function CurrencyMismatchBadge({ row }: { row: CashTxnRow }) {
  const m = currencyMismatchOf(row);
  if (!m) return null;
  return (
    <Badge
      variant="outline"
      data-testid="currency-mismatch"
      title={m.hint}
      className="ml-1.5 border-warning/50 text-warning"
    >
      <AlertTriangle className="mr-0.5 h-3 w-3" /> Hesap {m.account}
    </Badge>
  );
}
