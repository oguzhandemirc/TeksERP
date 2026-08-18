import { PermissionsAndroid, Platform } from 'react-native';
import { withSystemDialog } from '../../store/lockStore';
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
    // withSystemDialog: izin diyaloğu activity'yi pause eder → AppState
    // 'background' → idle kilidi ANINDA kilitlerdi; sarma bunu bastırır.
    const granted = await withSystemDialog(() =>
      PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT, {
        title: 'Bluetooth izni',
        message: 'Cihaza (yazıcı/metre) bağlanmak için Bluetooth izni gerekli.',
        buttonPositive: 'İzin Ver',
        buttonNegative: 'Vazgeç',
      }),
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
  const granted = await withSystemDialog(() =>
    PermissionsAndroid.request(perm, {
      title: 'Bluetooth tarama izni',
      message: 'Yakındaki yazıcıları bulmak için Bluetooth tarama izni gerekli.',
      buttonPositive: 'İzin Ver',
      buttonNegative: 'Vazgeç',
    }),
  );
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error('Bluetooth tarama izni verilmedi');
  }
}

/** Adaptör kapalıysa kullanıcıdan açmasını iste. */
// Kütüphane TEK pending activity-result promise'i tutar — eşzamanlı ikinci
// requestBluetoothEnabled çağrısı ilkini YETİM bırakır (hiç çözülmez; kilit
// bastırma sayacı askıda kalırdı). Tek uçuş paylaşılır: aynı anda gelen tüm
// çağrılar aynı sistem diyaloğunun sonucunu bekler.
let enableRequest: Promise<boolean> | null = null;

