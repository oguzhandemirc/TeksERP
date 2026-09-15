// =============================================================================
// TEDARİKÇİ LİSTE MODALI — filtrelenebilir tablo (Cariler sayfası tablo kalıbı: `DataTable`) — istek #5
// =============================================================================
// Arama SUNUCUDA (iki uç da `search` alır; istemcide süzmek ilk sayfayı süzer — `SupplierSelect` başlığı);
// rol süzgeci istemcide (satır sayısı sayfa boyuyla sınırlı). Seçim satıra tıklayınca. İki sorgu AYRI:
// biri düşerse öteki çizilir, durum `supplierLoadNotice` ile söylenir.
// =============================================================================
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/data-table/DataTable";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { customerService } from "@/pages/Customers/service";
import { subcontractorService } from "@/pages/Subcontractors/service";
import type { Customer } from "@/pages/Customers/types";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import { supplierListFilters, supplierLoadNotice, type SupplierParty } from "./supplierParty";
import { SUPPLIER_ROLES, SUPPLIER_ROLE_LABEL, filterSupplierRows, toSupplierPickerRows, type SupplierPickerRow, type SupplierRole } from "./supplierPicker";

const PAGE_SIZE = 100;

export const SUPPLIER_PICKER_COLUMNS: ColumnDef<SupplierPickerRow>[] = [
  { accessorKey: "code", header: "Kod", cell: ({ row }) => <span className="font-mono text-xs">{row.original.code ?? "—"}</span> },
  { accessorKey: "name", header: "Ünvan", cell: ({ row }) => <span className="font-medium">{row.original.name}{!row.original.isActive && <span className="ml-1 text-xs text-muted-foreground">(pasif)</span>}</span> },
  { accessorKey: "role", header: "Rol", cell: ({ row }) => <Badge variant={row.original.role === "SUBCONTRACTOR" ? "secondary" : "default"}>{SUPPLIER_ROLE_LABEL[row.original.role]}</Badge> },
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
  const [roles, setRoles] = useState<Set<SupplierRole>>(() => new Set(SUPPLIER_ROLES));
  const listParams = { page: 1, pageSize: PAGE_SIZE, sortBy: "name", sortOrder: "asc" as const, search: search || undefined, filters: supplierListFilters(includeInactive) };
  const customersQ = useQuery({ queryKey: ["supplier-picker", "customers", search, includeInactive], queryFn: () => customerService.getAll(listParams), staleTime: 30_000, enabled: open });
  const subsQ = useQuery({ queryKey: ["supplier-picker", "subcontractors", search, includeInactive], queryFn: () => subcontractorService.getAll(listParams), staleTime: 30_000, enabled: open });
  const rows = useMemo(
    () => filterSupplierRows(toSupplierPickerRows(customersQ.data?.data as Customer[] | undefined, subsQ.data?.data as Subcontractor[] | undefined), roles),
    [customersQ.data?.data, subsQ.data?.data, roles],
  );
  const table = useReactTable({ data: rows, columns: SUPPLIER_PICKER_COLUMNS, getRowId: (r) => r.key, getCoreRowModel: getCoreRowModel() });
  const notice = supplierLoadNotice({ customersError: customersQ.isError, subcontractorsError: subsQ.isError, loading: customersQ.isLoading || subsQ.isLoading });
  const toggleRole = (r: SupplierRole) =>
    setRoles((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Tedarikçi seç</DialogTitle>
          <DialogDescription>Cari kartlar ve fason firmalar tek listede; satıra tıklayınca seçilir. Yalnız müşteri kartları alışta listelenmez.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[16rem] flex-1">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input aria-label="Tedarikçi ara" placeholder="Kod, ünvan, vergi no…" className="pl-8" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} autoFocus />
          </div>
          <div className="flex items-center gap-1" role="group" aria-label="Rol süzgeci">
            {SUPPLIER_ROLES.map((r) => (
              <Button key={r} type="button" size="sm" variant={roles.has(r) ? "secondary" : "outline"} aria-pressed={roles.has(r)} onClick={() => toggleRole(r)}>
                {SUPPLIER_ROLE_LABEL[r]}
              </Button>
            ))}
          </div>
        </div>
        {notice && <p className={notice.tone === "error" ? "text-xs text-destructive" : "text-xs text-amber-700 dark:text-amber-500"}>{notice.message}</p>}
        <div className="max-h-[60vh] overflow-auto">
          <DataTable
            table={table}
            isLoading={customersQ.isLoading || subsQ.isLoading}
            emptyText={search ? "Aramaya uyan tedarikçi yok." : SUPPLIER_PICKER_EMPTY}
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
