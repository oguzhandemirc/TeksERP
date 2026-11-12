// Cariler — ortak DataTable: avatar + ad/kod, pastel rol rozetleri, şehir, telefon, vergi no, durum; satır tıkı yan
// paneli açar (etkin satır vurgulu, tablo odaktayken ↑/↓), satır içi hızlı eylemler üzerine gelince görünür.
// Panel açıkken ikincil sütunlar GEÇİCİ gizlenir (liste daralır, ad kırpılmasın) — kullanıcının sütun tercihine yazılmaz.
import { useMemo } from "react";
import type { ColumnDef, Table } from "@tanstack/react-table";
import { Maximize2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { toneForKey } from "@/components/ui/icon-tile";
import { RecordAvatar, ToneChip } from "@/components/record/RecordBits";
import { DataTable } from "@/components/data-table/DataTable";
import { useLocalTable } from "@/hooks/useLocalTable";
import { partnerRoleLabels } from "@/lib/partnerRoles";
import { formatMoney } from "@/lib/format";
import { ROLE_KEYS, ROLE_TONE, roleOn, rowKey, type CariRowItem } from "./cari-row";

interface Handlers {
  onEdit: (row: CariRowItem) => void;
  onOpenFull: (row: CariRowItem) => void;
}

/** Panel açıkken gizlenen ikincil sütunlar. */
export const CARI_COMPACT_HIDDEN = ["city", "phone", "taxNumber"] as const;
export const CARI_TABLE_KEY = "definitions:cariler";

const dash = <span className="text-muted-foreground">—</span>;

const balanceText = (r: CariRowItem) => (r.balances ?? []).map((b) => formatMoney(b.balance, b.currency)).join(" · ");

/** Bakiye sütunu: sunucu `balances` gönderdiyse kurulur; para birimi başına satır, toplanmaz. */
const balanceColumn: ColumnDef<CariRowItem> = {
  id: "balance",
  header: "Bakiye",
  meta: { align: "right", label: "Bakiye", exportValue: balanceText },
  enableSorting: false,
  cell: ({ row }) => {
    const list = row.original.balances ?? [];
    if (list.length === 0) return dash;
    return (
      <span className="flex flex-col items-end tabular-nums">
        {list.map((b) => (
          <span key={b.currency}>{formatMoney(b.balance, b.currency)}</span>
        ))}
      </span>
    );
  },
};

function cariColumns({ onEdit, onOpenFull }: Handlers, withBalance: boolean): ColumnDef<CariRowItem>[] {
  return [
    {
      id: "cari",
      header: "Cari",
      meta: { label: "Cari", exportValue: (r) => `${r.name} (${r.code})` },
      enableHiding: false,
      size: 320,
      cell: ({ row: { original: r } }) => (
        <span className="flex min-w-0 items-center gap-3">
          <RecordAvatar name={r.name} tone={toneForKey(r.id)} size="sm" />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-semibold">{r.name}</span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">{r.code}</span>
          </span>
        </span>
      ),
    },
    {
      id: "roles",
      header: "Rol",
      meta: {
        label: "Rol",
        exportValue: (r) => ROLE_KEYS.filter((k) => roleOn(r.roles, k)).map((k) => partnerRoleLabels[k]).join(", "),
      },
      cell: ({ row: { original: r } }) => (
        <span className="flex flex-nowrap gap-1 whitespace-nowrap">
          {ROLE_KEYS.filter((k) => roleOn(r.roles, k)).map((k) => (
            <ToneChip key={k} tone={ROLE_TONE[k]}>{partnerRoleLabels[k]}</ToneChip>
          ))}
          {r.kind === "SUBCONTRACTOR" && <ToneChip tone="rose" title="Cari kartına bağlı olmayan eski fason kaydı">Kartsız</ToneChip>}
        </span>
      ),
    },
    { id: "city", header: "Şehir", accessorFn: (r) => r.city ?? "", cell: ({ row }) => row.original.city ?? dash },
    { id: "phone", header: "Telefon", accessorFn: (r) => r.phone ?? "", cell: ({ row }) => <span className="tabular-nums">{row.original.phone ?? dash}</span> },
    {
      id: "taxNumber",
      header: "Vergi no",
      accessorFn: (r) => r.taxNumber ?? "",
      cell: ({ row }) => <span className="font-mono text-xs tabular-nums">{row.original.taxNumber ?? dash}</span>,
    },
    {
      id: "status",
      header: "Durum",
      meta: { label: "Durum", exportValue: (r) => (r.isActive ? "Aktif" : "Pasif") },
      cell: ({ row }) => (row.original.isActive ? <ToneChip tone="green">Aktif</ToneChip> : <ToneChip tone="rose">Pasif</ToneChip>),
    },
    ...(withBalance ? [balanceColumn] : []),
    {
      id: "actions",
      header: () => <span className="sr-only">Eylemler</span>,
      enableHiding: false,
      size: 88,
      meta: { align: "right", label: "Eylemler" },
      cell: ({ row: { original: r } }) => (
        <span
          className="inline-flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 group-aria-selected:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          {r.kind === "CUSTOMER" && (
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`${r.name} — tam sayfa aç`} title="Tam sayfa aç" onClick={() => onOpenFull(r)}>
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <PermissionGate permission={r.kind === "CUSTOMER" ? "customer:write" : "subcontractor:write"}>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`${r.name} — düzenle`} title="Düzenle" onClick={() => onEdit(r)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </PermissionGate>
        </span>
      ),
    },
  ];
}

/** Tablo örneği sayfada kurulur: standart "Sütunlar" menüsü süzgeç satırında, tablo gövdede. */
export function useCariTable(rows: CariRowItem[], compact: boolean, handlers: Handlers) {
  const { onEdit, onOpenFull } = handlers;
  const withBalance = rows.some((r) => r.balances !== undefined);
  const columns = useMemo(() => cariColumns({ onEdit, onOpenFull }, withBalance), [onEdit, onOpenFull, withBalance]);
  return useLocalTable({
    tableKey: CARI_TABLE_KEY,
    data: rows,
    columns,
    getRowId: rowKey,
    hiddenColumns: compact ? CARI_COMPACT_HIDDEN : undefined,
  });
}

interface Props {
  table: Table<CariRowItem>;
  selectedKey: string | null;
  onSelect: (row: CariRowItem) => void;
}

export function CariListTable({ table, selectedKey, onSelect }: Props) {
  return (
    <DataTable<CariRowItem>
      table={table}
      activeRowId={selectedKey}
      // Seçim yalnız satırı alır; tıklama değiştiricileri (yeni sekme) bu listede anlamsız.
      onRowClick={(r) => onSelect(r)}
      exportName="Cariler"
      rowClassName={(r) => (r.isActive ? "group" : "group text-muted-foreground")}
    />
  );
}
