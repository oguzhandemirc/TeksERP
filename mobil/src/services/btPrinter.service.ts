// =============================================================================
// Bluetooth (Classic / SPP) etiket yazıcısı servisi — Argox OS-214 plus + seri
// lehimli HC-05/06. Backend'in ürettiği native komut string'ini (PPLA/PPLB/ZPL)
// eşleşmiş yazıcıya RFCOMM ile yazar.
//
// Artık ince sarmalayıcı: transport `hal/btClassic.transport`. Public API
// (isBtPrinterSupported/listBondedPrinters/testConnection/printPpla/printRaw)
// geriye dönük korunur; çağrı yerleri (LabelPrinter, BtPrinterSettingsCard) değişmez.
// =============================================================================

import {
  isBtSupported,
  listBonded,
  discoverDevices,
  isBonded,
  pairByMac,
  testConnection as halTestConnection,
  writeRaw,
  type BtBondedDevice,
} from './hal/btClassic.transport';

/** Yazıcı satırı — eşleşme durumu (paired) UI'da "eşleşecek" rozetini besler. */
export type BtPrinter = BtBondedDevice & { paired?: boolean };

/** Bu derlemede Bluetooth Classic native modülü mevcut mu? */
export function isBtPrinterSupported(): boolean {
  return isBtSupported();
}

/** Eşleşmiş (bonded) cihazları döner. Modül yoksa boş liste. */
export function listBondedPrinters(): Promise<BtPrinter[]> {
  return listBonded().then((rows) => rows.map((r) => ({ ...r, paired: true })));
}

/**
 * Eşleşmiş + çevrede keşfedilen cihazları birleşik döner (MAC'e göre tekilleştirir).
 * Eşleşmiş olanlar `paired:true`; keşifte çıkan yeni cihazlar `paired:false` →
 * seçilince otomatik eşleştirilir (Android ayarlarına girmeden). Keşif başarısız
 * olursa yalnız eşleşmişlerle döner (graceful degrade).
 */
export async function findPrinters(): Promise<BtPrinter[]> {
  const bonded = await listBondedPrinters();
  const byMac = new Map<string, BtPrinter>();
  for (const b of bonded) byMac.set(b.address.trim().toUpperCase(), b);
  try {
    const found = await discoverDevices();
    for (const d of found) {
      const key = d.address.trim().toUpperCase();
      if (!byMac.has(key)) byMac.set(key, { ...d, paired: false });
    }
  } catch {
    // Keşif izin/donanım/New-Arch nedeniyle patlarsa eşleşmiş liste yeterli.
  }
  return [...byMac.values()];
}

/** Bir yazıcı eşleşik değilse eşleştir (PIN bir kez). Zaten eşleşikse no-op. */
export async function ensurePrinterPaired(address: string): Promise<void> {
  if (await isBonded(address)) return;
  await pairByMac(address);
}

/** Eşleşmiş yazıcıya RFCOMM soketi açıp bağlantıyı doğrular — fiziksel baskı yapmaz. */
export function testConnection(address: string): Promise<void> {
  return halTestConnection(address);
}

/**
 * Native komut string'ini (PPLA/PPLB/ZPL) eşleşmiş yazıcıya yaz — dil-agnostik.
 * Cihazın diline göre içerik backend'de üretilir; burası yalnız ham baytları yazar.
 */
export function printRaw(address: string, content: string): Promise<void> {
  return printPpla(address, content);
}

/**
 * Native komut string'ini eşleşmiş yazıcıya yaz. İçerik latin1-güvenli (backend
 * asciiFold) + STX/CR kontrol baytları (<0x20) → 'latin1' encoding bayt-bire-bir korur.
 * Bayat soket halinde bir kez yeniden bağlanıp dener. Her deneme 12 sn sert zaman
 * sınırlı: yazıcı kapalı / HC-06'yı başka cihaz tutuyorsa askıda kalıp KUYRUĞU
 * DONDURMAK yerine net hata verir → sıradaki etiket basılmaya devam eder.
 * GEÇİCİ MEŞGUL için otomatik 2. deneme: HC-06 tek RFCOMM bağlantısı kabul eder —
 * başka tablet o an bir etiket basıyorsa 2.5 sn bekleyip bir kez daha denenir
 * (tipik baskı ~1-3 sn). Yine olmazsa hata fırlar (KK1 başarısızlar listesi +
 * elle Tekrar Dene devralır). Not: zaman aşımı veri yazıldıktan SONRA gelirse
 * tekrar deneme çift etiket basabilir — eksik etiketten iyidir (fazlası atılır).
 */
