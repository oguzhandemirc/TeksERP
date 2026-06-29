import { PermissionsAndroid, Platform } from 'react-native';

// =============================================================================
// Bluetooth (Classic / SPP) METRE OKUMA transport — 2-kat / 4-kat makinelerinin
// RS232 çıkışına lehimli HC-05/06 modülü üzerinden. Tambur "Otomatik" kesim
// modunda operatör "Kes"e basınca, seçili kata (foldType) ait makineye İSTEK-CEVAP
// ile sorgu yollanır ve dönen ASCII'den metre değeri ayıklanır.
//
// Yazıcı tarafıyla (btPrinter.service.ts) aynı `react-native-bluetooth-classic`
// native modülünü kullanır; orası YAZAR, burası OKUR. Modül yalnız native build'de
// bağlı (Expo Go / web / jest'te yok) → TEMBEL require + try/catch: modül yoksa
// `isBtMeterSupported()` false döner ve çağıran taraf simülasyona düşer.
// =============================================================================

export interface BtMeterDevice {
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
  // Okuma alt kümesi (react-native-bluetooth-classic modül-seviye API'si):
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
export function isBtMeterSupported(): boolean {
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
        message: 'Metre makinesine bağlanmak için Bluetooth izni gerekli.',
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

/** Eşleşmiş (bonded) cihazları döner. Modül yoksa boş liste. */
export async function listBondedMeters(): Promise<BtMeterDevice[]> {
  const mod = getModule();
  if (!mod) return [];
  await ensureConnectPermission();
  const devices = await mod.getBondedDevices();
  return devices.map((d) => ({ address: d.address, name: d.name?.trim() || d.address }));
}

/**
 * Makine cevabından (ASCII) metre değerini ayıkla. İstek-cevap protokolünde cihaz
 * "123.4\r\n" / "M=123.4" / "LEN 0123.45 m" gibi yanıtlar verebilir → metni tarar,
 * SON tam sayısal token'ı alır (etiket öneki varsa değer sonda olur), ',' → '.'.
 * 1 ondalığa yuvarlar (üretim hassasiyeti). Geçerli pozitif sayı yoksa null.
 *
 * Saf fonksiyon — native modülden bağımsız, birim test edilir.
 */
export function parseMeterReading(raw: string): number | null {
  if (!raw) return null;
  const matches = raw.replace(/,/g, '.').match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) return null;
  for (let i = matches.length - 1; i >= 0; i--) {
    const v = parseFloat(matches[i]);
    if (Number.isFinite(v) && v > 0) return Math.round(v * 10) / 10;
  }
  return null;
}

export interface ReadMeterOptions {
  /** Makineye yollanacak sorgu komutu (İSTEK-CEVAP). Boşsa yalnız dinlenir. */
  pollCommand?: string;
  /** Yanıt için bekleme süresi (ms). Varsayılan 2500. */
  timeoutMs?: number;
}

/** Eşleşmiş cihaza RFCOMM soketi açıp bağlantıyı doğrular (okuma yapmaz). */
export async function testMeterConnection(address: string): Promise<void> {
  const mod = getModule();
  if (!mod) throw new Error('Bluetooth modülü bu derlemede yok (native build gerekli).');
  await ensureConnectPermission();
  await ensureAdapterEnabled(mod);
  const already = await mod.isDeviceConnected(address).catch(() => false);
  if (!already) await mod.connectToDevice(address);
}

/**
 * Seçili makineden metre değerini İSTEK-CEVAP ile oku. Bayat tamponu temizler,
 * (varsa) sorgu komutunu yazar, sonra terminatör (\r/\n) görene veya zaman aşımına
 * kadar gelen baytları biriktirip `parseMeterReading` ile sayıya çevirir.
 * Hata/zaman aşımı → throw (çağıran simülasyona düşer).
 */
export async function readMeter(address: string, opts: ReadMeterOptions = {}): Promise<number> {
  const mod = getModule();
  if (!mod) throw new Error('Bluetooth modülü bu derlemede yok (native build gerekli).');
  await ensureConnectPermission();
  await ensureAdapterEnabled(mod);

  const connected = await mod.isDeviceConnected(address).catch(() => false);
  if (!connected) await mod.connectToDevice(address);

  // İstek-cevap: önce bayat tamponu temizle, sonra (varsa) sorgu komutunu yaz.
  if (mod.clearFromDevice) await mod.clearFromDevice(address).catch(() => false);
  const cmd = opts.pollCommand?.trim();
  if (cmd) {
    // Çoğu RS232 cihazı satır sonu (CR/LF) bekler → kullanıcı eklemediyse biz ekleriz.
    const payload = /[\r\n]$/.test(opts.pollCommand ?? '') ? (opts.pollCommand as string) : `${cmd}\r\n`;
    await mod.writeToDevice(address, payload, 'ascii');
  }

  const timeoutMs = opts.timeoutMs ?? 2500;
  const deadline = Date.now() + timeoutMs;
  let buf = '';
  while (Date.now() < deadline) {
    const avail = await mod.availableFromDevice(address).catch(() => 0);
    if (avail && avail > 0) {
      const chunk = await mod.readFromDevice(address).catch(() => null);
      if (chunk) buf += chunk;
      // Bir satır tamamlandıysa parse etmeyi dene (yarım okumayı sayı sanmamak için).
      if (/[\r\n]/.test(buf)) {
        const v = parseMeterReading(buf);
        if (v != null) return v;
      }
    }
    await delay(50);
  }
  // Son şans: terminatör gelmeden de geçerli sayı yakaladıysak onu döndür.
  const v = parseMeterReading(buf);
  if (v != null) return v;
  throw new Error('Makineden geçerli metre yanıtı gelmedi (zaman aşımı).');
}
