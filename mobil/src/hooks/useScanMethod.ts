import { useMemo } from 'react';

import { useDeviceSettingsStore } from '../store/deviceSettingsStore';
import { readScanCapabilities, type DeviceScanCapabilities } from '../services/hardwareScanner/capabilities';
import { resolveScanMethod, type ScanMethod } from '../services/hardwareScanner/resolveScanMethod';

export interface ScanMethodInfo {
  method: ScanMethod;
  device: DeviceScanCapabilities;
  /** Donanım okuyucu modu (intent ya da wedge): kamera/OKUT/elle kutu gösterilmez, tuş okur. */
  hardware: boolean;
}

/**
 * Bu cihazda okutmanın ETKİN yöntemi — cihaz ayarı + yetenekten tek yüklemle (`resolveScanMethod`).
 * Ekranlar "kamera düğmesi göster mi" kararını yalnız buradan alır.
 */
export function useScanMethod(): ScanMethodInfo {
  const pref = useDeviceSettingsStore((s) => s.scanMethod);
  const link = useDeviceSettingsStore((s) => s.hardwareLink);
  return useMemo(() => {
    const device = readScanCapabilities();
    const method = resolveScanMethod({
      pref,
      link,
      adapterId: device.adapter?.id ?? null,
      scannerVendor: device.scannerVendor,
      forcedWedge: device.forcedWedge,
    });
    return { method, device, hardware: method.kind !== 'camera' };
  }, [pref, link]);
}

/** Kısayol: donanım okuyucu modunda mı. */
export function useHardwareScanMode(): boolean {
  return useScanMethod().hardware;
}
