import { useState, useMemo } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Pencil, Trash2, X, Plus, Package, RefreshCw } from "lucide-react";
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
import { itemService } from "@/services/itemService";
import type { Item } from "@/types/models";
import { itemTypeLabels, ItemType } from "@/types/enums";
import ItemFormDialog from "./ItemFormDialog";
import ItemDetailPanel from "./ItemDetailPanel";
import { Eye } from "lucide-react";

const filterConfigs: ColumnFilterConfig[] = [
  {
    id: "itemType",
    label: "Tür",
    type: "select",
    options: Object.entries(itemTypeLabels).map(([value, label]) => ({
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
  [ItemType.YARN]: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  [ItemType.WARP]: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  [ItemType.RAW_FABRIC]: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  [ItemType.DYED_FABRIC]: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  [ItemType.CONSUMABLE]: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

export default function ItemsPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);

  const { createMutation, updateMutation, removeMutation, hardRemoveMutation, activateMutation } = useCrudMutations({
    service: itemService,
    queryKey: "items",
    entityName: "Stok kartı",
    relatedKeys: ["item-detail", "item-variants"],
  });

  const columns = useMemo<ColumnDef<Item, unknown>[]>(
    () => [
      getSelectionColumn<Item>(),
      {
        accessorKey: "code",
        header: "Kod",
        size: 140,
      },
      {
        accessorKey: "name",
        header: "İsim",
        size: 240,
      },
      {
        accessorKey: "itemType",
        header: "Tür",
        size: 150,
        cell: ({ getValue }) => {
          const val = getValue<string>();
          return (
            <Badge className={typeColorMap[val] ?? ""} variant="secondary">
              {itemTypeLabels[val as keyof typeof itemTypeLabels] ?? val}
            </Badge>
          );
        },
      },
      {
        accessorKey: "unit",
        header: "Birim",
        size: 80,
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
                setDetailItemId(row.original.id);
              }}
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                setEditItem(row.original);
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
                  if (confirm("Bu stok kartını pasife almak istediğinize emin misiniz?")) {
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
                  if (confirm("Bu stok kartını tekrar aktif etmek istediğinize emin misiniz?")) {
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
                if (confirm("DİKKAT: Bu stok kartını kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz!")) {
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
    queryKey: "items",
    fetchFn: itemService.getAll,
    columns,
    defaultSortBy: "code",
    defaultSortOrder: "asc",
  });

  const handleSubmit = async (data: Partial<Item>): Promise<{ id: string } | undefined> => {
    if (editItem) {
      return new Promise((resolve) => {
        updateMutation.mutate(
          { id: editItem.id, data },
          {
            onSuccess: () => {
              // Dialog kapatmayı ItemFormDialog.handleFormSubmit'e bırakıyoruz
              // (varyantlar kaydedildikten sonra kapanması için)
              resolve({ id: editItem.id });
            },
            onError: () => {
              resolve(undefined);
            },
          },
        );
      });
    } else {
      return new Promise((resolve) => {
        createMutation.mutate(data, {
          onSuccess: (res) => {
            if (res.success && res.data) {
              resolve({ id: res.data.id });
            } else {
              resolve(undefined);
            }
          },
        });
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Stok Kartları</h1>
        </div>
        <Button
          onClick={() => {
            setEditItem(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" />
          Yeni Stok Kartı
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
          filename="stok-kartlari"
          columns={[
            { header: "Kod", accessor: "code" },
            { header: "İsim", accessor: "name" },
            { header: "Tür", accessor: (row: Item) => itemTypeLabels[row.itemType] },
            { header: "Birim", accessor: "unit" },
            { header: "Durum", accessor: (row: Item) => row.isActive ? "Aktif" : "Pasif" },
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

      <ItemFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditItem(null);
        }}
        item={editItem}
        onSubmit={handleSubmit}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />

      <ItemDetailPanel
        itemId={detailItemId}
        isOpen={!!detailItemId}
        onClose={() => setDetailItemId(null)}
      />
    </div>
  );
}
