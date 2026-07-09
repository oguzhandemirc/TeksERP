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
  /** Çevredeki (eşleşmemiş dahil) cihazları keşfet — ~12sn sürebilir. */
  startDiscovery(): Promise<BtNativeDevice[]>;
  cancelDiscovery?(): Promise<boolean>;
  /** MAC'ten eşleştir (createBond) — Android sistem PIN diyaloğu çıkar, bond olunca çözülür. */
  pairDevice(address: string): Promise<unknown>;
  isDeviceConnected(address: string): Promise<boolean>;
  connectToDevice(address: string, options?: Record<string, unknown>): Promise<unknown>;
  disconnectFromDevice?(address: string): Promise<boolean>;
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

/** Android 12+ BLUETOOTH_SCAN (eski sürüm: ACCESS_FINE_LOCATION) — cihaz keşfi için şart. */
async function ensureScanPermission(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const apiLevel =
    typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  const perm =
    !Number.isNaN(apiLevel) && apiLevel >= 31
      ? PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN
      : PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
  const granted = await PermissionsAndroid.request(perm, {
    title: 'Bluetooth tarama izni',
    message: 'Yakındaki yazıcıları bulmak için Bluetooth tarama izni gerekli.',
    buttonPositive: 'İzin Ver',
    buttonNegative: 'Vazgeç',
  });
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error('Bluetooth tarama izni verilmedi');
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

/**
 * Çevredeki (eşleşmemiş dahil) Bluetooth Classic cihazları keşfet — yazıcıyı
 * Android ayarlarına girmeden bulmak için. ~12sn sürebilir. Modül yoksa boş liste.
 */
export async function discoverDevices(): Promise<BtBondedDevice[]> {
  const mod = getModule();
  if (!mod) return [];
  await ensureScanPermission();
  await ensureConnectPermission();
  await ensureAdapterEnabled(mod);
  const devices = await mod.startDiscovery();
  return devices.map((d) => ({ address: d.address, name: d.name?.trim() || d.address }));
}

const normMac = (a: string): string => a.trim().toUpperCase();

/** Bu MAC Android'de zaten eşleşmiş (bonded) mi? Modül yoksa false. */
export async function isBonded(address: string): Promise<boolean> {
  const want = normMac(address);
  const list = await listBonded();
  return list.some((d) => normMac(d.address) === want);
}

/**
 * MAC'ten DOĞRUDAN eşleştir — Bluetooth ayarlarına girmeden. Uygulama `createBond`
 * tetikler; HC-06 gibi eski cihazlarda Android **sistem PIN diyaloğu** çıkar
 * (kullanıcı PIN'i bir kez yazar, ör. 1234/0000). Bond tamamlanınca çözülür.
 * Zaten eşleşmişse hemen döner (idempotent). Modül yoksa fırlatır.
 */
export async function pairByMac(address: string): Promise<void> {
  const mod = getModule();
  if (!mod) throw new Error('Bluetooth modülü bu derlemede yok (native build gerekli).');
  await ensureConnectPermission();
  await ensureAdapterEnabled(mod);
  if (await isBonded(address)) return;
  await mod.pairDevice(address);
}

/** RFCOMM soketi açıp bağlantıyı doğrula (yazma/okuma yapmaz). */
export async function testConnection(address: string): Promise<void> {
  await ensureReady(address);
}

/**
 * Promise'e sert süre sınırı. BT connect/write native çağrıları (yazıcı KAPALI /
 * HC-06'yı BAŞKA cihaz tutuyor — modül tek RFCOMM bağlantısı kabul eder) SÜRESİZ
 * askıda kalabiliyor; askıda kalan baskı sözü hiç çözülmeyince etiket kuyruğu
 * sessizce donuyordu ("hata verince/bazen sıradakini basmıyor" saha bug'ı).
 * Zaman aşımında soket best-effort kapatılır + NET Türkçe hata fırlatılır →
 * çağıran (LabelPrinter) finally'sine düşer, kuyruk bir sonrakine ilerler.
 */
async function withDeadline<T>(p: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutP = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(
        new Error(
          'Yazıcıya bağlanılamadı (zaman aşımı) — yazıcı kapalı ya da başka bir cihaz bağlı olabilir.',
        ),
      );
    }, ms);
  });
  try {
    return await Promise.race([p, timeoutP]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ham içerik yaz. `latin1` = native komut baytları (STX/CR korunur), `ascii` = sorgu
 * komutu. Bayat soket halinde bir kez yeniden bağlanıp dener (retry varsayılan açık).
 * `timeoutMs` verilirse bağlan+yaz (retry dahil) toplamı bu süreyi AŞAMAZ.
 */
export async function writeRaw(
  address: string,
  content: string,
  encoding: 'latin1' | 'ascii' = 'latin1',
  opts?: { retry?: boolean; timeoutMs?: number },
): Promise<void> {
  const run = async (): Promise<void> => {
    const mod = await ensureReady(address);
    try {
      await mod.writeToDevice(address, content, encoding);
    } catch (e) {
      if (opts?.retry === false) throw e;
      // Soket düşmüş olabilir → tek sefer yeniden bağlan + yaz.
      await mod.connectToDevice(address);
      await mod.writeToDevice(address, content, encoding);
    }
  };
  const ms = opts?.timeoutMs;
  if (!ms) return run();
  return withDeadline(run(), ms, () => {
    // Askıda kalan connect/write'ı koparmayı dene — sonraki deneme temiz başlasın.
    void getModule()?.disconnectFromDevice?.(address).catch(() => {});
  });
}

type ReadMode = 'POLL' | 'STREAM';

export interface ReadResponseOptions {
  /** 'POLL' (varsayılan) = komut yolla+cevabı oku · 'STREAM' = komut yok, dinle. */
  readMode?: ReadMode;
  /** POLL sorgu komutu — escape çözülür (\r \n \t \xNN \\), cihaza TAM gönderilir. */
  pollCommand?: string;
  /** Çerçeve (satır) ayracı; boş → herhangi CR/LF. */
  terminator?: string;
  /** Zaman aşımı (ms); varsayılan 2500. */
  timeoutMs?: number;
  /** Geçerli çerçeve regex'i — verilirse buna uyan SON çerçeve döner (ör. sabit "…B"). */
  framePattern?: string;
}

/** pollCommand escape dizilerini çöz — cihaza TAM baytlar gitsin (otomatik CR/LF YOK). */
export function decodeCommand(s: string): string {
  return s.replace(/\\x([0-9a-fA-F]{2})|\\r|\\n|\\t|\\\\/g, (m, hex) =>
    hex !== undefined
      ? String.fromCharCode(parseInt(hex, 16))
      : m === '\\r'
        ? '\r'
        : m === '\\n'
          ? '\n'
          : m === '\\t'
            ? '\t'
            : '\\',
  );
}

/** Tamponu tam çerçevelere böl; ayraçsız son parça `rest` olarak kalır. */
export function splitFrames(buf: string, terminator?: string): { frames: string[]; rest: string } {
  const parts = terminator && terminator.length > 0 ? buf.split(terminator) : buf.split(/\r\n|\r|\n/);
  const rest = parts.pop() ?? '';
  return { frames: parts, rest };
}

/**
 * Cihazdan bir değer çerçevesi oku — iki davranışı da (POLL/STREAM) tek mantıkla:
 *   • bayat tamponu temizle,
 *   • POLL ise komutu TAM yaz (escape çözülür, otomatik CR/LF YOK),
 *   • gelen baytları tam çerçevelere böl; STREAM'de İLK (yarım-başlangıç) çerçeveyi at,
 *   • `framePattern` varsa ona uyan SON çerçeveyi, yoksa son tam çerçeveyi seç,
 *   • yeterince taze/kararlı çerçeve toplanınca (veya akış durunca) erken dön.
 * Sayıya çevirme codec'in işi. Desen istenip hiç uyan çerçeve gelmezse '' döner
 * (görünür başarısızlık — "sabit değer istendi ama gelmedi").
 */
export async function readResponse(address: string, opts: ReadResponseOptions = {}): Promise<string> {
  const mode: ReadMode = opts.readMode ?? 'POLL';
  const mod = await ensureReady(address);
  if (mod.clearFromDevice) await mod.clearFromDevice(address).catch(() => false);

  if (mode === 'POLL' && opts.pollCommand && opts.pollCommand.length > 0) {
    await mod.writeToDevice(address, decodeCommand(opts.pollCommand), 'ascii');
  }

  let pattern: RegExp | null = null;
  if (opts.framePattern && opts.framePattern.trim()) {
    try {
      pattern = new RegExp(opts.framePattern);
    } catch {
      pattern = null; // geçersiz regex → desensiz davran (backend zaten reddeder)
    }
  }

  const timeoutMs = opts.timeoutMs ?? 2500;
  const QUIET_MS = 250; // elde geçerli değer varken akış durursa dönme süresi (POLL tek satır)
  const deadline = Date.now() + timeoutMs;
  let buf = '';
  let frameCount = 0; // toplam tam çerçeve — STREAM yarım-başlangıç guard'ı için
  let best = ''; // seçilen çerçeve (desene uyan / son tam)
  let matchCount = 0; // geçerli aday sayısı — snappy erken çıkış
  let lastDataAt = Date.now();

  while (Date.now() < deadline) {
    const avail = await mod.availableFromDevice(address).catch(() => 0);
    if (avail && avail > 0) {
      const chunk = await mod.readFromDevice(address).catch(() => null);
      if (chunk) {
        buf += chunk;
        lastDataAt = Date.now();
      }
      const { frames, rest } = splitFrames(buf, opts.terminator);
      buf = rest;
      for (const f of frames) {
        frameCount++;
        // STREAM'de İLK tam çerçeve akışa ortadan girişte yarım olabilir → atla.
        // POLL'de ilk çerçeve cevabın kendisidir → kabul.
        const isCandidate = mode === 'POLL' || frameCount > 1;
        if (!isCandidate) continue;
        const frame = f.trim();
        if (!frame) continue;
        if (!pattern || pattern.test(frame)) {
          best = frame;
          matchCount++;
        }
      }
      if (best && matchCount >= 2) return best; // ≥2 taze/kararlı çerçeve → hemen dön
    } else if (best && Date.now() - lastDataAt >= QUIET_MS) {
      return best; // akış durdu, elde geçerli değer var (POLL tek-satır cevabı)
    }
    await delay(30);
  }
  if (best) return best;
  return pattern ? '' : buf; // desen istendi ama uyan yok → '' (görünür hata); desensiz → kalan tampon
}

/** Bir adres için DeviceTransport örneği (HAL fabrikası bunu kullanır). */
export function btClassicTransport(address: string): DeviceTransport {
  return {
    test: () => testConnection(address),
    write: (content, encoding = 'latin1') => writeRaw(address, content, encoding, { retry: true }),
    read: (o?: ReadOptions) =>
      readResponse(address, {
        readMode: o?.readMode,
        pollCommand: o?.pollCommand,
        terminator: o?.terminator,
        timeoutMs: o?.timeoutMs,
        framePattern: o?.framePattern,
      }),
  };
}
