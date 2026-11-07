// Cihaz yetenekleri — yerel modül varsa ondan, yoksa (eski APK) `Platform.constants`tan (paket/kütüphane bilinmez).
import { Platform } from 'react-native';
import { donanimOkuyucuNative, type NativeCapabilities } from './native';
import { QUERIED_PACKAGES, findAdapter, type ScannerAdapter } from './adapters';
import { isForcedWedgeModel, isScannerManufacturer } from './resolveScanMethod';

export interface DeviceScanCapabilities {
  caps: NativeCapabilities;
  /** Yerel modül yüklü mü (false → yalnız wedge/kamera). */
  nativeAvailable: boolean;
  adapter: ScannerAdapter | null;
  scannerVendor: boolean;
  forcedWedge: boolean;
}

let cached: DeviceScanCapabilities | null = null;

function fallbackCaps(): NativeCapabilities {
  const c = (Platform.constants ?? {}) as { Manufacturer?: unknown; Model?: unknown; Brand?: unknown };
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    manufacturer: str(c.Manufacturer),
    brand: str(c.Brand),
    model: str(c.Model),
    sdkInt: typeof Platform.Version === 'number' ? Platform.Version : 0,
    packages: {},
    sharedLibraries: [],
  };
}

export function readScanCapabilities(): DeviceScanCapabilities {
  if (cached) return cached;
  const native = Platform.OS === 'android' ? donanimOkuyucuNative() : null;
  let caps: NativeCapabilities | null = null;
  if (native) {
    try {
      caps = native.getCapabilities([...QUERIED_PACKAGES]);
    } catch {
      caps = null;
    }
  }
  const nativeAvailable = !!native && !!caps;
  const resolved = caps ?? fallbackCaps();
  cached = {
    caps: resolved,
    nativeAvailable,
    adapter: nativeAvailable ? findAdapter(resolved) : null,
    scannerVendor: isScannerManufacturer(resolved.manufacturer),
    forcedWedge: isForcedWedgeModel(resolved.manufacturer, resolved.model),
  };
  return cached;
}

/** "Point Mobile PM68" — marka adaptörden, yoksa üreticiden. */
export function deviceLabel(d: DeviceScanCapabilities): string {
  const brand = d.adapter?.vendorLabel ?? d.caps.manufacturer;
  return [brand, d.caps.model].map((s) => s.trim()).filter(Boolean).join(' ') || 'Bu cihaz';
}

/** Yalnız testler. */
export function __resetCapabilitiesForTests(): void {
  cached = null;
}
