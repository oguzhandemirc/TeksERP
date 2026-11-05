// İş Emirleri → "Varsayılan stok kartı" (`workorder.defaultTargetItemId`). Tek yazar `PUT /api/feature-flags/work-order-default-item`
// (ayar şifresi); kart kapısı sunucuda. Öncelik sunucuda: elle > müşteri varsayılanı > bu kart > gelen belge fabrika varsayılanı.
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, PackageSearch, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGate } from "@/components/PermissionGate";
import { ItemPickerModal } from "@/components/forms/ItemPickerModal";
import { apiErrorText } from "@/lib/api-error";
import { TERIM } from "@/lib/terim";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { DEFAULT_TARGET_ITEM_QUERY_KEY, updateDefaultTargetItem, useDefaultTargetItem } from "@/pages/Operations/WorkOrders/defaultTargetItem";
import { FieldLabel } from "./SettingRow";
import { SETTINGS_ADMIN_PERMISSION } from "./settings-config";

type DraftItem = { id: string; label: string } | null;

export function WorkOrderDefaultItemSection({ writePermissions = [SETTINGS_ADMIN_PERMISSION] }: { writePermissions?: string[] }) {
  const qc = useQueryClient();
  const flagsQ = useFeatureFlags();
  // Üretim kapalıyken uç 403 MODULE_DISABLED verir — sorgu atılmaz.
  const moduleOn = flagsQ.data?.data?.productionEnabled !== false;
  const q = useDefaultTargetItem(moduleOn);
  const server = q.data?.workOrderDefault ?? null;
  const serverItem: DraftItem = server ? { id: server.id, label: `${server.name} — ${server.code}` } : null;
  const [item, setItem] = useState<DraftItem>(serverItem);
  const [picking, setPicking] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setItem(serverItem), [server?.id]);
  const dirty = (item?.id ?? null) !== (server?.id ?? null);

  const mut = useMutation({
    mutationFn: () => updateDefaultTargetItem(item?.id ?? null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: DEFAULT_TARGET_ITEM_QUERY_KEY });
      toast.success("Varsayılan stok kartı kaydedildi.");
    },
  });

  if (flagsQ.isLoading || (moduleOn && q.isLoading)) return <Skeleton className="h-20 w-full" />;
  if (!moduleOn) return null;
  if (q.isError) return <div className="text-sm text-destructive">Varsayılan stok kartı okunamadı: {apiErrorText(q.error, "bilinmeyen hata")}</div>;

  return (
    <PermissionGate anyOf={writePermissions} fallback={null}>
      <div className="mt-6 border-t pt-4" data-testid="wo-default-item-settings">
        <FieldLabel
          htmlFor="wo-default-item"
          label="Varsayılan stok kartı"
          desc={`Hedef kumaşı boş bırakılan stoğa üretim ${TERIM.terbiyeIsEmri.tekilKucuk} bu kartla açılır. Önce elle seçim, sonra müşterinin varsayılan ürünü, sonra bu kart, en son gelen belge varsayılan ürünü geçerlidir. Boş (varsayılan) = bugünkü davranış: hedef kumaş seçilmeden açılmaz.`}
        />
        <div id="wo-default-item" className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" className="max-w-full justify-start truncate" onClick={() => setPicking(true)} data-testid="wo-default-item-button">
            <PackageSearch className="mr-1.5 h-4 w-4 shrink-0" />
            {item?.label ?? "Kart seç (boş)"}
          </Button>
          {item && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setItem(null)} aria-label="Varsayılan stok kartını temizle">
              <X className="mr-1 h-3.5 w-3.5" /> Temizle
            </Button>
          )}
          {dirty && (
            <>
              <Button type="button" size="sm" onClick={() => mut.mutate()} disabled={mut.isPending} data-testid="wo-default-item-save">Kaydet</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setItem(serverItem)} disabled={mut.isPending}>Vazgeç</Button>
            </>
          )}
        </div>
        {server?.problem && !dirty && (
          <div role="alert" className="mt-2 flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Kayıtlı kart şu an kullanılamıyor: {server.problem} Bu durumda hedef kumaşı boş {TERIM.terbiyeIsEmri.tekilKucuk} açılamaz.</span>
          </div>
        )}
        <ItemPickerModal open={picking} onOpenChange={setPicking} allowedTypes={["FABRIC"]} lifecycle="ACTIVE"
          onPick={(row) => { setItem({ id: row.id, label: `${row.name} — ${row.code}` }); setPicking(false); }} />
      </div>
    </PermissionGate>
  );
}
