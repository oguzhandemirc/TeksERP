import { useShipmentConfirmationEnabled } from "@/hooks/usePricingEnabled";
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
  return { shipmentConfirmationEnabled };
}
