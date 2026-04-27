import { useState, useMemo, useCallback } from "react";
import type { QueryParams } from "@/types/api";
import { type ColumnDef } from "@tanstack/react-table";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  Cylinder,
  Eye,
  Search,
  Trash2,
  X,
  Factory,
  Handshake,
} from "lucide-react";
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

type OwnerTab = "FACTORY" | "CUSTOMER";

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

const factoryColumns = (
  setDetailRollId: (id: string) => void,
  removeMutation: { mutate: (id: string) => void; isPending: boolean },
  hardRemoveMutation: { mutate: (id: string) => void; isPending: boolean },
): ColumnDef<Roll, unknown>[] => [
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
      return type ? itemTypeLabels[type as ItemType] ?? type : "—";
    },
  },
  {
    accessorKey: "width",
    header: "En (cm)",
    size: 90,
    cell: ({ getValue }) => getValue<number | null>() ?? "—",
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
    size: 130,
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
    size: 100,
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
              if (
                confirm(
                  "DİKKAT: Bu topu kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz!",
                )
              ) {
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
];

const customerColumns = (
  setDetailRollId: (id: string) => void,
): ColumnDef<Roll, unknown>[] => [
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
    id: "owner",
    header: "Mal Sahibi",
    size: 180,
    cell: ({ row }) => {
      const owner = row.original.ownerCustomer;
      if (!owner) return <span className="text-muted-foreground text-xs">—</span>;
      return (
        <span className="font-semibold text-purple-700 dark:text-purple-300">
          {owner.name}
        </span>
      );
    },
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
    id: "customerDescription",
    header: "Müşteri Tanımı",
    size: 160,
    cell: ({ row }) => (
      <span className="text-sm italic text-muted-foreground">
        {row.original.customerDescription ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "width",
    header: "En (cm)",
    size: 90,
    cell: ({ getValue }) => getValue<number | null>() ?? "—",
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
    size: 130,
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
    size: 60,
    enableSorting: false,
    cell: ({ row }) => (
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
    ),
  },
];

export default function RollsPage() {
  const [activeTab, setActiveTab] = useState<OwnerTab>("FACTORY");
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [detailRollId, setDetailRollId] = useState<string | null>(null);
  const [barcodeSearch, setBarcodeSearch] = useState("");
  const qc = useQueryClient();

  const invalidateRollCaches = () => {
    qc.invalidateQueries({ queryKey: ["rolls"] });
    qc.invalidateQueries({ queryKey: ["roll-detail"] });
    qc.invalidateQueries({ queryKey: ["roll-history"] });
  };

  const createMutation = useMutation({
    mutationFn: (data: InitialEntryRequest) => rollService.createInitialEntry(data),
    onSuccess: (res) => {
      toast.success(res.message ?? "Top başarıyla oluşturuldu");
      invalidateRollCaches();
      setEntryDialogOpen(false);
    },
    onError: () => toast.error("Top oluşturulurken hata oluştu"),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => rollService.softDelete(id),
    onSuccess: (res) => {
      toast.success(res.message ?? "Top hurda olarak işaretlendi");
      invalidateRollCaches();
    },
    onError: () => toast.error("Top hurdaya alınırken hata oluştu"),
  });

  const hardRemoveMutation = useMutation({
    mutationFn: (id: string) => rollService.hardDelete(id),
    onSuccess: (res) => {
      toast.success(res.message ?? "Top kalıcı olarak silindi");
      invalidateRollCaches();
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

  const factoryCols = useMemo(
    () => factoryColumns(setDetailRollId, removeMutation, hardRemoveMutation),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const customerCols = useMemo(
    () => customerColumns(setDetailRollId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const fetchFactory = useCallback(
    (params: QueryParams) => {
      const p = { ...params, filters: { ...(params.filters || {}), ownerType: "FACTORY" } as Record<string, string | string[]> };
      if (!p.filters.status) p.filters.status = "ALL";
      return rollService.getAll(p);
    },
    [],
  );

  const fetchCustomer = useCallback(
    (params: QueryParams) => {
      const p = { ...params, filters: { ...(params.filters || {}), ownerType: "CUSTOMER" } as Record<string, string | string[]> };
      if (!p.filters.status) p.filters.status = "ALL";
      return rollService.getAll(p);
    },
    [],
  );

  const factoryDt = useDataTable({
    queryKey: ["rolls", "factory"],
    fetchFn: fetchFactory,
    columns: factoryCols,
    defaultSortBy: "createdAt",
    defaultSortOrder: "desc",
  });

  const customerDt = useDataTable({
    queryKey: ["rolls", "customer"],
    fetchFn: fetchCustomer,
    columns: customerCols,
    defaultSortBy: "createdAt",
    defaultSortOrder: "desc",
  });

  const dt = activeTab === "FACTORY" ? factoryDt : customerDt;
  const cols = activeTab === "FACTORY" ? factoryCols : customerCols;

  return (
    <div className="space-y-4">
      {/* Başlık */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cylinder className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Toplar (Envanter)</h1>
        </div>
        <div className="flex items-center gap-2">
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

      {/* Tab Seçici */}
      <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
        <button
          type="button"
          onClick={() => setActiveTab("FACTORY")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
            activeTab === "FACTORY"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Factory className="h-4 w-4" />
          Fabrika Stoğu
          {activeTab === "FACTORY" && factoryDt.pagination.total > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 text-[10px]">
              {factoryDt.pagination.total}
            </Badge>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("CUSTOMER")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
            activeTab === "CUSTOMER"
              ? "bg-purple-600 shadow-sm text-white"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Handshake className="h-4 w-4" />
          Müşteri Malları (Fason)
          {activeTab === "CUSTOMER" && customerDt.pagination.total > 0 && (
            <Badge
              variant="secondary"
              className="ml-1 h-5 text-[10px] bg-purple-500 text-white"
            >
              {customerDt.pagination.total}
            </Badge>
          )}
        </button>
      </div>

      {/* Toolbar */}
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
          filename={
            activeTab === "FACTORY" ? "fabrika-stogu" : "musteri-mallari"
          }
          columns={[
            { header: "Barkod", accessor: "barcode" },
            { header: "Ürün Kodu", accessor: (row: Roll) => row.item?.code ?? "" },
            { header: "Ürün", accessor: (row: Roll) => row.item?.name ?? "" },
            ...(activeTab === "CUSTOMER"
              ? [
                  {
                    header: "Mal Sahibi",
                    accessor: (row: Roll) => row.ownerCustomer?.name ?? "",
                  },
                  {
                    header: "Müşteri Tanımı",
                    accessor: (row: Roll) => row.customerDescription ?? "",
                  },
                ]
              : [{ header: "Desen", accessor: (row: Roll) => row.design ?? "" }]),
            { header: "En (cm)", accessor: (row: Roll) => String(row.width ?? "") },
            { header: "İlk Metraj", accessor: (row: Roll) => String(row.initialQty) },
            { header: "Mevcut Metraj", accessor: (row: Roll) => String(row.currentQty) },
            { header: "Ağırlık (kg)", accessor: (row: Roll) => String(row.weightKg ?? "") },
            { header: "Kalite", accessor: "qualityGrade" },
            { header: "Durum", accessor: (row: Roll) => rollStatusLabels[row.status] ?? row.status },
          ]}
        />
      </DataTableToolbar>

      {/* Tablo */}
      {dt.isLoading ? (
        <DataTableSkeleton columnCount={cols.length} rowCount={10} />
      ) : (
        <DataTable
          table={dt.table}
          columnCount={cols.length}
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

      <RollDetailPanel
        rollId={detailRollId}
        isOpen={!!detailRollId}
        onClose={() => setDetailRollId(null)}
      />
    </div>
  );
}
