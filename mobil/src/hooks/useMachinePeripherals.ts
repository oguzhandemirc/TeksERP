import { useQuery } from '@tanstack/react-query';
import { peripheralService, type DevicePeripheral } from '../services/peripheral.service';
import { useSessionStore } from '../store/sessionStore';

// =============================================================================
// AKTİF ÇALIŞMA OTURUMUNUN YERİNE sabit cihazlar (METER/SCALE) backend'den
// çözülür (for-session): makine-oturumu → makine donanımı, makinesiz istasyon-
// oturumu (SHIPPING) → istasyon donanımı. Oturum yoksa hiç sorulmaz (fail-closed;
// SessionGate zaten yer onayı ister). queryKey oturum id'siyle anahtarlı —
// operatör makine değiştirince donanım kendiliğinden tazelenir.
// Cihaz seçimi device-local DEĞİL — admin Makine/Donanım kaydında.
// =============================================================================

export function useMachinePeripherals(kind: 'METER' | 'SCALE'): DevicePeripheral[] {
  const sessionId = useSessionStore((s) => s.active?.id ?? null);
  const q = useQuery({
    queryKey: ['peripherals', 'for-session', kind, sessionId],
    queryFn: () => peripheralService.getForSession(kind),
    staleTime: 5 * 60 * 1000,
    enabled: sessionId != null,
  });
  return q.data ?? [];
}

/**
 * foldType → ilgili metre cihazı (cihazın `role`'ü kat KODUDUR). Yoksa null.
 *
 * ⚠️ 2026-08-10 — SAPMA KALDIRILDI. Eski hâli şuydu:
 *     const want = foldType === '4-KAT' ? '4-KAT' : '2-KAT';
 * yani ÜÇLÜ bir kararı ikiliye indiriyordu. Kat kataloğa taşınıp fabrika
 * "6-KAT" ekleyince 6 katlı top **2-KAT metresiyle** ölçülürdü: hata yok, log
 * yok, sadece YANLIŞ METRAJ. (Aynı sapma "TÜP" değerinde de vardı.)
 *
 * Yeni kural: rol BİREBİR eşleşir. Eşleşme yoksa **başka cihaza SAPMAZ** — null
 * döner ve çağıran "bu kat için metre tanımlı değil, elle girin" der. Rolsüz
 * cihaza düşme dalı da kaldırıldı: kat ayrımı olan bir istasyonda "rolsüz metre"
 * hangi kata ait olduğu bilinmeyen bir cihazdır; ona güvenmek sessizce yanlış
 * ölçmenin ta kendisiydi. Tek metreli istasyonlar `primaryMeterFor` kullanır.
 *
 * Karşılaştırma `toUpperCase()` ile (locale-bağımsız) — backend katalog kodunu
 * da böyle karşılaştırıyor.
 */
export function meterPeripheralFor(
  rows: DevicePeripheral[],
  foldType: string | null | undefined,
): DevicePeripheral | null {
  const want = (foldType ?? '').trim().toUpperCase();
  if (!want) return null;
  return rows.find((r) => (r.role ?? '').toUpperCase() === want) ?? null;
}

/**
 * Kat-ayrımı olmayan tek-metre istasyonları (KK1) için tekil seçici:
 * role PRIMARY ?? rolesiz ?? ilk satır ?? null. Cihazlar zaten makineye-göre
 * geldiği için (for-device) yanlış makinenin metresini kapma riski yok.
 */
export function primaryMeterFor(
  rows: DevicePeripheral[],
): DevicePeripheral | null {
  return (
    rows.find((r) => r.role === 'PRIMARY') ??
    rows.find((r) => !r.role) ??
    rows[0] ??
    null
  );
}

/** Tekil kantar cihazı (sevkiyat çuval tartısı) — primaryMeterFor ile aynı seçim. */
export const primaryScaleFor = primaryMeterFor;
