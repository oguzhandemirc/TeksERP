import { useState, useMemo } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Pencil, Trash2, X, Plus, ShoppingCart, Eye, CheckCircle } from "lucide-react";
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
import { orderService } from "@/services/orderService";
import type { Order } from "@/types/models";
import { orderStatusLabels, OrderStatus } from "@/types/enums";
import OrderFormDialog from "./OrderFormDialog";
import OrderDetailPanel from "./OrderDetailPanel";

const filterConfigs: ColumnFilterConfig[] = [
  {
    id: "status",
    label: "Durum",
    type: "select",
    options: Object.entries(orderStatusLabels).map(([value, label]) => ({
      value,
      label,
    })),
  },
];

const statusColorMap: Record<string, string> = {
  [OrderStatus.PENDING]: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  [OrderStatus.APPROVED]: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  [OrderStatus.IN_PRODUCTION]: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  [OrderStatus.PARTIAL_SHIPPED]: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  [OrderStatus.COMPLETED]: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  [OrderStatus.CANCELLED]: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export default function OrdersPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editOrder, setEditOrder] = useState<Order | null>(null);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);

  const { createMutation, updateMutation, removeMutation, hardRemoveMutation } = useCrudMutations({
    service: orderService,
    queryKey: "orders",
    entityName: "Sipariş",
  });

  const columns = useMemo<ColumnDef<Order, unknown>[]>(
    () => [
      getSelectionColumn<Order>(),
      {
        accessorKey: "orderNumber",
        header: "Sipariş No",
        size: 160,
        cell: ({ getValue }) => (
          <span className="font-medium">{getValue<string>()}</span>
        ),
      },
      {
        id: "customerName",
        header: "Müşteri",
        size: 200,
        cell: ({ row }) =>
          row.original.customer
            ? `${row.original.customer.code} - ${row.original.customer.name}`
            : "—",
      },
      {
        id: "totalMeterage",
        header: "Toplam Metraj",
        size: 140,
        cell: ({ row }) => {
          const total =
            row.original.lines?.reduce((s, l) => s + l.quantity, 0) ?? 0;
          return (
            <span className="font-medium tabular-nums">
              {total.toLocaleString("tr-TR")} mt
            </span>
          );
        },
      },
      {
        id: "orderName",
        header: "Kalem(ler)",
        size: 230,
        cell: ({ row }) => {
          const names = row.original.lines
            ?.map((l) => {
              const base = l.item?.name || "";
              const variant = l.variant?.code ? ` (${l.variant.code})` : "";
              return base + variant;
            })
            .filter(Boolean)
            .join(", ");
          return (
            <span
              className="text-sm text-muted-foreground max-w-[200px] truncate block"
              title={names}
            >
              {names || "—"}
            </span>
          );
        },
      },
      {
        id: "lineCount",
        header: "Kalem",
        size: 80,
        cell: ({ row }) => (
          <Badge variant="outline">{row.original.lines?.length ?? 0}</Badge>
        ),
      },
      {
        accessorKey: "currency",
        header: "Döviz",
        size: 80,
      },
      {
        accessorKey: "totalAmount",
        header: "Tutar",
        size: 130,
        cell: ({ row }) =>
          row.original.totalAmount != null
            ? Number(row.original.totalAmount).toLocaleString("tr-TR", {
                minimumFractionDigits: 2,
              })
            : "—",
      },
      {
        accessorKey: "orderDate",
        header: "Sipariş Tarihi",
        size: 130,
        cell: ({ getValue }) =>
          new Date(getValue<string>()).toLocaleDateString("tr-TR"),
      },
      {
        accessorKey: "deadline",
        header: "Termin",
        size: 120,
        cell: ({ getValue }) => {
          const val = getValue<string | null>();
          if (!val) return "—";
          const d = new Date(val);
          const isOverdue = d < new Date() && !["COMPLETED", "CANCELLED"].includes("");
          return (
            <span className={isOverdue ? "text-destructive font-medium" : ""}>
              {d.toLocaleDateString("tr-TR")}
            </span>
          );
        },
      },
      {
        accessorKey: "status",
        header: "Durum",
        size: 130,
        cell: ({ getValue }) => {
          const val = getValue<string>();
          return (
            <Badge className={statusColorMap[val] ?? ""} variant="secondary">
              {orderStatusLabels[val as keyof typeof orderStatusLabels] ?? val}
            </Badge>
          );
        },
      },
      {
        id: "actions",
        header: "",
        size: 160,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            {row.original.status === "PENDING" && (
              <Button
                variant="ghost"
                size="icon"
                title="Siparişi Onayla"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm("Bu siparişi onaylamak istiyor musunuz?")) {
                    updateMutation.mutate({ id: row.original.id, data: { status: "APPROVED" } as Partial<Order> });
                  }
                }}
              >
                <CheckCircle className="h-4 w-4 text-green-600" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              title="Detay"
              onClick={(e) => {
                e.stopPropagation();
                setDetailOrderId(row.original.id);
              }}
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Düzenle"
              onClick={(e) => {
                e.stopPropagation();
                setEditOrder(row.original);
                setDialogOpen(true);
              }}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="İptal Et"
              onClick={(e) => {
                e.stopPropagation();
                if (
                  confirm(
                    "Bu siparişi iptal etmek istediğinize emin misiniz?",
                  )
                ) {
                  removeMutation.mutate(row.original.id);
                }
              }}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Kalıcı Sil"
              onClick={(e) => {
                e.stopPropagation();
                if (
                  confirm(
                    "DİKKAT: Bu siparişi kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz!",
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
    [updateMutation, removeMutation, hardRemoveMutation],
  );

  const dt = useDataTable({
    queryKey: "orders",
    fetchFn: orderService.getAll,
    columns,
    defaultSortBy: "createdAt",
    defaultSortOrder: "desc",
  });

  const handleSubmit = (data: Record<string, unknown>) => {
    if (editOrder) {
      updateMutation.mutate(
        { id: editOrder.id, data: data as Partial<Order> },
        {
          onSuccess: () => {
            setDialogOpen(false);
            setEditOrder(null);
          },
        },
      );
    } else {
      createMutation.mutate(data as Partial<Order>, {
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
          <ShoppingCart className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Siparişler</h1>
        </div>
        <Button
          onClick={() => {
            setEditOrder(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" />
          Yeni Sipariş
        </Button>
      </div>

      <DataTableToolbar
        search={dt.search}
        onSearchChange={dt.setSearch}
        searchPlaceholder="Sipariş numarası ile ara..."
        filters={filterConfigs}
        activeFilters={dt.activeFilters}
        onFilterChange={dt.setFilter}
        onFilterClear={dt.clearFilter}
        onClearAll={dt.clearAllFilters}
      >
        <DataTableExport
          data={dt.data}
          selectedData={dt.selectedRows}
          filename="siparisler"
          columns={[
            { header: "Sipariş No", accessor: "orderNumber" },
            {
              header: "Müşteri",
              accessor: (row: Order) =>
                row.customer
                  ? `${row.customer.code} - ${row.customer.name}`
                  : "",
            },
            {
              header: "Toplam Metraj",
              accessor: (row: Order) =>
                String(
                  row.lines?.reduce((s, l) => s + l.quantity, 0) ?? 0,
                ) + " mt",
            },
            {
              header: "Kalem(ler)",
              accessor: (row: Order) =>
                row.lines
                  ?.map((l) => l.item?.name)
                  .filter(Boolean)
                  .join(", ") ?? "",
            },
            { header: "Döviz", accessor: "currency" },
            {
              header: "Tutar",
              accessor: (row: Order) =>
                row.totalAmount != null ? String(row.totalAmount) : "",
            },
            {
              header: "Sipariş Tarihi",
              accessor: (row: Order) =>
                new Date(row.orderDate).toLocaleDateString("tr-TR"),
            },
            {
              header: "Termin",
              accessor: (row: Order) =>
                row.deadline
                  ? new Date(row.deadline).toLocaleDateString("tr-TR")
                  : "",
            },
            {
              header: "Durum",
              accessor: (row: Order) =>
                orderStatusLabels[row.status] ?? row.status,
            },
          ]}
        />
      </DataTableToolbar>

      {dt.isLoading ? (
        <DataTableSkeleton columnCount={11} rowCount={10} />
      ) : (
        <DataTable
          table={dt.table}
          columnCount={11}
          isFetching={dt.isFetching}
          onRowClick={(row) => setDetailOrderId(row.id)}
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

      <OrderFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditOrder(null);
        }}
        order={editOrder}
        onSubmit={handleSubmit}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />

      <OrderDetailPanel
        orderId={detailOrderId}
        isOpen={!!detailOrderId}
        onClose={() => setDetailOrderId(null)}
      />
    </div>
  );
}
