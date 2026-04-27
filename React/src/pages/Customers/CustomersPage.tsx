import { useState, useMemo } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Pencil, Trash2, X, Plus, Users, RefreshCw } from "lucide-react";
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
import { customerService } from "@/services/customerService";
import type { Customer } from "@/types/models";
import { companyTypeLabels, CompanyType } from "@/types/enums";
import CustomerFormDialog from "./CustomerFormDialog";
import CustomerDetailPanel from "./CustomerDetailPanel";
import { Eye } from "lucide-react";

const filterConfigs: ColumnFilterConfig[] = [
  {
    id: "type",
    label: "Tür",
    type: "select",
    options: Object.entries(companyTypeLabels).map(([value, label]) => ({
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
  [CompanyType.CUSTOMER]: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  [CompanyType.SUPPLIER]: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  [CompanyType.SUBCONTRACTOR]: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

export default function CustomersPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [detailCustomerId, setDetailCustomerId] = useState<string | null>(null);

  const { createMutation, updateMutation, removeMutation, hardRemoveMutation, activateMutation } = useCrudMutations({
    service: customerService,
    queryKey: "customers",
    entityName: "Müşteri",
    relatedKeys: ["customer-detail"],
  });

  const columns = useMemo<ColumnDef<Customer, unknown>[]>(
    () => [
      getSelectionColumn<Customer>(),
      {
        accessorKey: "code",
        header: "Kod",
        size: 130,
      },
      {
        accessorKey: "name",
        header: "İsim",
        size: 250,
      },
      {
        accessorKey: "taxNumber",
        header: "Vergi No",
        size: 140,
        cell: ({ getValue }) => getValue<string | null>() ?? "—",
      },
      {
        accessorKey: "type",
        header: "Tür",
        size: 140,
        cell: ({ getValue }) => {
          const val = getValue<string>();
          return (
            <Badge className={typeColorMap[val] ?? ""} variant="secondary">
              {companyTypeLabels[val as keyof typeof companyTypeLabels] ?? val}
            </Badge>
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
                setDetailCustomerId(row.original.id);
              }}
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                setEditCustomer(row.original);
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
                  if (confirm("Bu müşteriyi pasife almak istediğinize emin misiniz?")) {
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
                  if (confirm("Bu müşteriyi tekrar aktif etmek istediğinize emin misiniz?")) {
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
                if (confirm("DİKKAT: Bu müşteriyi kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz!")) {
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
    queryKey: "customers",
    fetchFn: customerService.getAll,
    columns,
    defaultSortBy: "code",
    defaultSortOrder: "asc",
  });

  const handleSubmit = (data: Partial<Customer>) => {
    if (editCustomer) {
      updateMutation.mutate(
        { id: editCustomer.id, data },
        { onSuccess: () => { setDialogOpen(false); setEditCustomer(null); } },
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
          <Users className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Müşteriler</h1>
        </div>
        <Button
          onClick={() => {
            setEditCustomer(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" />
          Yeni Müşteri
        </Button>
      </div>

      <DataTableToolbar
        search={dt.search}
        onSearchChange={dt.setSearch}
        searchPlaceholder="Kod, isim veya vergi no ile ara..."
        filters={filterConfigs}
        activeFilters={dt.activeFilters}
        onFilterChange={dt.setFilter}
        onFilterClear={dt.clearFilter}
        onClearAll={dt.clearAllFilters}
      >
        <DataTableExport
          data={dt.data}
          selectedData={dt.selectedRows}
          filename="musteriler"
          columns={[
            { header: "Kod", accessor: "code" },
            { header: "İsim", accessor: "name" },
            { header: "Vergi No", accessor: "taxNumber" },
            { header: "Tür", accessor: (row: Customer) => companyTypeLabels[row.type] },
            { header: "Durum", accessor: (row: Customer) => row.isActive ? "Aktif" : "Pasif" },
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

      <CustomerFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditCustomer(null);
        }}
        customer={editCustomer}
        onSubmit={handleSubmit}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />

      <CustomerDetailPanel
        customerId={detailCustomerId}
        isOpen={!!detailCustomerId}
        onClose={() => setDetailCustomerId(null)}
      />
    </div>
  );
}
