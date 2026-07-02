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

/** foldType → ilgili metre cihazı (role 2-KAT/4-KAT). Bulunamazsa null. */
export function meterPeripheralFor(
  rows: DevicePeripheral[],
  foldType: string | null | undefined,
): DevicePeripheral | null {
  const want = foldType === '4-KAT' ? '4-KAT' : '2-KAT';
  return rows.find((r) => r.role === want) ?? rows.find((r) => !r.role) ?? null;
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
