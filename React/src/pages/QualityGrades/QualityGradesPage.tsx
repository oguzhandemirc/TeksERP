import { useState, useMemo } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Pencil, Trash2, Plus, Sparkles, RefreshCw } from "lucide-react";
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
import { qualityGradeService } from "@/services/qualityGradeService";
import type { QualityGrade } from "@/types/models";
import QualityGradeFormDialog from "./QualityGradeFormDialog";

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

export default function QualityGradesPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editGrade, setEditGrade] = useState<QualityGrade | null>(null);

  const {
    createMutation,
    updateMutation,
    removeMutation,
    activateMutation,
  } = useCrudMutations({
    service: qualityGradeService,
    queryKey: "quality-grades",
    entityName: "Kalite Derecesi",
  });

  const columns = useMemo<ColumnDef<QualityGrade, unknown>[]>(
    () => [
      getSelectionColumn<QualityGrade>(),
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
        accessorKey: "color",
        header: "Renk",
        size: 90,
        cell: ({ getValue }) => {
          const val = getValue<string | null>();
          if (!val) return <span className="text-muted-foreground">—</span>;
          return (
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-4 w-4 rounded border"
                style={{ backgroundColor: val }}
              />
              <code className="text-xs">{val}</code>
            </div>
          );
        },
      },
      {
        accessorKey: "description",
        header: "Açıklama",
        size: 280,
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
        size: 120,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                setEditGrade(row.original);
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
                      "Bu kalite derecesini pasife almak istediğinize emin misiniz? Operatör ekranında seçilemeyecek; mevcut Roll.qualityGrade snapshot'ları korunur.",
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
    queryKey: "quality-grades",
    fetchFn: qualityGradeService.getAll,
    columns,
    defaultSortBy: "sortOrder",
    defaultSortOrder: "asc",
  });

  const handleSubmit = (data: Partial<QualityGrade>) => {
    if (editGrade) {
      updateMutation.mutate(
        { id: editGrade.id, data },
        {
          onSuccess: () => {
            setDialogOpen(false);
            setEditGrade(null);
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
          <Sparkles className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">
            Kalite Dereceleri
          </h1>
        </div>
        <Button
          onClick={() => {
            setEditGrade(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" />
          Yeni Kalite Derecesi
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Buradaki aktif dereceler Tambur ve KK2 karar ekranlarında operatöre
        buton olarak çıkar. Roll.qualityGrade alanı seçilen{" "}
        <code className="text-xs">code</code> değerinin snapshot'ıdır; katalog
        değişse bile eski toplar bozulmaz.
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
          filename="kalite-dereceleri"
          columns={[
            { header: "Sıra", accessor: "sortOrder" },
            { header: "Kod", accessor: "code" },
            { header: "Görünen Ad", accessor: "name" },
            { header: "Renk", accessor: "color" },
            { header: "Açıklama", accessor: "description" },
            {
              header: "Durum",
              accessor: (row: QualityGrade) =>
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

      <QualityGradeFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditGrade(null);
        }}
        grade={editGrade}
        onSubmit={handleSubmit}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}
