import { useMemo, useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Shield, Plus, UserCheck, UserX } from "lucide-react";
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
import { userService } from "@/services/userService";
import type { User } from "@/types/models";
import RegisterDialog from "./RegisterDialog";

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

export default function UsersPage() {
  const [registerOpen, setRegisterOpen] = useState(false);

  const columns = useMemo<ColumnDef<User>[]>(
    () => [
      {
        accessorKey: "fullName",
        header: "Ad Soyad",
        size: 200,
        cell: ({ getValue }) => (
          <span className="font-medium">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: "username",
        header: "Kullanıcı Adı",
        size: 160,
        cell: ({ getValue }) => (
          <span className="font-mono text-sm">{getValue<string>()}</span>
        ),
      },
      {
        id: "roles",
        header: "Roller",
        size: 200,
        cell: ({ row }) => {
          const roles = row.original.roles;
          if (!roles || roles.length === 0) {
            return (
              <span className="text-muted-foreground text-sm">Rol yok</span>
            );
          }
          return (
            <div className="flex gap-1 flex-wrap">
              {roles.map((ur) => (
                <Badge key={ur.role.id} variant="secondary" className="text-xs">
                  {ur.role.name}
                </Badge>
              ))}
            </div>
          );
        },
      },
      {
        accessorKey: "isActive",
        header: "Durum",
        size: 100,
        cell: ({ getValue }) => {
          const isActive = getValue<boolean>();
          return isActive ? (
            <div className="flex items-center gap-1 text-green-600">
              <UserCheck className="h-4 w-4" />
              <span className="text-sm">Aktif</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-red-600">
              <UserX className="h-4 w-4" />
              <span className="text-sm">Pasif</span>
            </div>
          );
        },
      },
      {
        accessorKey: "createdAt",
        header: "Kayıt Tarihi",
        size: 140,
        cell: ({ getValue }) =>
          new Date(getValue<string>()).toLocaleDateString("tr-TR"),
      },
    ],
    [],
  );

  const dt = useDataTable({
    queryKey: "users",
    fetchFn: (params) => userService.getAll(params),
    columns,
    defaultSortBy: "fullName",
    defaultSortOrder: "asc",
  });

  if (dt.isLoading) {
    return <DataTableSkeleton columnCount={5} rowCount={8} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Kullanıcılar</h1>
        </div>
        <Button onClick={() => setRegisterOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Yeni Kullanıcı
        </Button>
      </div>

      <DataTableToolbar
        search={dt.search}
        onSearchChange={dt.setSearch}
        searchPlaceholder="Ad, kullanıcı adı ara..."
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
            { header: "Ad Soyad", accessor: "fullName" },
            { header: "Kullanıcı Adı", accessor: "username" },
            { header: "Roller", accessor: (row: User) => row.roles?.map((ur) => ur.role.name).join(", ") ?? "-" },
            { header: "Durum", accessor: (row: User) => (row.isActive ? "Aktif" : "Pasif") },
            { header: "Kayıt Tarihi", accessor: (row: User) => new Date(row.createdAt).toLocaleDateString("tr-TR") },
          ]}
          filename="kullanicilar"
        />
      </DataTableToolbar>

      <DataTable table={dt.table} columnCount={5} isFetching={dt.isFetching} />

      <DataTablePagination
        page={dt.pagination.page}
        pageSize={dt.pagination.pageSize}
        total={dt.pagination.total}
        totalPages={dt.pagination.totalPages}
        onPageChange={dt.setPage}
        onPageSizeChange={dt.setPageSize}
        selectedCount={dt.selectedCount}
      />

      <RegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} />
    </div>
  );
}
