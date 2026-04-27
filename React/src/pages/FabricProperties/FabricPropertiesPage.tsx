import { useState, useMemo } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Pencil, Trash2, Plus, Sparkle, RefreshCw } from "lucide-react";
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
import { fabricPropertyService } from "@/services/fabricPropertyService";
import type { FabricProperty } from "@/types/models";
import FabricPropertyFormDialog from "./FabricPropertyFormDialog";

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
  {
    id: "category",
    label: "Kategori",
    type: "select",
    options: [
      { value: "Dayanıklılık", label: "Dayanıklılık" },
      { value: "Yüzey", label: "Yüzey" },
      { value: "Kimyasal", label: "Kimyasal" },
    ],
  },
];

export default function FabricPropertiesPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editProp, setEditProp] = useState<FabricProperty | null>(null);

  const {
    createMutation,
    updateMutation,
    removeMutation,
    activateMutation,
  } = useCrudMutations({
    service: fabricPropertyService,
    queryKey: "fabric-properties",
    entityName: "Kumaş Özelliği",
  });

  const columns = useMemo<ColumnDef<FabricProperty, unknown>[]>(
    () => [
      getSelectionColumn<FabricProperty>(),
      {
        accessorKey: "sortOrder",
        header: "Sıra",
        size: 70,
        cell: ({ getValue }) => (
          <span className="text-muted-foreground text-xs">
            {getValue<number>()}
          </span>
        ),
      },
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
        size: 200,
      },
      {
        accessorKey: "category",
        header: "Kategori",
        size: 140,
        cell: ({ getValue }) => {
          const v = getValue<string | null>();
          return v ? (
            <Badge variant="outline">{v}</Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      },
      {
        accessorKey: "description",
        header: "Açıklama",
        size: 280,
        cell: ({ getValue }) => {
          const v = getValue<string | null>();
          return v ?? <span className="text-muted-foreground">—</span>;
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
        size: 120,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                setEditProp(row.original);
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
                      "Bu özelliği pasife almak istediğinize emin misiniz? Yeni iş emirlerinde seçilemeyecek; mevcut Item bağları korunur.",
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
          </div>
        ),
      },
    ],
    [removeMutation, activateMutation],
  );

  const dt = useDataTable({
    queryKey: "fabric-properties",
    fetchFn: fabricPropertyService.getAll,
    columns,
    defaultSortBy: "sortOrder",
    defaultSortOrder: "asc",
  });

  const handleSubmit = (data: Partial<FabricProperty>) => {
    if (editProp) {
      updateMutation.mutate(
        { id: editProp.id, data },
        {
          onSuccess: () => {
            setDialogOpen(false);
            setEditProp(null);
          },
        },
      );
    } else {
      createMutation.mutate(data, {
        onSuccess: () => setDialogOpen(false),
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkle className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">
            Kumaş Özellikleri
          </h1>
        </div>
        <Button
          onClick={() => {
            setEditProp(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" />
          Yeni Özellik
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Yanmazlık, kayganlık, su geçirmezlik gibi fason adımlarında kazanılan
        kumaş özellikleri. İş emri planlamada hedef olarak seçilir; istasyon
        yetkinlikleri ile eşleşmeli (örn. Boyahane bu özelliği uygulayabilmeli).
      </p>

      <DataTableToolbar
        search={dt.search}
        onSearchChange={dt.setSearch}
        searchPlaceholder="Kod, isim, kategori veya açıklamada ara..."
        filters={filterConfigs}
        activeFilters={dt.activeFilters}
        onFilterChange={dt.setFilter}
        onFilterClear={dt.clearFilter}
        onClearAll={dt.clearAllFilters}
      >
        <DataTableExport
          data={dt.data}
          selectedData={dt.selectedRows}
          filename="kumas-ozellikleri"
          columns={[
            { header: "Sıra", accessor: "sortOrder" },
            { header: "Kod", accessor: "code" },
            { header: "Görünen Ad", accessor: "name" },
            { header: "Kategori", accessor: "category" },
            { header: "Açıklama", accessor: "description" },
            {
              header: "Durum",
              accessor: (row: FabricProperty) =>
                row.isActive ? "Aktif" : "Pasif",
            },
          ]}
        />
      </DataTableToolbar>

      {dt.isLoading ? (
        <DataTableSkeleton columnCount={7} rowCount={6} />
      ) : (
        <DataTable
          table={dt.table}
          columnCount={7}
          isFetching={dt.isFetching}
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

      <FabricPropertyFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditProp(null);
        }}
        property={editProp}
        onSubmit={handleSubmit}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}