async function ensureAdapterEnabled(mod: BtNativeModule): Promise<void> {
  const enabled = await mod.isBluetoothEnabled().catch(() => true);
  if (enabled) return;
  if (!enableRequest) {
    // "Bluetooth açılsın mı?" sistem diyaloğu — withSystemDialog kilit bastırır.
    enableRequest = withSystemDialog(() => mod.requestBluetoothEnabled())
      .catch(() => false)
      .finally(() => {
        enableRequest = null;
      });
  }
  const ok = await enableRequest;
  if (!ok) throw new Error('Bluetooth kapalı — açıp tekrar deneyin.');
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * BAĞLANTI ŞÜPHELİ Mİ — uygulama arka plana düştüyse true olur, bir sonraki
 * `ensureReady` onu tüketip soketi ZORLA tazeler (2026-08-17).
 *
 * NEDEN BÖYLE, "öne gelince yeniden bağlan" DEĞİL: yazıcı adresi backend'den
 * oturuma göre çözülüyor (`peripheralService.getForSession`), yani öne gelir
 * gelmez bağlanmak her uyanışta ağ çağrısı + RFCOMM açmak demekti — üstelik
 * operatör hiç baskı yapmayacak olsa bile. Bayrak ise bedava: maliyet yalnız
 * GERÇEKTEN basılacağı anda ve yalnız bir kez ödenir.
 *
 * Android arka planda soketi koparabiliyor ama HC-06 bunu her zaman görmüyor →
 * `isDeviceConnected` "bağlı" der, yazma ölü sokete gider. Şüphe bayrağı tam bu
 * yalanı kapatır.
 */
let linkSuspect = false;

/** Uygulama arka plana düştü → eldeki RFCOMM soketi artık güvenilmez. */
export function markLinkSuspect(): void {
  linkSuspect = true;
}

/** İzin + adaptör + (gerekirse) bağlanmayı garantile; modülü döner. Modül yoksa fırlatır. */
async function ensureReady(address: string): Promise<BtNativeModule> {
  const mod = getModule();
  if (!mod) throw new Error('Bluetooth modülü bu derlemede yok (native build gerekli).');
  await ensureConnectPermission();
  await ensureAdapterEnabled(mod);
  if (linkSuspect) {
    // Bayrak ÖNCE düşürülür: kopar-bekle sırasında ikinci bir çağrı gelirse
    // aynı temizliği tekrar yapmasın (MAC kilidi altındayız ama okuma yolu
    // farklı bir MAC ile paralel koşabilir).
    linkSuspect = false;
    await forceDisconnect(address);
  }
  const connected = await mod.isDeviceConnected(address).catch(() => false);
  if (!connected) {
    // Secure RFCOMM, eşleşmemiş cihazda bağlanırken OTOMATİK bond başlatır →
    // sistem PIN diyaloğu SARILMADAN çıkardı (metre okumasında anında kilit).
    // Önce açıkça, sarılı pairDevice ile eşleş; connect diyalogsuz kalır.
    if (!(await isBonded(address))) {
      await withSystemDialog(() => mod.pairDevice(address));
    }
    await mod.connectToDevice(address);
  }
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

// =============================================================================
// Per-MAC serileştirme kilidi
// =============================================================================
// Aynı fiziksel HC-06 bağlantısına (aynı MAC) giden okuma/yazma işlemleri ASLA
// iç içe geçmemeli. Tek kabloyla iki metre (2-KAT + 4-KAT) senaryosunda iki ayrı
// PeripheralDevice kaydı AYNI MAC'i paylaşır → tek RFCOMM soketi. readResponse'ın
// `clear → write(pollCommand) → read` döngüsü başka bir okuma/yazma ile çakışırsa
// (hızlı çift-dokunuş, teşhis ekranı, ileride eşzamanlı okuma) tamponları birbirini
// bozar. MAC başına kuyruk: her iş, aynı MAC'teki önceki iş (hata dahil) bitince
// başlar. Farklı MAC'ler paralel kalır (kilit adrese özel).
const macLocks = new Map<string, Promise<unknown>>();

/**
 * UÇUŞTA KALAN yazma — zaman aşımı sonrası tahliye kuyruğu (2026-08-19).
 *
 * ⚠️ SAHA VAKASI: "yazıcı takıldı, fiziksel tuşla kapat-aç yaptık." `withDeadline`
 * SÜREYİ doldurunca ÇAĞIRANI reddeder ama native `writeToDevice` promise'i HÂLÂ
 * UÇUŞTADIR — kilit ise `run`a zincirlendiği için o anda SERBEST KALIYORDU. Sonuç:
 * bir sonraki etiket, yarım kalmış yazmanın baytları hâlâ akarken AYNI RFCOMM
 * soketine yazıyor → yazıcının komut ayrıştırıcısına İKİ KOMUT İÇ İÇE giriyor.
 * PPLA'da bu, tamamlanmamış bir bloğun peşine yeni `<STX>` eklenmesi demektir;
 * yazıcı kalan baytları beklerken sonraki her şeyi VERİ olarak yutar ve
 * ELEKTRİĞİ KESİLENE KADAR takılı kalır. Tam olarak sahadaki tarif.
 *
 * Bu yüzden zaman aşımında iş kuyruktan DÜŞMEZ: uçuştaki promise buraya park
 * edilir ve bir sonraki iş ONU DA bekler. Beklemenin tavanı var — native promise
 * hiç çözülmezse kuyruğu sonsuza dek dondurmak, iç içe yazmadan da kötüdür.
 */
const macDrains = new Map<string, Promise<unknown>>();

/** Uçuşta kalan yazmanın tahliyesi en fazla bu kadar beklenir. */
const DRAIN_CAP_MS = 4_000;

/** Zaman aşımına düşen native işi "tahliye edilecek" diye kaydet. */
function registerDrain(address: string, inflight: Promise<unknown>): void {
  const key = normMac(address);
  const settled = inflight.then(
    () => undefined,
    () => undefined,
  );
  const capped = Promise.race([settled, delay(DRAIN_CAP_MS)]);
  macDrains.set(key, capped);
  void capped.finally(() => {
    if (macDrains.get(key) === capped) macDrains.delete(key);
  });
}

function withMacLock<T>(address: string, fn: () => Promise<T>): Promise<T> {
  const key = normMac(address);
  const prevTail = macLocks.get(key) ?? Promise.resolve();
  // Zaman aşımına düşmüş ama HÂLÂ AKAN bir yazma varsa onu da bekle — yoksa iki
  // komut aynı sokete iç içe girer (yukarıdaki nota bak).
  const prev = Promise.all([prevTail, macDrains.get(key) ?? Promise.resolve()]);
  // Önceki iş başarılı da olsa hata da verse fn'i çalıştır (zincir kopmasın).
  const run = prev.then(fn, fn);
  // Kuyruk-ucu: settle'ı yut ki bir sonraki iş her koşulda başlayabilsin.
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  macLocks.set(key, tail);
  void tail.finally(() => {
    // Bu iş kuyruğun sonundaysa (arkasına kimse eklenmediyse) girdiyi temizle.
    if (macLocks.get(key) === tail) macLocks.delete(key);
  });
  return run;
}

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
  // createBond → sistem PIN diyaloğu — withSystemDialog kilit bastırır.
  await withSystemDialog(() => mod.pairDevice(address));
}

/** RFCOMM soketi açıp bağlantıyı doğrula (yazma/okuma yapmaz). */
export async function testConnection(address: string): Promise<void> {
  await withMacLock(address, () => ensureReady(address));
}

/**
 * HC-06 bağlantı KAYBINI algılasın diye kopardıktan sonra beklenen süre.
 * Modül link kaybını baseband seviyesinde görür ve slotu boşaltır; hemen yeniden
 * bağlanmak bazen ESKİ (ölü) soketi geri bulur.
 */
const RECONNECT_SETTLE_MS = 900;

/**
 * BAĞLANTIYI ZORLA KOPAR — bayat/yarı-açık RFCOMM soketini temizler (2026-08-17).
 *
 * SAHA VAKASI (Tambur): "yazıcıyla bağlantı ara ara kopuyor, yazıcıyı kapatıp
 * açınca düzeliyor". HC-06 köprüsü AYNI ANDA TEK RFCOMM bağlantısı kabul eder ve
 * uygulama soketi bir kez açıp hiç kapatmıyordu. Tablet tarafı düştüğünde
 * (uygulama arka planda öldürüldü, tablet uyudu, zaman aşımı) HC-06 hâlâ
 * "bağlıyım" sanıyor ve yeni bağlantı KABUL ETMİYOR — elektriği kesilene kadar.
 * "Yazıcı restartı düzeltiyor" tam olarak bunun imzasıdır.
 *
 * ⚠️ Bu fonksiyon her şeyi çözmez ve çözdüğünü İDDİA ETMEMELİ: yalnız Android'in
 * tuttuğu link'i düşürür. HC-06 Android'in hiç haberi olmayan bir hayalet
 * bağlantıda takılıysa tabletten yapılabilecek bir şey yoktur (yazıcının
 * elektriği kesilmeli). Bu yüzden çağıranlar sonucu "kesin düzeldi" diye
 * SUNMAZ — yazıcı restartı hâlâ son çare olarak söylenir.
 *
 * Modül/metot yoksa sessizce no-op: kopar-bağlan yolu, bağlanmanın kendisinden
 * daha kritik değil (fırlatırsa asıl baskıyı da düşürür).
 */
export async function forceDisconnect(address: string): Promise<void> {
  const mod = getModule();
  if (!mod?.disconnectFromDevice) return;
  await mod.disconnectFromDevice(address).catch(() => false);
  await delay(RECONNECT_SETTLE_MS);
}

/**
 * Bağlantıyı SIFIRLA: zorla kopar → bekle → yeniden bağlan.
 *
 * İki çağıranı var: operatörün "Bağlantıyı Sıfırla" düğmesi ve uygulama öne
 * geldiğinde koşan tazeleme. MAC kilidi altında koşar — devam eden bir baskının
 * ortasında soketi koparmak çıktıyı ikiye böler.
 */
export async function resetConnection(address: string): Promise<void> {
  await withMacLock(address, async () => {
    await forceDisconnect(address);
    await ensureReady(address);
  });
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
  // Aynı MAC'e giden yazma, paylaşılan soketteki okuma/yazmayla serileşir.
  return withMacLock(address, () => writeRawUnlocked(address, content, encoding, opts));
}

async function writeRawUnlocked(
  address: string,
  content: string,
  encoding: 'latin1' | 'ascii',
  opts?: { retry?: boolean; timeoutMs?: number },
): Promise<void> {
  const run = async (): Promise<void> => {
    const mod = await ensureReady(address);
    try {
      await mod.writeToDevice(address, content, encoding);
    } catch (e) {
      if (opts?.retry === false) throw e;
      // Soket düşmüş olabilir → tek sefer yeniden bağlan + yaz.
      //
      // ⚠️ ÖNCE KOPAR (2026-08-17): eskiden doğrudan `connectToDevice` çağrılıyordu
      // ve YARI-AÇIK soketi temizlemiyordu — Android hâlâ "bağlı" sandığı için
      // connect no-op'a düşüyor, yazma aynı ölü sokete gidiyor ve yeniden deneme
      // hiçbir şey KAZANDIRMIYORDU. Kopar + kısa bekle, HC-06 slotu boşaltsın.
      await forceDisconnect(address);
      await mod.connectToDevice(address);
      await mod.writeToDevice(address, content, encoding);
    }
  };
  const ms = opts?.timeoutMs;
  if (!ms) return run();
  // Uçuştaki iş AYRI tutulur: `withDeadline` çağıranı reddetse de bu promise
  // akmaya devam eder ve bir sonraki yazma onu beklemek ZORUNDADIR.
  const inflight = run();
  try {
    return await withDeadline(inflight, ms, () => {
      // Askıda kalan connect/write'ı koparmayı dene — sonraki deneme temiz başlasın.
      void getModule()?.disconnectFromDevice?.(address).catch(() => {});
    });
  } catch (e) {
    // ⚠️ Zaman aşımında native yazma HÂLÂ AKIYOR olabilir. Çağıran hızlıca hata
    // alsın (kuyruk donmasın) ama sıradaki etiket bu baytların üstüne YAZMASIN.
    registerDrain(address, inflight);
    throw e;
  }
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
  // Aynı MAC'e giden tüm I/O serileşir (withMacLock) — paylaşılan HC-06 soketinde
  // clear→write→read döngüsü başka bir okuma/yazmayla çakışıp tamponu bozmasın.
  return withMacLock(address, () => readResponseUnlocked(address, opts));
}

async function readResponseUnlocked(address: string, opts: ReadResponseOptions = {}): Promise<string> {
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
