// Cari Hesaplar tablosu — ortak DataTable (tek satır hücre, sütun genişliği/sırası/görünürlüğü kullanıcıya kayıtlı).
import { useMemo } from "react";
import type { ColumnDef, Table } from "@tanstack/react-table";
import { FileSpreadsheet, Pencil } from "lucide-react";
import { DataTable } from "@/components/data-table/DataTable";
import { useLocalTable } from "@/hooks/useLocalTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PermissionGate } from "@/components/PermissionGate";
import { cariRoleLabel, money, type CariRow } from "./service";
import { CariRowActions, CariStatusBadges } from "./CariRowExtras";

/**
 * Para birimi başına AYRI tutar (tek satırda yan yana) — tek sayıya indirmek 1000 USD ile 30.000 TL'yi toplamak olurdu.
 * İşaret bakiyeyle aynı: POZİTİF = cari bize borçlu. Bakiye: yeşil/kırmızı; gecikmiş: alacağımız gecikti kırmızı,
 * borcumuz gecikti amber.
 */
function MoneyStack({ items, tone }: { items: Array<{ currency: CariRow["defaultCurrency"]; amount: number | string }>; tone: "balance" | "overdue" }) {
  if (items.length === 0) return <span className="text-muted-foreground">—</span>;
  const cls = (v: number) =>
    tone === "balance"
      ? v > 0 ? "font-medium text-emerald-600" : "font-medium text-destructive"
      : v > 0 ? "font-medium text-destructive" : "font-medium text-amber-600 dark:text-amber-400";
  return (
    <div className="inline-flex items-center justify-end gap-2">
      {items.map((it) => (
        <span key={it.currency} className={cls(Number(it.amount))}>
          {money(it.amount, it.currency)}
        </span>
      ))}
    </div>
  );
}

interface Handlers {
  onStatement: (row: CariRow) => void;
  onHold: (row: CariRow) => void;
  onEdit: (row: CariRow) => void;
}

const termText = (c: CariRow) =>
  // `0` = peşin; `|| "—"` yazmak onu "vadesiz" gibi gösterirdi.
  c.paymentTermDays != null ? (c.paymentTermDays === 0 ? "Peşin" : `${c.paymentTermDays} gün`) : "—";

function cariColumns({ onStatement, onHold, onEdit }: Handlers): ColumnDef<CariRow>[] {
  return [
    { accessorKey: "code", header: "Kod", cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span> },
    {
      accessorKey: "name",
      header: "Ünvan",
      cell: ({ row: { original: c } }) => (
        <span className="font-medium">
          <span className={c.isActive ? undefined : "text-muted-foreground"}>{c.name}</span>
          <CariStatusBadges row={c} />
        </span>
      ),
    },
    { id: "role", header: "Tür", meta: { label: "Tür", exportValue: cariRoleLabel }, cell: ({ row }) => <Badge variant="outline">{cariRoleLabel(row.original)}</Badge> },
    // "Vade" (anlaşılan gün) ile "Gecikmiş" (vadesi geçmiş açık TUTAR) AYRI sorulardır — ikisi de kalır.
    { id: "term", header: "Vade", meta: { label: "Vade", exportValue: termText }, cell: ({ row }) => <span className="text-muted-foreground">{termText(row.original)}</span> },
    {
      id: "balance",
      header: "Bakiye",
      meta: { label: "Bakiye", align: "right", exportValue: (c) => c.balances.map((b) => money(b.balance, b.currency)).join(" · ") },
      cell: ({ row }) => <MoneyStack items={row.original.balances.map((b) => ({ currency: b.currency, amount: b.balance }))} tone="balance" />,
    },
    {
      // Vadesi geçmiş AÇIK tutar — kaynağı yaşlandırma çekirdeğinin `overdueTotal`'ı (Yaşlandırma raporuyla BİREBİR).
      id: "overdue",
      header: "Gecikmiş",
      meta: { label: "Gecikmiş", align: "right", exportValue: (c) => (c.overdue ?? []).map((o) => money(o.amount, o.currency)).join(" · ") },
      cell: ({ row }) => <MoneyStack items={row.original.overdue ?? []} tone="overdue" />,
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Eylemler</span>,
      enableHiding: false,
      // Dört düğme sığsın; taşarsa ilk eylem (Ekstre) görünür kalsın diye sola yaslı.
      size: 420,
      meta: { label: "Eylemler" },
      cell: ({ row: { original: c } }) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => onStatement(c)}>
            <FileSpreadsheet className="mr-1 h-4 w-4" />
            Ekstre
          </Button>
          <CariRowActions row={c} onHold={() => onHold(c)} />
          <PermissionGate permission="finance:write">
            <Button variant="ghost" size="sm" onClick={() => onEdit(c)}>
              <Pencil className="mr-1 h-4 w-4" />
              Düzenle
            </Button>
          </PermissionGate>
        </div>
      ),
    },
  ];
}

/** Tablo sayfada kurulur — standart "Sütunlar" menüsü araç çubuğunda. Sütun düzeni `finance:cari` altında kayıtlı. */
export function useFinanceCariTable(rows: CariRow[], handlers: Handlers) {
  const { onStatement, onHold, onEdit } = handlers;
  const columns = useMemo(() => cariColumns({ onStatement, onHold, onEdit }), [onStatement, onHold, onEdit]);
  return useLocalTable({ tableKey: "finance:cari", data: rows, columns });
}

export function CariTable({ table, isError, onRetry }: { table: Table<CariRow>; isError: boolean; onRetry: () => void }) {
  // Hata + bayat satır: DataTable "Liste tazelenemedi" bandını kendisi çizer (liste gizlenmez).
  return <DataTable<CariRow> table={table} isError={isError} onRetry={onRetry} exportName="Cari hesaplar" />;
}
