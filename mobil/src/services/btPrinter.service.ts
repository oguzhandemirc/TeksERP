import { PermissionsAndroid, Platform } from 'react-native';

// =============================================================================
// Bluetooth (Classic / SPP) etiket yazıcısı transport — Argox OS-214 plus + seri
// lehimli HC-05/06 modülü. Backend'in ürettiği PPLA komut string'ini (text/plain,
// `/labels/rolls/:id/ppla`) eşleşmiş yazıcıya RFCOMM soketiyle yazar.
//
// `react-native-bluetooth-classic` native modül olduğundan yalnız dev/release
// BUILD'de var (Expo Go / web / jest'te yok). Bu yüzden TEMBEL require + try/catch:
// modül yoksa `isBtPrinterSupported()` false döner, çağıran HTML+expo-print yoluna
// düşer. New Architecture (RN 0.81) altında kütüphane interop katmanıyla çalışır.
// =============================================================================

export interface BtPrinter {
  /** MAC adresi — kalıcı seçim anahtarı. */
  address: string;
  /** Cihaz görünen adı (yoksa adres). */
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
export function isBtPrinterSupported(): boolean {
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
        message: 'Etiket yazıcısına bağlanmak için Bluetooth izni gerekli.',
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

/** Eşleşmiş (bonded) cihazları döner. Modül yoksa boş liste. */
export async function listBondedPrinters(): Promise<BtPrinter[]> {
  const mod = getModule();
  if (!mod) return [];
  await ensureConnectPermission();
  const devices = await mod.getBondedDevices();
  return devices.map((d) => ({ address: d.address, name: d.name?.trim() || d.address }));
}

/** Eşleşmiş yazıcıya RFCOMM soketi açıp (gerekirse) bağlantıyı doğrular — fiziksel baskı yapmaz. */
export async function testConnection(address: string): Promise<void> {
  const mod = getModule();
  if (!mod) throw new Error('Bluetooth yazıcı modülü bu derlemede yok (native build gerekli).');
  await ensureConnectPermission();
  await ensureAdapterEnabled(mod);
  const already = await mod.isDeviceConnected(address).catch(() => false);
  if (!already) await mod.connectToDevice(address);
}

/**
 * Native komut string'ini (PPLA/PPLB/ZPL) eşleşmiş yazıcıya yaz — dil-agnostik.
 * Cihazın diline göre içerik backend'de üretilir; burası yalnız ham baytları yazar.
 */
export async function printRaw(address: string, content: string): Promise<void> {
  return printPpla(address, content);
}

/**
 * PPLA komut string'ini eşleşmiş yazıcıya yaz. İçerik latin1-güvenli (backend
 * asciiFold) + STX/CR kontrol baytları (<0x20) → 'latin1' encoding bayt-bire-bir
 * korur. Bayat soket halinde bir kez yeniden bağlanıp dener.
 */
export async function printPpla(address: string, content: string): Promise<void> {
  const mod = getModule();
  if (!mod) throw new Error('Bluetooth yazıcı modülü bu derlemede yok (native build gerekli).');
  if (!content) throw new Error('Etiket verisi boş');
  await ensureConnectPermission();
  await ensureAdapterEnabled(mod);

  const connected = await mod.isDeviceConnected(address).catch(() => false);
  if (!connected) await mod.connectToDevice(address);

  try {
    await mod.writeToDevice(address, content, 'latin1');
  } catch {
    // Soket düşmüş olabilir → tek sefer yeniden bağlan + yaz.
    await mod.connectToDevice(address);
    await mod.writeToDevice(address, content, 'latin1');
  }
}
