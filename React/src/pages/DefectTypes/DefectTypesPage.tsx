import { useState, useMemo } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Pencil, Trash2, X, Plus, AlertTriangle, RefreshCw } from "lucide-react";
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
import { defectTypeService } from "@/services/defectTypeService";
import type { DefectType } from "@/types/models";
import DefectTypeFormDialog from "./DefectTypeFormDialog";

const severityLabels: Record<string, string> = {
  MINOR: "Düşük",
  MAJOR: "Orta",
  CRITICAL: "Kritik",
};

const severityColor: Record<string, string> = {
  MINOR: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  MAJOR: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  CRITICAL: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const filterConfigs: ColumnFilterConfig[] = [
  {
    id: "severity",
    label: "Önem",
    type: "select",
    options: Object.entries(severityLabels).map(([value, label]) => ({
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

export default function DefectTypesPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDefect, setEditDefect] = useState<DefectType | null>(null);

  const {
    createMutation,
    updateMutation,
    removeMutation,
    hardRemoveMutation,
    activateMutation,
  } = useCrudMutations({
    service: defectTypeService,
    queryKey: "defect-types",
    entityName: "Hata Tipi",
  });

  const columns = useMemo<ColumnDef<DefectType, unknown>[]>(
    () => [
      getSelectionColumn<DefectType>(),
      {
        accessorKey: "code",
        header: "Kod",
        size: 160,
        cell: ({ getValue }) => (
          <code className="font-mono text-xs">{getValue<string>()}</code>
        ),
      },
      {
        accessorKey: "name",
        header: "Görünen Ad",
        size: 220,
      },
      {
        accessorKey: "severity",
        header: "Önem",
        size: 110,
        cell: ({ getValue }) => {
          const val = getValue<string | null>();
          if (!val) return <span className="text-muted-foreground">—</span>;
          return (
            <Badge className={severityColor[val] ?? ""} variant="secondary">
              {severityLabels[val] ?? val}
            </Badge>
          );
        },
      },
      {
        accessorKey: "description",
        header: "Açıklama",
        size: 300,
        cell: ({ getValue }) => {
          const val = getValue<string | null>();
          return val ?? <span className="text-muted-foreground">—</span>;
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
                setEditDefect(row.original);
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
                  if (
                    confirm(
                      "Bu hata tipini pasife almak istediğinize emin misiniz? Operatör ekranında buton olarak görünmeyecek.",
                    )
                  ) {
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
                  activateMutation.mutate(row.original.id);
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
                if (
                  confirm(
                    "DİKKAT: Bu hata tipini kalıcı olarak silmek istediğinize emin misiniz?\n\nBu işlem geri alınamaz. Daha önce bu tip kullanılarak oluşturulmuş hata kayıtları, görsel etiketlerini koruyacak fakat bağlantı kesilecek.",
                  )
                ) {
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
    queryKey: "defect-types",
    fetchFn: defectTypeService.getAll,
    columns,
    defaultSortBy: "code",
    defaultSortOrder: "asc",
  });

  const handleSubmit = (data: Partial<DefectType>) => {
    if (editDefect) {
      updateMutation.mutate(
        { id: editDefect.id, data },
        {
          onSuccess: () => {
            setDialogOpen(false);
            setEditDefect(null);
          },
        },
      );
    } else {
      createMutation.mutate(data, {
        onSuccess: () => {
          setDialogOpen(false);
        },
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Hata Tipleri</h1>
        </div>
        <Button
          onClick={() => {
            setEditDefect(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" />
          Yeni Hata Tipi
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Buradaki aktif hata tipleri operatör ekranında (Kurşun + KK2) buton
        olarak çıkar. Pasife alınan tipler yeni kayıtlarda kullanılamaz ancak
        historik verilerde etiket olarak korunur.
      </p>

      <DataTableToolbar
        search={dt.search}
        onSearchChange={dt.setSearch}
        searchPlaceholder="Kod, isim veya açıklamada ara..."
        filters={filterConfigs}
        activeFilters={dt.activeFilters}
        onFilterChange={dt.setFilter}
        onFilterClear={dt.clearFilter}
        onClearAll={dt.clearAllFilters}
      >
        <DataTableExport
          data={dt.data}
          selectedData={dt.selectedRows}
          filename="hata-tipleri"
          columns={[
            { header: "Kod", accessor: "code" },
            { header: "Görünen Ad", accessor: "name" },
            {
              header: "Önem",
              accessor: (row: DefectType) =>
                row.severity ? severityLabels[row.severity] ?? row.severity : "",
            },
            { header: "Açıklama", accessor: "description" },
            {
              header: "Durum",
              accessor: (row: DefectType) => (row.isActive ? "Aktif" : "Pasif"),
            },
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

      <DefectTypeFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditDefect(null);
        }}
        defectType={editDefect}
        onSubmit={handleSubmit}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}
