import { PermissionsAndroid, Platform } from 'react-native';
import type { DeviceTransport, ReadOptions } from './transport.types';

// =============================================================================
// Bluetooth Classic / SPP (RFCOMM) transport — HC-05/06 köprülü cihazlar:
// etiket yazıcısı (yaz) + metre/kantar (oku). Önceden btPrinter.service ve
// btMeter.service bu native-modül/izin/bağlanma mantığını AYRI AYRI taşıyordu;
// burada tek noktaya toplandı (ikisi de bunu sarmalar).
//
// `react-native-bluetooth-classic` native modül → yalnız dev/release BUILD'de var
// (Expo Go / web / jest'te yok). TEMBEL require + try/catch: modül yoksa
// `isBtSupported()` false döner ve çağıran simülasyon/HTML yoluna düşer.
// =============================================================================

export interface BtBondedDevice {
  /** MAC adresi — kalıcı seçim/eşleşme anahtarı. */
  address: string;
  /** Görünen ad (yoksa adres). */
  name: string;
}

/** Kütüphanenin kullandığımız alt kümesi — gerçek tipe bağlanmadan (build-agnostik). */
interface BtNativeDevice {
  name?: string | null;
  address: string;
}
interface BtNativeModule {
  isBluetoothEnabled(): Promise<boolean>;
  requestBluetoothEnabled(): Promise<boolean>;
  getBondedDevices(): Promise<BtNativeDevice[]>;
  isDeviceConnected(address: string): Promise<boolean>;
  connectToDevice(address: string, options?: Record<string, unknown>): Promise<unknown>;
  writeToDevice(address: string, message: string, encoding?: string): Promise<boolean>;
  // Okuma alt kümesi (modül-seviye API):
  availableFromDevice(address: string): Promise<number>;
  readFromDevice(address: string): Promise<string | null>;
  clearFromDevice?(address: string): Promise<boolean>;
}

let cachedModule: BtNativeModule | null | undefined;

function getModule(): BtNativeModule | null {
  if (cachedModule !== undefined) return cachedModule;
  try {
    // Native köprü yalnız native build'de bağlı; aksi halde require fırlatır.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-bluetooth-classic');
    cachedModule = (mod?.default ?? mod) as BtNativeModule;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

/** Bu derlemede Bluetooth Classic native modülü mevcut mu? */
export function isBtSupported(): boolean {
  return getModule() !== null;
}

/** Android 12+ (API 31) BLUETOOTH_CONNECT runtime izni — eşleşmiş cihaza bağlanmak için şart. */
async function ensureConnectPermission(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const apiLevel =
    typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  if (!Number.isNaN(apiLevel) && apiLevel >= 31) {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      {
        title: 'Bluetooth izni',
        message: 'Cihaza (yazıcı/metre) bağlanmak için Bluetooth izni gerekli.',
        buttonPositive: 'İzin Ver',
        buttonNegative: 'Vazgeç',
      },
    );
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
      throw new Error('Bluetooth izni verilmedi');
    }
  }
}

