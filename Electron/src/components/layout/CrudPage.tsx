import { useMemo, useState, type ReactNode } from "react";
import { Plus, Pencil, Trash2, RotateCcw } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { RefreshButton } from "@/components/RefreshButton";
import { useDataTable } from "@/hooks/useDataTable";
import { useCrudMutations } from "@/hooks/useCrudMutations";
import { PermissionGate } from "@/components/PermissionGate";
import type { CrudService } from "@/services/crudService";

interface Props<T extends { id: string }> {
  title: string;
  description?: string;
  entityName: string;
  queryKey: string;
  service: CrudService<T>;
  columns: ColumnDef<T>[];
  searchPlaceholder?: string;
  writePermission: string;
  /** Backend filter'larına eklenir (queryKey'e otomatik dahil edilir). */
  extraFilters?: Record<string, string>;
  /** Toolbar yanında render edilecek ek UI (filtre dropdown'ları vb.). */
  filterBar?: ReactNode;
  /** Kayıt yokken "Yeni" butonunu glow animasyonuyla vurgula. */
  glowWhenEmpty?: boolean;
  /** Üst PageHeader'ı gizle (bir sekmeye gömülürken çift başlığı önler) —
   * Yenile/Yeni butonları araç çubuğuna taşınır. */
  hideHeader?: boolean;
  renderForm: (params: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initial: T | null;
    onSubmit: (values: Partial<T>) => Promise<void>;
    isSubmitting: boolean;
  }) => ReactNode;
}

export function CrudPage<T extends { id: string }>({
  title,
  description,
  entityName,
  queryKey,
  service,
  columns,
  searchPlaceholder,
  writePermission,
  extraFilters,
  filterBar,
  glowWhenEmpty,
  hideHeader,
  renderForm,
}: Props<T>) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const forceFilters = useMemo<Record<string, string>>(
    () => ({
      ...(showInactive ? {} : { isActive: "true" }),
      ...extraFilters,
    }),
    [showInactive, extraFilters],
  );

  const { createMutation, updateMutation, removeMutation, restoreMutation } = useCrudMutations<T>({
    service,
    queryKey,
    entityName,
  });

  const { table, query, search, setSearch, pagination } = useDataTable<T>({
    queryKey,
    fetchFn: service.listCursor,
    forceFilters,
    columns: [
      ...columns,
      {
        id: "actions",
        header: "",
        size: 80,
        cell: ({ row }) => {
          const isActive = (row.original as { isActive?: boolean }).isActive !== false;
          return (
            <div className="flex justify-end gap-1">
              <PermissionGate permission={writePermission}>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(row.original);
                    setFormOpen(true);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {isActive ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRemovingId(row.original.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-primary"
                    title="Aktifleştir"
                    disabled={restoreMutation.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      restoreMutation.mutate(row.original.id);
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                )}
              </PermissionGate>
            </div>
          );
        },
      },
    ],
  });

  const onSubmit = async (values: Partial<T>) => {
    if (editing) await updateMutation.mutateAsync({ id: editing.id, data: values });
    else await createMutation.mutateAsync(values);
    setFormOpen(false);
    setEditing(null);
  };

  const isEmpty = glowWhenEmpty && query.isSuccess && !search && !showInactive && pagination.total === 0;

  const headerActions = (
    <>
      <RefreshButton queryKey={queryKey} />
      <PermissionGate permission={writePermission}>
        <Button
          size="sm"
          className={isEmpty ? "animate-pulse" : undefined}
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" /> Yeni
        </Button>
      </PermissionGate>
    </>
  );

  return (
    <div className="flex h-full flex-col">
      {!hideHeader && (
        <PageHeader title={title} description={description} actions={headerActions} />
      )}

      <DataTableToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder={searchPlaceholder}
        table={table}
        exportName={title}
        actions={
          <>
            {hideHeader && headerActions}
            {filterBar}
            <label className="flex h-8 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md border bg-background px-3 text-xs">
              <Checkbox
                checked={showInactive}
                onCheckedChange={(c) => setShowInactive(Boolean(c))}
              />
              Pasifleri göster
            </label>
          </>
        }
      />

      <DataTable<T>
        table={table}
        isLoading={query.isLoading}
        pagination={pagination}
        emptyText="Kayıt bulunamadı."
      />

      {renderForm({
        open: formOpen,
        onOpenChange: (open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        },
        initial: editing,
        onSubmit,
        isSubmitting: createMutation.isPending || updateMutation.isPending,
      })}

      <ConfirmDialog
        open={Boolean(removingId)}
        onOpenChange={(open) => !open && setRemovingId(null)}
        title={`${entityName} sil`}
        description="Bu işlem kaydı pasife alır. Devam etmek istiyor musun?"
        confirmLabel="Sil"
        destructive
        isPending={removeMutation.isPending}
        onConfirm={async () => {
          if (!removingId) return;
          await removeMutation.mutateAsync(removingId);
          setRemovingId(null);
        }}
      />
    </div>
  );
}
