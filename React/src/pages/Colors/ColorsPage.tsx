import { useState, useMemo } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Pencil, Trash2, Plus, Palette, RefreshCw } from "lucide-react";
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
import { colorService } from "@/services/colorService";
import type { Color } from "@/types/models";
import ColorFormDialog from "./ColorFormDialog";

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

export default function ColorsPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editColor, setEditColor] = useState<Color | null>(null);

  const {
    createMutation,
    updateMutation,
    removeMutation,
    activateMutation,
  } = useCrudMutations({
    service: colorService,
    queryKey: "colors",
    entityName: "Renk",
  });

  const columns = useMemo<ColumnDef<Color, unknown>[]>(
    () => [
      getSelectionColumn<Color>(),
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
        size: 140,
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
        accessorKey: "hex",
        header: "Renk",
        size: 120,
        cell: ({ getValue }) => {
          const val = getValue<string | null>();
          if (!val) return <span className="text-muted-foreground">—</span>;
          return (
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-5 w-5 rounded border"
                style={{ backgroundColor: val }}
              />
              <code className="text-xs">{val}</code>
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
        size: 120,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                setEditColor(row.original);
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
                      "Bu rengi pasife almak istediğinize emin misiniz? Yeni iş emirlerinde seçilemeyecek; mevcut Item.colorId referansları korunur.",
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
    queryKey: "colors",
    fetchFn: colorService.getAll,
    columns,
    defaultSortBy: "sortOrder",
    defaultSortOrder: "asc",
  });

  const handleSubmit = (data: Partial<Color>) => {
    if (editColor) {
      updateMutation.mutate(
        { id: editColor.id, data },
        {
          onSuccess: () => {
            setDialogOpen(false);
            setEditColor(null);
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
          <Palette className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Renkler</h1>
        </div>
        <Button
          onClick={() => {
            setEditColor(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" />
          Yeni Renk
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Fason dönüşünde rulonun yeni Item kimliğine renk verir. Burada
        tanımlanan renkler iş emri planlamada hedef olarak seçilir; istasyon
        yetkinlikleri ile eşleşmeli (Boyahane bu rengi uygulayabilmeli).
      </p>

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
          filename="renkler"
          columns={[
            { header: "Sıra", accessor: "sortOrder" },
            { header: "Kod", accessor: "code" },
            { header: "Görünen Ad", accessor: "name" },
            { header: "Renk (HEX)", accessor: "hex" },
            {
              header: "Durum",
              accessor: (row: Color) => (row.isActive ? "Aktif" : "Pasif"),
            },
          ]}
        />
      </DataTableToolbar>

      {dt.isLoading ? (
        <DataTableSkeleton columnCount={6} rowCount={6} />
      ) : (
        <DataTable
          table={dt.table}
          columnCount={6}
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

      <ColorFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditColor(null);
        }}
        color={editColor}
        onSubmit={handleSubmit}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}
