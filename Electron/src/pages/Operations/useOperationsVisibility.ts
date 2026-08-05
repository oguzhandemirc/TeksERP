import { useQuery } from "@tanstack/react-query";
import { useShipmentConfirmationEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { sackStoreService } from "./SackStore/service";
import type { OperationsVisibilityContext } from "./tile-config";

/**
 * Operasyon karolarının `visibleWhen` yüklemine geçilecek ÇALIŞMA ANI durumu —
 * TEK KURULUM NOKTASI.
 *
 * İki tüketici var ve ikisi de aynı kararı vermek zorunda: Operasyon hub'ının
 * karo listesi ve KOMUT PALETİ. Bağlamı iki yerde elle kurmak, `ctx`'e yeni bir
 * alan eklendiğinde birinin sessizce eski/eksik değerle karar vermesi demekti;
 * hook tek kurulum noktası olduğu için yeni alan ikisine de aynı anda gelir.
 *
 * Dönüş tipi AÇIK yazılır: bağlama alan eklenip burası güncellenmezse derleme
 * düşer (alan sessizce `undefined` gelip yüklemi yanlış karara sürükleyemez).
 */
export function useOperationsVisibilityContext(): OperationsVisibilityContext {
  const shipmentConfirmationEnabled = useShipmentConfirmationEnabled();
  const { hasPermission } = useRoleAccess();

  // Çıkış bekleyen sevkiyat SONDASI — yalnız karar bunu gerektiriyorsa koşar:
  // bayrak açıksa karo zaten görünür (sorgu gereksiz), izin yoksa uç 403 verir.
  // `limit: 1` yeter — sayı değil VARLIK soruluyor.
  const probeEnabled = !shipmentConfirmationEnabled && hasPermission("shipping:read");
  const pending = useQuery({
    queryKey: ["ops-visibility", "planned-shipments"],
    queryFn: () => sackStoreService.list({ limit: 1 }),
    enabled: probeEnabled,
    staleTime: 60 * 1000,
  });

  return {
    shipmentConfirmationEnabled,
    pendingPlannedShipments: pending.data?.data?.length ?? 0,
  };
}
