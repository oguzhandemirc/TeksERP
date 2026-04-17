import { useMemo } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { ScrollText, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  DataTableToolbar,
  DataTablePagination,
  DataTableSkeleton,
  DataTableExport,
  type ColumnFilterConfig,
} from "@/components/data-table";
import { useDataTable } from "@/hooks/useDataTable";
import { systemLogService } from "@/services/systemLogService";
import type { SystemLog } from "@/types/models";

const actionColorMap: Record<string, string> = {
  CREATE: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  UPDATE: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  DELETE: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const actionLabels: Record<string, string> = {
  CREATE: "Oluşturma",
  UPDATE: "Güncelleme",
  DELETE: "Silme",
};

const filterConfigs: ColumnFilterConfig[] = [
  {
    id: "action",
    label: "İşlem",
    type: "select",
    options: [
      { value: "CREATE", label: "Oluşturma" },
      { value: "UPDATE", label: "Güncelleme" },
      { value: "DELETE", label: "Silme" },
    ],
  },
  {
    id: "tableName",
    label: "Tablo",
    type: "select",
    options: [
      { value: "USER", label: "Kullanıcı" },
      { value: "ORDER", label: "Sipariş" },
      { value: "ROLL", label: "Top" },
      { value: "WORK_ORDER_STEP", label: "İş Emri Adımı" },
      { value: "ROLL_ERROR", label: "Top Hatası" },
      { value: "SHIPMENT", label: "Sevkiyat" },
      { value: "ORDER_ALLOCATION", label: "Tahsis" },
    ],
  },
];

export default function SystemLogsPage() {
  const columns = useMemo<ColumnDef<SystemLog>[]>(
    () => [
      {
        accessorKey: "createdAt",
        header: "Tarih",
        size: 160,
        cell: ({ getValue }) =>
          new Date(getValue<string>()).toLocaleString("tr-TR"),
      },
      {
        accessorKey: "action",
        header: "İşlem",
        size: 120,
        cell: ({ getValue }) => {
          const action = getValue<string>();
          return (
            <Badge className={actionColorMap[action] ?? ""}>
              {actionLabels[action] ?? action}
            </Badge>
          );
        },
      },
      {
        accessorKey: "tableName",
        header: "Tablo",
        size: 150,
        cell: ({ getValue }) => (
          <span className="font-mono text-xs">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: "recordId",
        header: "Kayıt ID",
        size: 120,
        cell: ({ getValue }) => (
          <span className="font-mono text-xs truncate block max-w-[120px]">
            {getValue<string>().slice(0, 8)}...
          </span>
        ),
      },
      {
        id: "user",
        header: "Kullanıcı",
        size: 150,
        cell: ({ row }) => {
          const user = row.original.user;
          return user ? (
            <span>{user.fullName ?? user.username}</span>
          ) : (
            <span className="text-muted-foreground">Sistem</span>
          );
        },
      },
      {
        id: "actions",
        header: "",
        size: 50,
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              const log = row.original;
              const detail = {
                id: log.id,
                action: log.action,
                tableName: log.tableName,
                recordId: log.recordId,
                oldData: log.oldData,
                newData: log.newData,
                user: log.user,
                createdAt: log.createdAt,
              };
              alert(JSON.stringify(detail, null, 2));
            }}
            title="Detay"
          >
            <Eye className="h-4 w-4" />
          </Button>
        ),
      },
    ],
    [],
  );

  const dt = useDataTable({
    queryKey: "system-logs",
    fetchFn: (params) => systemLogService.getAll(params),
    columns,
  });

  if (dt.isLoading) {
    return <DataTableSkeleton columnCount={6} rowCount={12} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ScrollText className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">Sistem Logları</h1>
      </div>

      <DataTableToolbar
        search={dt.search}
        onSearchChange={dt.setSearch}
        searchPlaceholder="Tablo, kayıt ID ara..."
        filters={filterConfigs}
        activeFilters={dt.activeFilters}
        onFilterChange={dt.setFilter}
        onFilterClear={dt.clearFilter}
        onClearAll={dt.clearAllFilters}
      >
        <DataTableExport
          data={dt.data}
          selectedData={dt.selectedRows}
          columns={[
            { header: "Tarih", accessor: (row: SystemLog) => new Date(row.createdAt).toLocaleString("tr-TR") },
            { header: "İşlem", accessor: (row: SystemLog) => actionLabels[row.action] ?? row.action },
            { header: "Tablo", accessor: "tableName" },
            { header: "Kayıt ID", accessor: "recordId" },
            { header: "Kullanıcı", accessor: (row: SystemLog) => row.user?.fullName ?? "-" },
          ]}
          filename="sistem-loglari"
        />
      </DataTableToolbar>

      <DataTable table={dt.table} columnCount={6} isFetching={dt.isFetching} />

      <DataTablePagination
        page={dt.pagination.page}
        pageSize={dt.pagination.pageSize}
        total={dt.pagination.total}
        totalPages={dt.pagination.totalPages}
        onPageChange={dt.setPage}
        onPageSizeChange={dt.setPageSize}
        selectedCount={dt.selectedCount}
      />
    </div>
  );
}
