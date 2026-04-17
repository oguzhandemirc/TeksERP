import { useState, useMemo, useCallback } from "react";
import type { QueryParams } from "@/types/api";
import { type ColumnDef } from "@tanstack/react-table";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Cylinder, Eye, Search, Trash2, X } from "lucide-react";
import { useDataTable } from "@/hooks/useDataTable";
import {
  DataTable,
  DataTableToolbar,
  DataTablePagination,
  DataTableSkeleton,
  DataTableExport,
  getSelectionColumn,
  type ColumnFilterConfig,
} from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { rollService, type InitialEntryRequest } from "@/services/rollService";
import type { Roll } from "@/types/models";
import { RollStatus, rollStatusLabels, itemTypeLabels } from "@/types/enums";
import type { ItemType } from "@/types/enums";
import InitialEntryDialog from "./InitialEntryDialog";
import RollDetailPanel from "./RollDetailPanel";

const filterConfigs: ColumnFilterConfig[] = [
  {
    id: "status",
    label: "Durum",
    type: "select",
    options: Object.entries(rollStatusLabels).map(([value, label]) => ({
      value,
      label,
    })),
  },
];

const statusColorMap: Record<string, string> = {
  [RollStatus.STOCK]: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  [RollStatus.IN_PRODUCTION]: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  [RollStatus.PRODUCED]: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  [RollStatus.READY_FOR_SHIP]: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  [RollStatus.SHIPPED]: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
  [RollStatus.SCRAP]: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export default function RollsPage() {
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [detailRollId, setDetailRollId] = useState<string | null>(null);
  const [barcodeSearch, setBarcodeSearch] = useState("");
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (data: InitialEntryRequest) => rollService.createInitialEntry(data),
    onSuccess: (res) => {
      toast.success(res.message ?? "Top başarıyla oluşturuldu");
      qc.invalidateQueries({ queryKey: ["rolls"] });
      setEntryDialogOpen(false);
    },
    onError: () => {
      toast.error("Top oluşturulurken hata oluştu");
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => rollService.softDelete(id),
    onSuccess: (res) => {
      toast.success(res.message ?? "Top hurda olarak işaretlendi");
      qc.invalidateQueries({ queryKey: ["rolls"] });
    },
    onError: () => toast.error("Top hurdaya alınırken hata oluştu"),
  });

  const hardRemoveMutation = useMutation({
    mutationFn: (id: string) => rollService.hardDelete(id),
    onSuccess: (res) => {
      toast.success(res.message ?? "Top kalıcı olarak silindi");
      qc.invalidateQueries({ queryKey: ["rolls"] });
    },
    onError: () => toast.error("Top silinirken hata oluştu"),
  });

  const handleBarcodeSearch = useCallback(async () => {
    const trimmed = barcodeSearch.trim();
    if (!trimmed) return;
    try {
      const res = await rollService.getByBarcode(trimmed);
      if (res.success && res.data) {
        setDetailRollId(res.data.id);
      } else {
        toast.error("Barkod bulunamadı");
      }
    } catch {
      toast.error("Barkod sorgulanırken hata oluştu");
    }
  }, [barcodeSearch]);

  const columns = useMemo<ColumnDef<Roll, unknown>[]>(
    () => [
      getSelectionColumn<Roll>(),
      {
        accessorKey: "barcode",
        header: "Barkod",
        size: 210,
        cell: ({ getValue }) => (
          <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
            {getValue<string>()}
          </code>
        ),
      },
      {
        id: "itemCode",
        header: "Ürün Kodu",
        size: 130,
        cell: ({ row }) => row.original.item?.code ?? "—",
      },
      {
        id: "itemName",
        header: "Ürün",
        size: 190,
        cell: ({ row }) => row.original.item?.name ?? "—",
      },
      {
        id: "design",
        header: "Desen",
        size: 160,
        cell: ({ row }) => (
          <span className="text-sm">
            {(row.original.variant?.code || row.original.design) ?? (
              <span className="text-muted-foreground italic text-xs">—</span>
            )}
          </span>
        ),
      },
      {
        id: "itemType",
        header: "Tür",
        size: 120,
        cell: ({ row }) => {
          const type = row.original.item?.itemType;
          return type
            ? itemTypeLabels[type as ItemType] ?? type
            : "—";
        },
      },
      {
        accessorKey: "currentQty",
        header: "Miktar (mt)",
        size: 110,
        cell: ({ row }) => (
          <span>
            {row.original.currentQty}
            {row.original.currentQty !== row.original.initialQty && (
              <span className="text-muted-foreground text-xs ml-1">
                / {row.original.initialQty}
              </span>
            )}
          </span>
        ),
      },
      {
        accessorKey: "weightKg",
        header: "Ağırlık (kg)",
        size: 110,
        cell: ({ getValue }) => getValue<number | null>() ?? "—",
      },
      {
        accessorKey: "qualityGrade",
        header: "Kalite",
        size: 100,
      },
      {
        accessorKey: "status",
        header: "Durum",
        size: 120,
        cell: ({ getValue }) => {
          const val = getValue<string>();
          return (
            <Badge className={statusColorMap[val] ?? ""} variant="secondary">
              {rollStatusLabels[val as keyof typeof rollStatusLabels] ?? val}
            </Badge>
          );
        },
      },
      {
        id: "actions",
        header: "",
        size: 120,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                setDetailRollId(row.original.id);
              }}
            >
              <Eye className="h-4 w-4" />
            </Button>
            {row.original.status === "STOCK" && (
              <Button
                variant="ghost"
                size="icon"
                title="Hurdaya Al"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm("Bu topu hurdaya almak istediğinize emin misiniz?")) {
                    removeMutation.mutate(row.original.id);
                  }
                }}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            )}
            {row.original.status === "SCRAP" && (
              <Button
                variant="ghost"
                size="icon"
                title="Kalıcı Sil"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm("DİKKAT: Bu topu kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz!")) {
                    hardRemoveMutation.mutate(row.original.id);
                  }
                }}
              >
                <X className="h-4 w-4 text-destructive" />
              </Button>
            )}
          </div>
        ),
      },
    ],
    [],
  );

  const fetchRolls = useCallback((params: QueryParams) => {
    const p = { ...params, filters: { ...params.filters } };
    if (!p.filters.status) {
      p.filters.status = "ALL";
    }
    return rollService.getAll(p);
  }, []);

  const dt = useDataTable({
    queryKey: "rolls",
    fetchFn: fetchRolls,
    columns,
    defaultSortBy: "createdAt",
    defaultSortOrder: "desc",
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cylinder className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Toplar (Envanter)</h1>
        </div>
        <div className="flex items-center gap-2">
          {/* Barkod Arama */}
          <div className="flex items-center gap-1">
            <Input
              value={barcodeSearch}
              onChange={(e) => setBarcodeSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleBarcodeSearch()}
              placeholder="Barkod ile ara..."
              className="w-52 h-9 text-sm"
            />
            <Button variant="outline" size="sm" onClick={handleBarcodeSearch}>
              <Search className="h-4 w-4" />
            </Button>
          </div>
          <Button onClick={() => setEntryDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Mal Kabul
          </Button>
        </div>
      </div>

      <DataTableToolbar
        search={dt.search}
        onSearchChange={dt.setSearch}
        searchPlaceholder="Barkod ile ara..."
        filters={filterConfigs}
        activeFilters={dt.activeFilters}
        onFilterChange={dt.setFilter}
        onFilterClear={dt.clearFilter}
        onClearAll={dt.clearAllFilters}
      >
        <DataTableExport
          data={dt.data}
          selectedData={dt.selectedRows}
          filename="envanter-toplar"
          columns={[
            { header: "Barkod",        accessor: "barcode" },
            { header: "Ürün Kodu",     accessor: (row: Roll) => row.item?.code ?? "" },
            { header: "Ürün",         accessor: (row: Roll) => row.item?.name ?? "" },
            { header: "Desen",         accessor: (row: Roll) => row.design ?? "" },
            { header: "İlk Metraj",   accessor: (row: Roll) => String(row.initialQty) },
            { header: "Mevcut Metraj", accessor: (row: Roll) => String(row.currentQty) },
            { header: "Ağırlık (kg)", accessor: (row: Roll) => String(row.weightKg ?? "") },
            { header: "Kalite",        accessor: "qualityGrade" },
            { header: "Durum",         accessor: (row: Roll) => rollStatusLabels[row.status] ?? row.status },
          ]}
        />
      </DataTableToolbar>

      {dt.isLoading ? (
        <DataTableSkeleton columnCount={10} rowCount={10} />
      ) : (
        <DataTable
          table={dt.table}
          columnCount={10}
          isFetching={dt.isFetching}
          onRowClick={(row) => setDetailRollId(row.id)}
        />
      )}

      <DataTablePagination
        page={dt.pagination.page}
        pageSize={dt.pagination.pageSize}
        total={dt.pagination.total}
        totalPages={dt.pagination.totalPages}
        onPageChange={dt.setPage}
        onPageSizeChange={dt.setPageSize}
        selectedCount={dt.selectedCount}
      />

      <InitialEntryDialog
        open={entryDialogOpen}
        onOpenChange={setEntryDialogOpen}
        onSubmit={(data) => createMutation.mutate(data)}
        isLoading={createMutation.isPending}
      />

      {detailRollId && (
        <RollDetailPanel
          rollId={detailRollId}
          onClose={() => setDetailRollId(null)}
        />
      )}
    </div>
  );
}
