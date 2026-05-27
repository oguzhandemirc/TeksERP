import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { RefreshButton } from "@/components/RefreshButton";
import { PermissionGate } from "@/components/PermissionGate";
import { useDataTable } from "@/hooks/useDataTable";
import { usePricingEnabled } from "@/hooks/usePricingEnabled";
import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";
import { buildOrderColumns } from "./columns";
import { orderService } from "./service";
import { OrderDetailSheet } from "./OrderDetailSheet";
import { OrderFormDialog } from "./OrderFormDialog";
import { customerService } from "@/pages/Customers/service";
import type { Order } from "./types";
import { generateOrderNumber, type OrderFormValues } from "./schema";

const FILTERS: FilterDef[] = [
  {
    kind: "multi-select",
    key: "status",
    label: "Durum",
    options: [
      { value: "PENDING", label: "Bekliyor" },
      { value: "APPROVED", label: "Onaylı" },
      { value: "PARTIAL_SHIPPED", label: "Kısmi Sevk" },
      { value: "COMPLETED", label: "Tamamlandı" },
      { value: "CANCELLED", label: "İptal" },
    ],
  },
  { kind: "lookup", key: "customerId", label: "Müşteri", service: customerService, queryKey: "customers" },
  {
    kind: "dateRange",
    label: "Tarih",
    defaultField: "createdAt",
    fieldOptions: [
      { value: "createdAt", label: "Sipariş Tarihi" },
      { value: "deadline", label: "Termin" },
    ],
  },
];

const QUERY_KEY = "orders";

interface CreatePayload {
  orderNumber: string;
  customerId: string;
  branchId: string | null;
  currency?: string;
  deadline: string | null;
  lines: {
    itemId: string;
    colorId: string | null;
    quantity: number;
    width: number | null;
    unitPrice?: string | null;
    customerItemName?: string | null;
    customerColorName?: string | null;
    requiredPropertyIds: string[];
  }[];
}

interface UpdateLinePayload {
  /** Mevcut OrderLine.id (update). Yeni satırda undefined (create). */
  id?: string;
  itemId: string;
  colorId: string | null;
  quantity: number;
  width: number | null;
  unitPrice?: string | null;
  customerItemName?: string | null;
  customerColorName?: string | null;
  requiredPropertyIds: string[];
}

interface UpdatePayload {
  customerId?: string;
  branchId?: string | null;
  currency?: string;
  deadline?: string | null;
  /** Kalem listesi (sipariş WO'ya bağlı değilse). Diff backend'de yapılır. */
  lines?: UpdateLinePayload[];
}

function buildCreatePayload(v: OrderFormValues, pricingEnabled: boolean): CreatePayload {
  return {
    orderNumber: generateOrderNumber(),
    customerId: v.customerId,
    branchId: v.branchId || null,
    ...(pricingEnabled ? { currency: v.currency.trim().toUpperCase() } : {}),
    deadline: v.deadline ? new Date(v.deadline).toISOString() : null,
    lines: v.lines.map((l) => ({
      itemId: l.itemId,
      colorId: l.colorId ?? null,
      quantity: l.quantity,
      width: l.width ?? null,
      ...(pricingEnabled
        ? { unitPrice: l.unitPrice ? String(l.unitPrice) : null }
        : {}),
      customerItemName: l.customerItemName?.trim() ? l.customerItemName.trim() : null,
      customerColorName: l.customerColorName?.trim() ? l.customerColorName.trim() : null,
      requiredPropertyIds: l.requiredPropertyIds ?? [],
    })),
  };
}