export async function printPpla(address: string, content: string): Promise<void> {
  if (!content) throw new Error('Etiket verisi boş');
  try {
    await writeRaw(address, content, 'latin1', { retry: true, timeoutMs: 12_000 });
  } catch {
    await new Promise((r) => setTimeout(r, 2_500));
    await writeRaw(address, content, 'latin1', { retry: true, timeoutMs: 12_000 });
  }
}

/**
 * YAZICIYI TAKILDIĞI YERDEN ÇIKARMAYI DENE (2026-08-19 saha vakası).
 *
 * Saha: "yazıcı takıldı, üstündeki fiziksel tuşla kapat-aç yaptık." Bu, soket
 * sorunundan FARKLI bir durumdur — yazıcının KOMUT AYRIŞTIRICISI takılıdır:
 * yarım kalmış bir blok yüzünden kalan baytları bekler ve sonraki her şeyi VERİ
 * olarak yutar. Bağlantıyı yenilemek bunu çözmez; yalnız yazıcının kendi durumunu
 * sıfırlamak çözer.
 *
 * Gönderilen dizi bilinçli olarak DİL-AGNOSTİKTİR — mobil taraf yazıcının dilini
 * (PPLA/PPLB/ZPL) bilmiyor (`DevicePeripheral` bu alanı taşımıyor):
 *   • `\x18` (CAN) — akış iptali, çoğu firmware'de yarım bloğu düşürür
 *   • `\x01#`      — PPLA/DPL "immediate" RESET; veri beklerken bile taranır
 *   • `~JA`         — ZPL "tüm işleri iptal et"
 *   • CR/LF dolgusu — yarım kalmış metin satırını kapatır
 * Yabancı dilde bu belirteçler geçersiz sayılıp yok sayılır.
 *
 * ⚠️ GARANTİ DEĞİL ve öyle sunulmamalı: yazıcı, saydığı bayt kotasını doldurmayı
 * bekliyorsa bu diziyi de veri olarak yutabilir. O zaman tek çare hâlâ elektriği
 * kesmektir. Arayüz metni bunu açıkça söyler.
 */
export async function unstickPrinter(address: string): Promise<void> {
  const seq = '\x18\r\n\x01#\r\n~JA\r\n';
  await writeRaw(address, seq);
}

/** Raster binary (GW bitmap) chunk boyu + parça arası bekleme. FİZİKSEL AYAR: HC-06
 *  taşarsa (çöp çıktı) DELAY artır; çok yavaşsa azalt (asıl sınır HC-06 baud'u). */
const RASTER_CHUNK_BYTES = 256;
const RASTER_CHUNK_DELAY_MS = 50;

/**
 * Raster (binary GW bitmap) baskısı — HC-06 BT-SPP köprüsü küçük buffer + AKIŞ
 * KONTROLÜ YOK; ~40KB'i tek yazınca yazıcının seri buffer'ı taşar → boş/çöp. Bu yüzden
 * PARÇA-PARÇA yazılır, aralarında HC-06'nın seri porta boşaltması için beklenir.
 * `latin1Bytes` = base64'ten atob ile çözülmüş ham baytlar (her char = 1 bayt, birebir).
 * İlk parça bağlanır (retry açık); sonraki parçalar retry'sız — akış ortasında reconnect
 * çıktıyı ikiye böler. ensureReady idempotent → tüm parçalar TEK RFCOMM'u paylaşır.
 */
export async function printRawBytes(address: string, latin1Bytes: string): Promise<void> {
  if (!latin1Bytes) throw new Error('Etiket verisi boş');
  for (let i = 0; i < latin1Bytes.length; i += RASTER_CHUNK_BYTES) {
    const chunk = latin1Bytes.slice(i, i + RASTER_CHUNK_BYTES);
    await writeRaw(address, chunk, 'latin1', { retry: i === 0, timeoutMs: 12_000 });
    if (i + RASTER_CHUNK_BYTES < latin1Bytes.length) {
      await new Promise((r) => setTimeout(r, RASTER_CHUNK_DELAY_MS));
    }
  }
}
