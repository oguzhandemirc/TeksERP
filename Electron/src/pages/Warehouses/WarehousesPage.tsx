import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CrudPage } from "@/components/layout/CrudPage";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { WAREHOUSES_QUERY_KEY } from "@/hooks/useWarehouses";
import { buildWarehouseColumns } from "./columns";
import { setDefaultWarehouse, warehouseService } from "./service";
import { WarehouseFormDialog } from "./WarehouseFormDialog";
import type { Warehouse } from "./types";
import type { WarehouseFormValues } from "./schema";

/**
 * DEPOLAR — fiziksel depo tanımları.
 *
 * ⚠️ Bu sayfa "tek depo varken gizle" kuralının DIŞINDADIR ve olmak zorundadır:
 * ikinci depoyu yaratmanın tek yolu burasıdır. Görünürlüğü izinle sınırlıdır
 * (`warehouse:read`), tek depolu fabrikada yalnız o izni taşıyan yönetici görür.
 */
export function WarehousesPage() {
  const { hasPermission } = useRoleAccess();
  const canWrite = hasPermission("warehouse:write");
  const qc = useQueryClient();

  const setDefaultM = useMutation({
    mutationFn: (w: Warehouse) => setDefaultWarehouse(w.id),
    onSuccess: (_d, w) => {
      toast.success(`"${w.name}" varsayılan depo yapıldı.`);
      void qc.invalidateQueries({ queryKey: ["warehouses"] });
      void qc.invalidateQueries({ queryKey: WAREHOUSES_QUERY_KEY });
    },
    // Hata toast'ı apiClient interceptor'ından gelir (mutation'da tekrar yazma).
  });

  const columns = useMemo(
    () =>
      buildWarehouseColumns({
        canWrite,
        onSetDefault: (w) => setDefaultM.mutate(w),
        isSettingDefault: setDefaultM.isPending,
      }),
    [canWrite, setDefaultM],
  );

  const buildPayload = (v: WarehouseFormValues, initial: Warehouse | null): Partial<Warehouse> => ({
    // Kod backend'de üretilir (DP+GGAAYY+NNNN); create'te gönderilmez, edit'te korunur.
    ...(initial?.code ? { code: initial.code } : {}),
    name: v.name,
    address: v.address || null,
    notes: v.notes || null,
    isActive: v.isActive,
  });

  return (
    <CrudPage<Warehouse>
      title="Depolar"
      description="Fiziksel depo tanımları. Deposu belirtilmeyen her giriş VARSAYILAN depoya yazılır; ikinci depo açıldığında depo seçicileri ve transfer ekranı kendiliğinden görünür."
      entityName="Depo"
      queryKey="warehouses"
      service={warehouseService}
      columns={columns}
      writePermission="warehouse:write"
      searchPlaceholder="Kod veya depo adı ara..."
      permanentDelete={{
        description: (row) =>
          `"${row.name}" deposu KALICI olarak silinecek. İçinde top, mal kabul fişi, transfer ya da depo hareketi varsa silme reddedilir.`,
      }}
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <WarehouseFormDialog
          open={open}
          onOpenChange={onOpenChange}
          initial={initial}
          isSubmitting={isSubmitting}
          onSubmit={(values) => onSubmit(buildPayload(values, initial))}
        />
      )}
    />
  );
}