function buildUpdatePayload(
  v: OrderFormValues,
  pricingEnabled: boolean,
  editing: Order,
): UpdatePayload {
  // Kalemler ne zaman gönderilir: sipariş PARTIAL_SHIPPED değil + hiçbir kalem
  // aktif (CANCELLED dışı) bir WO'ya bağlı değil. Dialog aynı kontrolü yapıp
  // editor'u açıyor; backend de aynı kontrolü tekrar enforce ediyor.
  const linesEditable =
    editing.status !== "PARTIAL_SHIPPED" &&
    editing.lines.every((l) =>
      (l.workOrderLinks ?? []).every((link) => link.workOrder.status === "CANCELLED"),
    );

  const existingIds = new Set(editing.lines.map((l) => l.id));

  return {
    customerId: v.customerId,
    branchId: v.branchId ?? null,
    ...(pricingEnabled ? { currency: v.currency.trim().toUpperCase() } : {}),
    deadline: v.deadline ? new Date(v.deadline).toISOString() : null,
    ...(linesEditable
      ? {
          lines: v.lines.map((l) => ({
            // Form'daki clientId existing line id'siyle eşleşiyorsa update,
            // değilse yeni satır (id verilmez).
            ...(existingIds.has(l.clientId) ? { id: l.clientId } : {}),
            itemId: l.itemId,
            colorId: l.colorId ?? null,
            quantity: l.quantity,
            width: l.width ?? null,
            ...(pricingEnabled
              ? { unitPrice: l.unitPrice ? String(l.unitPrice) : null }
              : {}),
            customerItemName: l.customerItemName?.trim() ? l.customerItemName.trim() : null,
            customerColorName: l.customerColorName?.trim() ? l.customerColorName.trim() : null,
            requiredPropertyIds: l.requiredPropertyIds ?? [],
          })),
        }
      : {}),
  };
}

export function OrdersPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Order | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);

  const pricingEnabled = usePricingEnabled();
  const columns = useMemo(() => buildOrderColumns(pricingEnabled), [pricingEnabled]);

  const { table, query, search, setSearch, pagination } = useDataTable<Order>({
    queryKey: QUERY_KEY,
    fetchFn: orderService.listCursor,
    columns,
    defaultPageSize: 50,
  });

  const createMut = useMutation({
    mutationFn: (payload: CreatePayload) =>
      orderService.create(payload as unknown as Partial<Order>),
    onSuccess: () => {
      toast.success("Sipariş oluşturuldu.");
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
      setFormOpen(false);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdatePayload }) =>
      orderService.update(id, payload as unknown as Partial<Order>),
    onSuccess: () => {
      toast.success("Sipariş güncellendi.");
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
      setFormOpen(false);
      setEditing(null);
      setSelected(null);
    },
  });

  const handleEdit = (order: Order) => {
    setEditing(order);
    setSelected(null);
    setFormOpen(true);
  };

  const handleFormClose = (open: boolean) => {
    setFormOpen(open);
    if (!open) setEditing(null);
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Siparişler"
        description="Müşteri siparişleri ve termin takibi."
        actions={
          <>
            <RefreshButton queryKey={QUERY_KEY} />
            <PermissionGate permission="order:write">
              <Button size="sm" onClick={() => setFormOpen(true)}>
                <Plus className="h-4 w-4" /> Yeni Sipariş
              </Button>
            </PermissionGate>
          </>
        }
      />

      <DataTableToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Sipariş numarası ara..."
      />
      <FilterBar filters={FILTERS} defaultDateRangeDays={30} />

      <DataTable<Order>
        table={table}
        isLoading={query.isLoading}
        pagination={pagination}
        emptyText="Sipariş bulunamadı."
        onRowClick={setSelected}
      />

      <OrderDetailSheet
        order={selected}
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
        onEdit={handleEdit}
      />

      <OrderFormDialog
        open={formOpen}
        onOpenChange={handleFormClose}
        order={editing}
        onSubmit={async (v) => {
          if (editing) {
            await updateMut.mutateAsync({
              id: editing.id,
              payload: buildUpdatePayload(v, pricingEnabled, editing),
            });
          } else {
            await createMut.mutateAsync(buildCreatePayload(v, pricingEnabled));
          }
        }}
        isSubmitting={createMut.isPending || updateMut.isPending}
      />
    </div>
  );
}
