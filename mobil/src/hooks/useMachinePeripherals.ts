import { useQuery } from '@tanstack/react-query';
import { peripheralService, type DevicePeripheral } from '../services/peripheral.service';

// =============================================================================
// Tablet kendi makinesine SABİT cihazları (METER/SCALE) backend'den çözer
// (req.device.machineId üzerinden). Eşleşme/atama yoksa boş liste → çağıran net
// hata gösterir. Cihaz seçimi artık device-local DEĞİL — admin Cihaz Kaydı'nda.
// =============================================================================

export function useMachinePeripherals(kind: 'METER' | 'SCALE'): DevicePeripheral[] {
  const q = useQuery({
    queryKey: ['peripherals', 'for-device', kind],
    queryFn: () => peripheralService.getForDevice(kind),
    staleTime: 5 * 60 * 1000,
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
