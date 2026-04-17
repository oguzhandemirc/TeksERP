import { useState, useMemo } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, ClipboardList, Eye, Trash2, X } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import {
  workOrderService,
  type CreateWorkOrderRequest,
} from "@/services/workOrderService";
import type { WorkOrder } from "@/types/models";
import {
  WorkOrderStatus,
  WorkOrderType,
  workOrderStatusLabels,
  workOrderTypeLabels,
} from "@/types/enums";
import WorkOrderFormDialog from "./WorkOrderFormDialog";
import WorkOrderDetailPanel from "./WorkOrderDetailPanel";

const filterConfigs: ColumnFilterConfig[] = [
  {
    id: "status",
    label: "Durum",
    type: "select",
    options: Object.entries(workOrderStatusLabels).map(([value, label]) => ({
      value,
      label,
    })),
  },
  {
    id: "type",
    label: "Tür",
    type: "select",
    options: Object.entries(workOrderTypeLabels).map(([value, label]) => ({
      value,
      label,
    })),
  },
];

const statusColorMap: Record<string, string> = {
  [WorkOrderStatus.PLANNED]: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  [WorkOrderStatus.IN_PROGRESS]: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  [WorkOrderStatus.PAUSED]: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  [WorkOrderStatus.COMPLETED]: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  [WorkOrderStatus.CANCELLED]: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const typeColorMap: Record<string, string> = {
  [WorkOrderType.ORDER_PRODUCTION]: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  [WorkOrderType.STOCK_PRODUCTION]: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  [WorkOrderType.SAMPLE_PRODUCTION]: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  [WorkOrderType.REPAIR_REWORK]: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

export default function WorkOrdersPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (data: CreateWorkOrderRequest) =>
      workOrderService.create(data),
    onSuccess: (res) => {
      toast.success(res.message ?? "İş emri oluşturuldu");
      qc.invalidateQueries({ queryKey: ["work-orders"] });
      qc.invalidateQueries({ queryKey: ["work-orders-available"] });
      setFormOpen(false);
    },
    onError: () => {
      toast.error("İş emri oluşturulurken hata oluştu");
    },
  });

  const softDeleteMutation = useMutation({
    mutationFn: (id: string) => workOrderService.softDelete(id),
    onSuccess: (res) => {
      toast.success(res.message ?? "İş emri iptal edildi");
      qc.invalidateQueries({ queryKey: ["work-orders"] });
      qc.invalidateQueries({ queryKey: ["work-orders-available"] });
    },
    onError: () => toast.error("İş emri iptal edilirken hata oluştu"),
  });

  const hardDeleteMutation = useMutation({
    mutationFn: (id: string) => workOrderService.hardDelete(id),
    onSuccess: (res) => {
      toast.success(res.message ?? "İş emri kalıcı olarak silindi");
      qc.invalidateQueries({ queryKey: ["work-orders"] });
      qc.invalidateQueries({ queryKey: ["work-orders-available"] });
    },
    onError: () => toast.error("İş emri silinirken hata oluştu"),
  });

  const columns = useMemo<ColumnDef<WorkOrder, unknown>[]>(
    () => [
      getSelectionColumn<WorkOrder>(),
      {
        accessorKey: "batchNumber",
        header: "Parti No",
        size: 180,
        cell: ({ getValue }) => (
          <span className="font-medium">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: "type",
        header: "Tür",
        size: 140,
        cell: ({ getValue }) => {
          const val = getValue<string>();
          return (
            <Badge className={typeColorMap[val] ?? ""} variant="secondary">
              {workOrderTypeLabels[val as WorkOrderType] ?? val}
            </Badge>
          );
        },
      },
      {
        id: "stepCount",
        header: "Adım",
        size: 80,
        cell: ({ row }) => (
          <Badge variant="outline">{row.original.steps?.length ?? 0}</Badge>
        ),
      },
      {
        id: "stepsPreview",
        header: "Rota",
        size: 250,
        cell: ({ row }) => {
          const steps = row.original.steps ?? [];
          if (steps.length === 0)
            return <span className="text-muted-foreground">—</span>;
          return (
            <div className="flex items-center gap-1 flex-wrap">
              {steps
                .sort((a, b) => a.stepSequence - b.stepSequence)
                .slice(0, 3)
                .map((step, idx) => (
                  <span key={step.id} className="flex items-center gap-1">
                    {idx > 0 && (
                      <span className="text-muted-foreground">→</span>
                    )}
                    <Badge variant="secondary" className="text-xs">
                      {step.station?.code ?? "?"}
                    </Badge>
                  </span>
                ))}
              {steps.length > 3 && (
                <span className="text-xs text-muted-foreground">
                  +{steps.length - 3}
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: "orderCount",
        header: "Sipariş",
        size: 80,
        cell: ({ row }) => (
          <Badge variant="outline">
            {row.original.orderLinks?.length ?? 0}
          </Badge>
        ),
      },
      {
        accessorKey: "status",
        header: "Durum",
        size: 130,
        cell: ({ getValue }) => {
          const val = getValue<string>();
          return (
            <Badge
              className={statusColorMap[val] ?? ""}
              variant="secondary"
            >
              {workOrderStatusLabels[val as WorkOrderStatus] ?? val}
            </Badge>
          );
        },
      },
      {
        id: "actions",
        header: "",
        size: 180,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                setDetailId(row.original.id);
              }}
              title="Detay"
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="İptal Et"
              onClick={(e) => {
                e.stopPropagation();
                if (
                  confirm(
                    `"${row.original.batchNumber}" iş emrini iptal etmek istediğinize emin misiniz?`,
                  )
                ) {
                  softDeleteMutation.mutate(row.original.id);
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
                    `DİKKAT: "${row.original.batchNumber}" iş emrini kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz!`,
                  )
                ) {
                  hardDeleteMutation.mutate(row.original.id);
                }
              }}
            >
              <X className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ),
      },
    ],
    [softDeleteMutation, hardDeleteMutation],
  );

  const dt = useDataTable({
    queryKey: "work-orders",
    fetchFn: workOrderService.getAll,
    columns,
    defaultSortBy: "createdAt",
    defaultSortOrder: "desc",
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">İş Emirleri</h1>
        </div>
        <Button onClick={() => setFormOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Yeni İş Emri
        </Button>
      </div>

      <DataTableToolbar
        search={dt.search}
        onSearchChange={dt.setSearch}
        searchPlaceholder="Parti numarası ile ara..."
        filters={filterConfigs}
        activeFilters={dt.activeFilters}
        onFilterChange={dt.setFilter}
        onFilterClear={dt.clearFilter}
        onClearAll={dt.clearAllFilters}
      >
        <DataTableExport
          data={dt.data}
          selectedData={dt.selectedRows}
          filename="is-emirleri"
          columns={[
            { header: "Parti No", accessor: "batchNumber" },
            {
              header: "Tür",
              accessor: (row: WorkOrder) =>
                workOrderTypeLabels[row.type] ?? row.type,
            },
            {
              header: "Adım Sayısı",
              accessor: (row: WorkOrder) =>
                String(row.steps?.length ?? 0),
            },
            {
              header: "Durum",
              accessor: (row: WorkOrder) =>
                workOrderStatusLabels[row.status] ?? row.status,
            },
          ]}
        />
      </DataTableToolbar>

      {dt.isLoading ? (
        <DataTableSkeleton columnCount={7} rowCount={10} />
      ) : (
        <DataTable
          table={dt.table}
          columnCount={7}
          isFetching={dt.isFetching}
          onRowClick={(row) => setDetailId(row.id)}
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

      <WorkOrderFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onSubmit={(data) => createMutation.mutate(data)}
        isLoading={createMutation.isPending}
      />

      {detailId && (
        <WorkOrderDetailPanel
          workOrderId={detailId}
          isOpen={!!detailId}
          onClose={() => setDetailId(null)}
        />
      )}

      </div>
  );
}
