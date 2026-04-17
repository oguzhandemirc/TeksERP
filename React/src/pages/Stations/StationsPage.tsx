import { useState, useMemo } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Pencil, Trash2, X, Plus, Factory, RefreshCw } from "lucide-react";
import { useDataTable } from "@/hooks/useDataTable";
import { useCrudMutations } from "@/hooks/useCrudMutations";
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
import { Badge } from "@/components/ui/badge";
import { stationService } from "@/services/stationService";
import type { Station } from "@/types/models";
import { stationTypeLabels, StationType } from "@/types/enums";
import StationFormDialog from "./StationFormDialog";

const filterConfigs: ColumnFilterConfig[] = [
  {
    id: "type",
    label: "Tür",
    type: "select",
    options: Object.entries(stationTypeLabels).map(([value, label]) => ({
      value,
      label,
    })),
  },
  {
    id: "isActive",
    label: "Durum",
    type: "select",
    options: [
      { value: "true", label: "Aktif" },
      { value: "false", label: "Pasif" },
    ],
  },
];

const typeColorMap: Record<string, string> = {
  [StationType.INTERNAL]: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
  [StationType.EXTERNAL]: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
};

export default function StationsPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editStation, setEditStation] = useState<Station | null>(null);

  const { createMutation, updateMutation, removeMutation, hardRemoveMutation, activateMutation } = useCrudMutations({
    service: stationService,
    queryKey: "stations",
    entityName: "İstasyon",
  });

  const columns = useMemo<ColumnDef<Station, unknown>[]>(
    () => [
      getSelectionColumn<Station>(),
      {
        accessorKey: "code",
        header: "Kod",
        size: 140,
      },
      {
        accessorKey: "name",
        header: "İsim",
        size: 220,
      },
      {
        accessorKey: "type",
        header: "Tür",
        size: 140,
        cell: ({ getValue }) => {
          const val = getValue<string>();
          return (
            <Badge className={typeColorMap[val] ?? ""} variant="secondary">
              {stationTypeLabels[val as keyof typeof stationTypeLabels] ?? val}
            </Badge>
          );
        },
      },
      {
        accessorKey: "department",
        header: "Departman",
        size: 140,
        cell: ({ getValue }) => getValue<string | null>() ?? "—",
      },
      {
        id: "machineCount",
        header: "Makine",
        size: 90,
        cell: ({ row }) => (
          <Badge variant="outline">{row.original.machines?.length ?? 0}</Badge>
        ),
      },
      {
        accessorKey: "isActive",
        header: "Durum",
        size: 100,
        cell: ({ getValue }) =>
          getValue<boolean>() ? (
            <Badge variant="default">Aktif</Badge>
          ) : (
            <Badge variant="secondary">Pasif</Badge>
          ),
      },
      {
        id: "actions",
        header: "",
        size: 130,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                setEditStation(row.original);
                setDialogOpen(true);
              }}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            {row.original.isActive ? (
              <Button
                variant="ghost"
                size="icon"
                title="Pasife Al"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm("Bu istasyonu pasife almak istediğinize emin misiniz?")) {
                    removeMutation.mutate(row.original.id);
                  }
                }}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                title="Aktif Et"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm("Bu istasyonu tekrar aktif etmek istediğinize emin misiniz?")) {
                    activateMutation.mutate(row.original.id);
                  }
                }}
              >
                <RefreshCw className="h-4 w-4 text-green-600" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              title="Kalıcı Sil"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm("DİKKAT: Bu istasyonu kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz!")) {
                  hardRemoveMutation.mutate(row.original.id);
                }
              }}
            >
              <X className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ),
      },
    ],
    [removeMutation, hardRemoveMutation, activateMutation],
  );

  const dt = useDataTable({
    queryKey: "stations",
    fetchFn: stationService.getAll,
    columns,
    defaultSortBy: "code",
    defaultSortOrder: "asc",
  });

  const handleSubmit = (data: Partial<Station>) => {
    if (editStation) {
      updateMutation.mutate(
        { id: editStation.id, data },
        { onSuccess: () => { setDialogOpen(false); setEditStation(null); } },
      );
    } else {
      createMutation.mutate(data, {
        onSuccess: () => { setDialogOpen(false); },
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Factory className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">İstasyonlar</h1>
        </div>
        <Button
          onClick={() => {
            setEditStation(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" />
          Yeni İstasyon
        </Button>
      </div>

      <DataTableToolbar
        search={dt.search}
        onSearchChange={dt.setSearch}
        searchPlaceholder="Kod veya isimde ara..."
        filters={filterConfigs}
        activeFilters={dt.activeFilters}
        onFilterChange={dt.setFilter}
        onFilterClear={dt.clearFilter}
        onClearAll={dt.clearAllFilters}
      >
        <DataTableExport
          data={dt.data}
          selectedData={dt.selectedRows}
          filename="istasyonlar"
          columns={[
            { header: "Kod", accessor: "code" },
            { header: "İsim", accessor: "name" },
            { header: "Tür", accessor: (row: Station) => stationTypeLabels[row.type] },
            { header: "Departman", accessor: "department" },
            { header: "Makine Sayısı", accessor: (row: Station) => String(row.machines?.length ?? 0) },
            { header: "Durum", accessor: (row: Station) => row.isActive ? "Aktif" : "Pasif" },
          ]}
        />
      </DataTableToolbar>

      {dt.isLoading ? (
        <DataTableSkeleton columnCount={7} rowCount={10} />
      ) : (
        <DataTable table={dt.table} columnCount={7} isFetching={dt.isFetching} />
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

      <StationFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditStation(null);
        }}
        station={editStation}
        onSubmit={handleSubmit}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}
