// Mal Kabul & Alış → "Emanet varsayılan deposu" (genel fason P1). Müşterinin malı depo söylenmeden doğunca (gelen belge
// onayı, sahipli KK1, fason kabulü) girdiği depo. Emanet kapalıyken bölüm çizilmez; açık depo seçimi her zaman kazanır.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Warehouse as WarehouseIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGate } from "@/components/PermissionGate";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { apiErrorText } from "@/lib/api-error";
import { useEmanetEnabled } from "@/hooks/usePricingEnabled";
import { warehouseService } from "@/pages/Warehouses/service";
import type { Warehouse } from "@/pages/Warehouses/types";
import { FieldLabel } from "./SettingRow";
import { SETTINGS_ADMIN_PERMISSION } from "./settings-config";
import { EMANET_DEFAULT_WAREHOUSE_QUERY_KEY, getEmanetDefaultWarehouse, updateEmanetDefaultWarehouse } from "./emanetDefaultWarehouse";

/** Bölüm başlığı — backend "şuradan düzeltin" cümlesi bu başlığı anar (`emanet-warehouse.helper`). */
export const EMANET_DEFAULT_WAREHOUSE_TITLE = "Emanet varsayılan deposu";

export function EmanetDefaultWarehouseSection({ writePermissions = [SETTINGS_ADMIN_PERMISSION] }: { writePermissions?: string[] }) {
  const qc = useQueryClient();
  const emanetOn = useEmanetEnabled();
  const q = useQuery({ queryKey: EMANET_DEFAULT_WAREHOUSE_QUERY_KEY, queryFn: getEmanetDefaultWarehouse, enabled: emanetOn, retry: false });
  const serverId = q.data?.warehouse?.id ?? null;
  const [draft, setDraft] = useState<string | null>(serverId);
  useEffect(() => setDraft(serverId), [serverId]);
  const dirty = draft !== serverId;

  const mut = useMutation({
    mutationFn: () => updateEmanetDefaultWarehouse(draft),
    onSuccess: (view) => {
      qc.setQueryData(EMANET_DEFAULT_WAREHOUSE_QUERY_KEY, view);
      toast.success(view.warehouse ? `Emanet deposu: ${view.warehouse.name}` : "Emanet deposu boşaltıldı — varsayılan depo kullanılır.");
    },
    // onError YOK: 400 (pasif depo) metnini apiClient tek toast'la basar.
  });

  if (!emanetOn) return null;
  if (q.isLoading) return <Skeleton className="h-20 w-full" />;
  if (q.isError) return <div className="text-sm text-destructive">Emanet deposu ayarı okunamadı: {apiErrorText(q.error, "bilinmeyen hata")}</div>;

  return (
    <PermissionGate anyOf={writePermissions} fallback={null}>
      <div className="mt-6 border-t pt-4" data-testid="emanet-default-warehouse-settings">
        <FieldLabel
          htmlFor="emanet-default-warehouse"
          label={EMANET_DEFAULT_WAREHOUSE_TITLE}
          desc="Müşterinin malı (emanet) depo söylenmeden doğunca — gelen belge onayı, sahibi seçilmiş top girişi, emanet fason dönüşü — bu depoya girer. Boş (varsayılan) = bugünkü davranış: varsayılan depo. Mal kabulde açıkça seçilen depo her zaman kazanır. Kayıtlı depo pasife alınamaz."
        />
        <p className="mt-0.5 text-xs text-muted-foreground">Müşteri malı depo söylenmeden doğunca bu depoya girer. Boş = varsayılan depo (bugünkü davranış).</p>
        <div id="emanet-default-warehouse" className="mt-2 flex flex-wrap items-center gap-2">
          <div className="w-72 max-w-full">
            <EntityPickerModal<Warehouse>
              value={draft}
              onChange={(id) => setDraft(id)}
              service={warehouseService}
              queryKey="warehouses-emanet-default"
              getLabel={(w) => w.name}
              getSubLabel={(w) => (w.isDefault ? `${w.code} · varsayılan depo` : w.code)}
              nullable
              noneLabel="— Boş (varsayılan depo)"
              icon={WarehouseIcon}
              placeholder="Boş — varsayılan depo"
              title="Emanet deposu seç"
              description="Yalnız aktif depolar listelenir."
              countLabel="depo"
            />
          </div>
          {dirty && (
            <>
              <Button type="button" size="sm" onClick={() => mut.mutate()} disabled={mut.isPending} data-testid="emanet-default-warehouse-save">Kaydet</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(serverId)} disabled={mut.isPending}>Vazgeç</Button>
            </>
          )}
        </div>
        {q.data?.problem && !dirty && (
          <div role="alert" className="mt-2 flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Kayıtlı depo şu an kullanılamıyor: {q.data.problem} Bu durumda emanet mal girişi durur — başka bir depo seçin ya da boşaltın.</span>
          </div>
        )}
      </div>
    </PermissionGate>
  );
}
