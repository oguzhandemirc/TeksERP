import { useState, useMemo } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Pencil, Trash2, X, Plus, Cog, RefreshCw } from "lucide-react";
import { useDataTable } from "@/hooks/useDataTable";
import { useCrudMutations } from "@/hooks/useCrudMutations";
import {
  DataTable,
  DataTableToolbar,
  DataTablePagination,
  DataTableSkeleton,
  DataTableExport,
  getSelectionColumn,
} from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { machineService } from "@/services/machineService";
import type { Machine } from "@/types/models";
import MachineFormDialog from "./MachineFormDialog";

export default function MachinesPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editMachine, setEditMachine] = useState<Machine | null>(null);

  const { createMutation, updateMutation, removeMutation, hardRemoveMutation, activateMutation } = useCrudMutations({
    service: machineService,
    queryKey: "machines",
    entityName: "Makine",
  });

  const columns = useMemo<ColumnDef<Machine, unknown>[]>(
    () => [
      getSelectionColumn<Machine>(),
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
        id: "stationName",
        header: "İstasyon",
        size: 200,
        cell: ({ row }) =>
          row.original.station
            ? `${row.original.station.code} - ${row.original.station.name}`
            : "—",
      },
      {
        accessorKey: "deviceIp",
        header: "Cihaz IP",
        size: 140,
        cell: ({ getValue }) => getValue<string | null>() ?? "—",
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
                setEditMachine(row.original);
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
                  if (confirm("Bu makineyi pasife almak istediğinize emin misiniz?")) {
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
                  if (confirm("Bu makineyi tekrar aktif etmek istediğinize emin misiniz?")) {
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
                if (confirm("DİKKAT: Bu makineyi kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz!")) {
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
    queryKey: "machines",
    fetchFn: machineService.getAll,
    columns,
    defaultSortBy: "code",
    defaultSortOrder: "asc",
  });

  const handleSubmit = (data: Partial<Machine>) => {
    if (editMachine) {
      updateMutation.mutate(
        { id: editMachine.id, data },
        { onSuccess: () => { setDialogOpen(false); setEditMachine(null); } },
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
          <Cog className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Makineler</h1>
        </div>
        <Button
          onClick={() => {
            setEditMachine(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" />
          Yeni Makine
        </Button>
      </div>

      <DataTableToolbar
        search={dt.search}
        onSearchChange={dt.setSearch}
        searchPlaceholder="Kod veya isimde ara..."
        filters={[]}
        activeFilters={dt.activeFilters}
        onFilterChange={dt.setFilter}
        onFilterClear={dt.clearFilter}
        onClearAll={dt.clearAllFilters}
      >
        <DataTableExport
          data={dt.data}
          selectedData={dt.selectedRows}
          filename="makineler"
          columns={[
            { header: "Kod", accessor: "code" },
            { header: "İsim", accessor: "name" },
            {
              header: "İstasyon",
              accessor: (row: Machine) =>
                row.station ? `${row.station.code} - ${row.station.name}` : "",
            },
            { header: "Cihaz IP", accessor: "deviceIp" },
            { header: "Durum", accessor: (row: Machine) => row.isActive ? "Aktif" : "Pasif" },
          ]}
        />
      </DataTableToolbar>

      {dt.isLoading ? (
        <DataTableSkeleton columnCount={6} rowCount={10} />
      ) : (
        <DataTable table={dt.table} columnCount={6} isFetching={dt.isFetching} />
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

      <MachineFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditMachine(null);
        }}
        machine={editMachine}
        onSubmit={handleSubmit}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}
