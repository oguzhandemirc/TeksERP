import { useState, useMemo } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Pencil, Trash2, X, Plus, Route as RouteIcon, RefreshCw } from "lucide-react";
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
import { routeService } from "@/services/routeService";
import type { Route } from "@/types/models";
import RouteFormDialog from "./RouteFormDialog";
import RouteDetailPanel from "./RouteDetailPanel";
import { Eye } from "lucide-react";

const filterConfigs: ColumnFilterConfig[] = [
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

export default function RoutesPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRoute, setEditRoute] = useState<Route | null>(null);
  const [detailRouteId, setDetailRouteId] = useState<string | null>(null);

  const { createMutation, updateMutation, removeMutation, hardRemoveMutation, activateMutation } = useCrudMutations({
    service: routeService,
    queryKey: "routes",
    entityName: "Rota",
    relatedKeys: ["route-detail"],
  });

  const columns = useMemo<ColumnDef<Route, unknown>[]>(
    () => [
      getSelectionColumn<Route>(),
      {
        accessorKey: "name",
        header: "Rota İsmi",
        size: 280,
      },
      {
        id: "stepCount",
        header: "Adım Sayısı",
        size: 120,
        cell: ({ row }) => (
          <Badge variant="outline">{row.original.steps?.length ?? 0}</Badge>
        ),
      },
      {
        id: "stationsPreview",
        header: "İstasyonlar",
        size: 350,
        cell: ({ row }) => {
          const steps = row.original.steps ?? [];
          if (steps.length === 0) return <span className="text-muted-foreground">—</span>;
          return (
            <div className="flex items-center gap-1 flex-wrap">
              {steps
                .sort((a, b) => a.sequence - b.sequence)
                .slice(0, 4)
                .map((step, idx) => (
                  <span key={step.id} className="flex items-center gap-1">
                    {idx > 0 && <span className="text-muted-foreground">→</span>}
                    <Badge variant="secondary" className="text-xs">
                      {step.station?.code ?? "?"}
                    </Badge>
                  </span>
                ))}
              {steps.length > 4 && (
                <span className="text-xs text-muted-foreground">
                  +{steps.length - 4} daha
                </span>
              )}
            </div>
          );
        },
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
                setDetailRouteId(row.original.id);
              }}
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                setEditRoute(row.original);
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
                  if (confirm("Bu rotayı pasife almak istediğinize emin misiniz?")) {
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
                  if (confirm("Bu rotayı tekrar aktif etmek istediğinize emin misiniz?")) {
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
                if (confirm("DİKKAT: Bu rotayı kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz!")) {
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
    queryKey: "routes",
    fetchFn: routeService.getAll,
    columns,
    defaultSortBy: "name",
    defaultSortOrder: "asc",
  });

  const handleSubmit = (data: Record<string, unknown>) => {
    if (editRoute) {
      updateMutation.mutate(
        { id: editRoute.id, data: data as Partial<Route> },
        { onSuccess: () => { setDialogOpen(false); setEditRoute(null); } },
      );
    } else {
      createMutation.mutate(data as Partial<Route>, {
        onSuccess: () => { setDialogOpen(false); },
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RouteIcon className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Üretim Rotaları</h1>
        </div>
        <Button
          onClick={() => {
            setEditRoute(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" />
          Yeni Rota
        </Button>
      </div>

      <DataTableToolbar
        search={dt.search}
        onSearchChange={dt.setSearch}
        searchPlaceholder="Rota isminde ara..."
        filters={filterConfigs}
        activeFilters={dt.activeFilters}
        onFilterChange={dt.setFilter}
        onFilterClear={dt.clearFilter}
        onClearAll={dt.clearAllFilters}
      >
        <DataTableExport
          data={dt.data}
          selectedData={dt.selectedRows}
          filename="uretim-rotalari"
          columns={[
            { header: "Rota İsmi", accessor: "name" },
            { header: "Adım Sayısı", accessor: (row: Route) => String(row.steps?.length ?? 0) },
            { header: "Durum", accessor: (row: Route) => row.isActive ? "Aktif" : "Pasif" },
          ]}
        />
      </DataTableToolbar>

      {dt.isLoading ? (
        <DataTableSkeleton columnCount={5} rowCount={10} />
      ) : (
        <DataTable table={dt.table} columnCount={5} isFetching={dt.isFetching} />
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

      <RouteFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditRoute(null);
        }}
        route={editRoute}
        onSubmit={handleSubmit}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />

      <RouteDetailPanel
        routeId={detailRouteId}
        isOpen={!!detailRouteId}
        onClose={() => setDetailRouteId(null)}
      />
    </div>
  );
}
