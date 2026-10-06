// Tabletin şifreli bağlantı sabit deposu (docs/design/LAN-TLS.md §6). Sabit cihazın güvenli deposunda
// (expo-secure-store) durur. Bağlantıyı ZORLAYAN katman native'dir (D5: OkHttp'a parmak izi denetleyen
// TrustManager); o katman yoksa sabit yazılmaz — bkz. decideQrPin.
import { NativeModules } from 'react-native';
import { storage } from '../utils/storage';
import { parseTlsPins, withPin, type TlsPin } from '../lib/lan-tls';

const TLS_PINS_KEY = 'api_server_tls_pins';

/** D5'in native modülü (planlanan ad). Yoksa bu sürüm şifreli bağlantıyı zorlayamaz. */
interface LanTlsNative {
  setPins: (json: string) => Promise<void>;
}

function nativeModule(): LanTlsNative | null {
  const m = (NativeModules as Record<string, unknown>).TeksErpLanTls as Partial<LanTlsNative> | undefined;
  return m && typeof m.setPins === 'function' ? (m as LanTlsNative) : null;
}

export function lanTlsNativeAvailable(): boolean {
  return nativeModule() !== null;
}

export async function getTlsPins(): Promise<TlsPin[]> {
  try {
    return parseTlsPins(await storage.getItem(TLS_PINS_KEY));
  } catch {
    return [];
  }
}

async function writePins(pins: TlsPin[]): Promise<void> {
  if (pins.length === 0) await storage.deleteItem(TLS_PINS_KEY);
  else await storage.setItem(TLS_PINS_KEY, JSON.stringify(pins));
  await nativeModule()?.setPins(JSON.stringify(pins));
}

/** Aynı kurulumun eski sabiti yerini yeniye bırakır. */
export async function addTlsPin(pin: TlsPin): Promise<TlsPin[]> {
  const next = withPin(await getTlsPins(), pin);
  await writePins(next);
  return next;
}

export async function removeTlsPins(installationId: string | null): Promise<TlsPin[]> {
  const next = (await getTlsPins()).filter((p) => p.installationId !== installationId);
  await writePins(next);
  return next;
}
