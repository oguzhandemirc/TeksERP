import { useQuery } from "@tanstack/react-query";
import { useShipmentConfirmationEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useMultiWarehouse } from "@/hooks/useWarehouses";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
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
 *
 * 2026-08-22: çıkış bekleyen sevkiyat SONDASI (`sack-store/board?limit=1`) kalktı —
 * Sevk Kapısı karosu artık yalnız bayrağa bakıyor (gerekçe `tile-config.ts`'te).
 */
export function useOperationsVisibilityContext(): OperationsVisibilityContext {
  const shipmentConfirmationEnabled = useShipmentConfirmationEnabled();
  const { hasPermission } = useRoleAccess();
  const { multiWarehouse } = useMultiWarehouse();
  const flagsQuery = useFeatureFlags();
  const financeEnabled = flagsQuery.data?.data?.financeEnabled ?? false;
  // Backend varsayılanı AÇIK — belirsizken de açık kabul edilir (panelin her
  // yerindeki yazım: `productionEnabled ?? true`).
  const productionEnabled = flagsQuery.data?.data?.productionEnabled ?? true;

  // ⚠️ ÇIKIŞ BEKLEYEN SEVKİYAT SONDASI KALDIRILDI (2026-09-01, birleştirme).
  // 2026-08-22 kararı Sevk Kapısı karosunu SAF BAYRAĞA bağladı ve `sack-store/
  // board?limit=1` sondasını kaldırdı. Birleştirmede kararın yalnız YARISI
  // taşındı: karo yüklemi düzeltilmişti ama bağlam alanı ve onu besleyen sorgu
  // depo dalından hayatta kaldı — Operasyon hub'ı her açılışta KİMSENİN
  // OKUMADIĞI bir istek atıyordu.
  return {
    shipmentConfirmationEnabled,
    financeEnabled,
    productionEnabled,
    // Tek kaynak `useMultiWarehouse` — karar burada YENİDEN hesaplanmaz
    // (kopyalansa biri gün gelir "aktif" süzgecini unuturdu).
    multiWarehouse,
  };
}