/** Adaptör kapalıysa kullanıcıdan açmasını iste. */
async function ensureAdapterEnabled(mod: BtNativeModule): Promise<void> {
  const enabled = await mod.isBluetoothEnabled().catch(() => true);
  if (enabled) return;
  const ok = await mod.requestBluetoothEnabled().catch(() => false);
  if (!ok) throw new Error('Bluetooth kapalı — açıp tekrar deneyin.');
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** İzin + adaptör + (gerekirse) bağlanmayı garantile; modülü döner. Modül yoksa fırlatır. */
async function ensureReady(address: string): Promise<BtNativeModule> {
  const mod = getModule();
  if (!mod) throw new Error('Bluetooth modülü bu derlemede yok (native build gerekli).');
  await ensureConnectPermission();
  await ensureAdapterEnabled(mod);
  const connected = await mod.isDeviceConnected(address).catch(() => false);
  if (!connected) await mod.connectToDevice(address);
  return mod;
}

/** Eşleşmiş (bonded) cihazları döner. Modül yoksa boş liste. */
export async function listBonded(): Promise<BtBondedDevice[]> {
  const mod = getModule();
  if (!mod) return [];
  await ensureConnectPermission();
  const devices = await mod.getBondedDevices();
  return devices.map((d) => ({ address: d.address, name: d.name?.trim() || d.address }));
}

/** RFCOMM soketi açıp bağlantıyı doğrula (yazma/okuma yapmaz). */
export async function testConnection(address: string): Promise<void> {
  await ensureReady(address);
}

/**
 * Ham içerik yaz. `latin1` = native komut baytları (STX/CR korunur), `ascii` = sorgu
 * komutu. Bayat soket halinde bir kez yeniden bağlanıp dener (retry varsayılan açık).
 */
export async function writeRaw(
  address: string,
  content: string,
  encoding: 'latin1' | 'ascii' = 'latin1',
  opts?: { retry?: boolean },
): Promise<void> {
  const mod = await ensureReady(address);
  try {
    await mod.writeToDevice(address, content, encoding);
  } catch (e) {
    if (opts?.retry === false) throw e;
    // Soket düşmüş olabilir → tek sefer yeniden bağlan + yaz.
    await mod.connectToDevice(address);
    await mod.writeToDevice(address, content, encoding);
  }
}

export interface ReadResponseOptions {
  pollCommand?: string;
  timeoutMs?: number;
  /** Tampon tamamlandı mı (varsayılan: herhangi CR/LF). Parse-bilinçli erken dönüş için. */
  isComplete?: (buf: string) => boolean;
}

/**
 * İstek-cevap oku: bayat tamponu temizle, (varsa) sorgu komutunu yaz, sonra gelen
 * baytları `isComplete` true olana veya zaman aşımına kadar biriktir; ham metni döner.
 * Anlamlandırma (sayıya çevirme) çağıranın/codec'in işi.
 */
export async function readResponse(address: string, opts: ReadResponseOptions = {}): Promise<string> {
  const mod = await ensureReady(address);
  if (mod.clearFromDevice) await mod.clearFromDevice(address).catch(() => false);

  const cmd = opts.pollCommand?.trim();
  if (cmd) {
    // Çoğu RS232 cihazı satır sonu (CR/LF) bekler → kullanıcı eklemediyse biz ekleriz.
    const payload = /[\r\n]$/.test(opts.pollCommand ?? '') ? (opts.pollCommand as string) : `${cmd}\r\n`;
    await mod.writeToDevice(address, payload, 'ascii');
  }

  const timeoutMs = opts.timeoutMs ?? 2500;
  const isComplete = opts.isComplete ?? ((b: string) => /[\r\n]/.test(b));
  const deadline = Date.now() + timeoutMs;
  let buf = '';
  while (Date.now() < deadline) {
    const avail = await mod.availableFromDevice(address).catch(() => 0);
    if (avail && avail > 0) {
      const chunk = await mod.readFromDevice(address).catch(() => null);
      if (chunk) buf += chunk;
      if (isComplete(buf)) return buf;
    }
    await delay(50);
  }
  return buf; // zaman aşımı → biriken neyse onu döndür (çağıran karar verir)
}

/** Bir adres için DeviceTransport örneği (HAL fabrikası bunu kullanır). */
export function btClassicTransport(address: string): DeviceTransport {
  return {
    test: () => testConnection(address),
    write: (content, encoding = 'latin1') => writeRaw(address, content, encoding, { retry: true }),
    read: (o?: ReadOptions) => {
      const term = o?.terminator;
      return readResponse(address, {
        pollCommand: o?.pollCommand,
        timeoutMs: o?.timeoutMs,
        isComplete: term ? (b) => b.includes(term) : undefined,
      });
    },
  };
}
