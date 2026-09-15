// =============================================================================
// TEDARİKÇİ LİSTE MODALI — TAM liste, sunucudan sayfa sayfa, rol tek açılır seçim (istek #5 rev.)
// =============================================================================
// Cariler sayfasının tablo bileşeni (`DataTable`, sonsuz kaydırma sentinel'i içinde) ile Kod · Ünvan · Rol ·
// Vergi No · Telefon. Arama ve rol SUNUCUDA (`useSupplierPickerData`). İlk açılışta filtre yok: bütün cariler
// (müşteri-only dahil — Rol kolonu ayırt eder) + fason firmalar. Seçim satıra tıklayınca.
// =============================================================================
import { useState } from "react";
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/data-table/DataTable";
import type { DataTablePagination } from "@/hooks/useDataTable";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { supplierLoadNotice, type SupplierParty } from "./supplierParty";
import { SUPPLIER_ROLE_FILTER_OPTIONS, SUPPLIER_ROLE_LABEL, type SupplierPickerRow, type SupplierRoleFilter } from "./supplierPicker";
import { SUPPLIER_PICKER_PAGE, useSupplierPickerData } from "./useSupplierPickerData";

export const SUPPLIER_PICKER_COLUMNS: ColumnDef<SupplierPickerRow>[] = [
  { accessorKey: "code", header: "Kod", cell: ({ row }) => <span className="font-mono text-xs">{row.original.code ?? "—"}</span> },
  { accessorKey: "name", header: "Ünvan", cell: ({ row }) => <span className="font-medium">{row.original.name}{!row.original.isActive && <span className="ml-1 text-xs text-muted-foreground">(pasif)</span>}</span> },
  { accessorKey: "role", header: "Rol", cell: ({ row }) => <Badge variant={row.original.role === "SUBCONTRACTOR" ? "secondary" : row.original.role === "CUSTOMER" ? "muted" : "default"}>{SUPPLIER_ROLE_LABEL[row.original.role]}</Badge> },
  { accessorKey: "taxNumber", header: "Vergi No", cell: ({ row }) => row.original.taxNumber ?? <span className="text-muted-foreground">—</span> },
  { accessorKey: "phone", header: "Telefon", cell: ({ row }) => row.original.phone ?? <span className="text-muted-foreground">—</span> },
];

export const SUPPLIER_PICKER_EMPTY = "Tedarikçi kartı yok — Tanımlar → İş Ortakları → Cariler'den açın.";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (party: SupplierParty) => void;
  includeInactive?: boolean;
}

export function SupplierPickerModal({ open, onOpenChange, onPick, includeInactive = false }: Props) {
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), 200);
  const [role, setRole] = useState<SupplierRoleFilter>("ALL");
  const data = useSupplierPickerData({ open, search, role, includeInactive });
  const table = useReactTable({ data: data.rows, columns: SUPPLIER_PICKER_COLUMNS, getRowId: (r) => r.key, getCoreRowModel: getCoreRowModel() });
  const notice = supplierLoadNotice({ customersError: data.customersError, subcontractorsError: data.subcontractorsError, loading: data.isLoading });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>Tedarikçi seç</DialogTitle>
          <DialogDescription>Bütün cari kartlar ve fason firmalar tek listede; kaydırdıkça yüklenir, satıra tıklayınca seçilir.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[16rem] flex-1">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input aria-label="Tedarikçi ara" placeholder="Kod, ünvan, vergi no…" className="pl-8" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} autoFocus />
          </div>
          <select
            aria-label="Rol"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={role}
            onChange={(e) => setRole(e.target.value as SupplierRoleFilter)}
          >
            {SUPPLIER_ROLE_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        {notice && <p className={notice.tone === "error" ? "text-xs text-destructive" : "text-xs text-amber-700 dark:text-amber-500"}>{notice.message}</p>}
        <div className="flex min-h-0 flex-1 flex-col">
          <DataTable
            table={table}
            isLoading={data.isLoading}
            emptyText={search || role !== "ALL" ? "Süzgece uyan kayıt yok." : SUPPLIER_PICKER_EMPTY}
            // `DataTablePagination` tipi `useDataTable`ın dönüşünden türer (loadMore: react-query sonucu döner);
            // burada iki bacaklı yükleyici — DataTable yalnız çağırır, dönüşü okumaz. Sayfa boyu sabit.
            pagination={{ loaded: data.rows.length, total: data.total, hasMore: data.hasMore, isFetchingMore: data.isFetchingMore, pageSize: SUPPLIER_PICKER_PAGE, loadMore: data.loadMore, setPageSize: () => {} } as unknown as DataTablePagination}
            onRowClick={(r) => {
              onPick({ kind: r.kind, id: r.id });
              onOpenChange(false);
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
