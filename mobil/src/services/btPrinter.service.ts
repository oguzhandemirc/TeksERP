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
  msSinceLastWrite,
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
 * BASKI ZAMANLAMA AYARLARI (2026-08-19 saha teşhisi) — mutable, test küçültür.
 *
 * ⚠️ SAHA VAKASI (Tambur, T190826F0040 + T190826F0143): etiketlerin BAŞTAKİ
 * alanları (QR, isim, metraj, barkod) basılmıyordu. Render edilen PPLB akışı
 * bayt bayt karşılaştırıldı: eksik alanlar akışın kesintisiz bir ÖN EKİNE denk
 * geliyordu (0143'te ilk 220/314 bayt), yani yazıcı komutları YANLIŞ ÇİZMİYOR —
 * akışın başını HİÇ ALMIYORDU. Hayatta kalan alanlar doğru yerdeydi çünkü EPL2
 * koordinatları mutlaktır; bu yüzden hata "kaymış" değil "eksik" görünüyordu.
 *
 * Ölçüm (17-19 Ağu, 601 baskı): hata oranı son baskıdan bu yana geçen süreye
 * bağlı bir BASAMAK — <30 sn %2, >60 sn %15 ve düz. Aynı kodu koşan KK1
 * yazıcısında 195 baskıda 0 hata → yazılım hattı temiz, sorun soğuk BT
 * hattının/köprünün uyanma penceresi. Çare: soğuk hatta İLK giden şey asıl yük
 * OLMASIN.
 */
export const printTuning = {
  /** Son başarılı yazmanın üzerinden bu kadar geçtiyse hat SOĞUK sayılır. */
  coldAfterMs: 20_000,
  /** Isınma baytından sonra beklenen süre (ölçülen kayıp penceresi ~100-230 ms).
   *  ⚠️ Sahada kalıntı hata kalırsa BÜYÜTÜLECEK tek değer budur. */
  warmupSettleMs: 300,
  /** İki baskı işi arası asgari boşluk — bkz. `prepareLink` A4 notu. */
  minJobSpacingMs: 3_000,
  /** Parça boyu + parça arası bekleme. FİZİKSEL AYAR: HC-06 taşarsa (çöp çıktı)
   *  DELAY artır; çok yavaşsa azalt (asıl sınır HC-06 baud'u). */
  chunkBytes: 256,
  chunkDelayMs: 50,
};

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** MAC başına son baskı İŞİNİN bitiş anı (başarılı ya da değil). */
const lastJobEndAt = new Map<string, number>();

/**
 * HATTI BASKIYA HAZIRLA — ısınma baytı + oturma (2026-08-19).
 *
 * İki tetikleyicisi var:
 *  1. SOĞUK HAT (asıl bahis): son başarılı yazmadan ≥ `coldAfterMs` geçmişse.
 *     Soğuk hatta yazılan ilk baytlar yeniyor → feda edilecek şey asıl yük değil
 *     zararsız bir CR/LF olsun. EPL2/PPLA/ZPL üçünde de boş satır no-op'tur;
 *     üstelik yarım kalmış bir metin satırını KAPATIR (yazıcı ayrıştırıcısı
 *     takılıysa küçük bir bonus).
 *  2. EPİSOD (A4, daha zayıf kanıt — dürüstçe yazılıyor): bozuk baskıdan sonra
 *     <8 sn içinde yapılan tekrar denemelerin %100'ü de bozuk çıkıyordu. Bir
 *     önceki iş çok yakınsa aradaki farkı bekle ve ısınmayı ZORLA. Asıl çözüm
 *     1. maddedir; bu, operatörün öfkeyle üst üste basmasını yumuşatır.
 */
async function prepareLink(address: string, opts?: { force?: boolean }): Promise<void> {
  const key = address.trim().toUpperCase();
  let force = opts?.force === true;
  const endedAt = lastJobEndAt.get(key);
  if (endedAt != null) {
    const sinceJob = Date.now() - endedAt;
    if (sinceJob < printTuning.minJobSpacingMs) {
      await delay(printTuning.minJobSpacingMs - sinceJob);
      force = true;
    }
  }
  const sinceWrite = msSinceLastWrite(address);
  const cold = sinceWrite == null || sinceWrite >= printTuning.coldAfterMs;
  if (!cold && !force) return;
  // Isınma yazması da başarısız olabilir (yazıcı kapalı) — o zaman asıl yük
  // zaten patlayacak; burada YUTMUYORUZ ki hata mesajı tek yerden gelsin.
  await writeRaw(address, '\r\n', 'latin1', { retry: true, timeoutMs: 12_000 });
  await delay(printTuning.warmupSettleMs);
}

/**
 * İçeriği PARÇA PARÇA yaz — HC-06 köprüsünde AKIŞ KONTROLÜ YOKTUR, tek seferde
 * yazılan uzun bir blok yazıcının seri buffer'ını taşırır ve taşan baytlar
 * sessizce düşer. İlk parça retry'lı (soket bayatsa yeniden bağlanır), sonraki
 * parçalar retry'sız — akış ortasında reconnect çıktıyı ikiye böler.
 * ensureReady idempotent → tüm parçalar TEK RFCOMM'u paylaşır.
 */
async function writeChunked(address: string, latin1Bytes: string): Promise<void> {
  const size = printTuning.chunkBytes;
  for (let i = 0; i < latin1Bytes.length; i += size) {
    const chunk = latin1Bytes.slice(i, i + size);
    await writeRaw(address, chunk, 'latin1', { retry: i === 0, timeoutMs: 12_000 });
    if (i + size < latin1Bytes.length) await delay(printTuning.chunkDelayMs);
  }
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
 *
 * 2026-08-19: yük artık ISINMIŞ hatta ve PARÇA PARÇA gider (bkz. printTuning).
 * İkinci denemeden önce de `prepareLink` koşar — orada gönderilen CR/LF, yarım
 * kalmış ilk denemenin satırını kapatarak ayrıştırıcıyı temiz noktaya çeker.
 */
export async function printPpla(address: string, content: string): Promise<void> {
  if (!content) throw new Error('Etiket verisi boş');
  const key = address.trim().toUpperCase();
  try {
    try {
      await prepareLink(address);
      await writeChunked(address, content);
    } catch {
      await delay(2_500);
      await prepareLink(address, { force: true });
      await writeChunked(address, content);
    }
  } finally {
    lastJobEndAt.set(key, Date.now());
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

/**
 * Raster (binary GW bitmap) baskısı — HC-06 BT-SPP köprüsü küçük buffer + AKIŞ
 * KONTROLÜ YOK; ~40KB'i tek yazınca yazıcının seri buffer'ı taşar → boş/çöp. Bu yüzden
 * PARÇA-PARÇA yazılır (`writeChunked`), aralarında HC-06'nın seri porta boşaltması
 * için beklenir. `latin1Bytes` = base64'ten atob ile çözülmüş ham baytlar
 * (her char = 1 bayt, birebir).
 *
 * 2026-08-19: komut yolundaki (`printPpla`) ısınma disiplini buraya da uygulandı —
 * raster yükü zaten parçalıydı ama İLK parçası da soğuk hatta gidiyordu.
 */
export async function printRawBytes(address: string, latin1Bytes: string): Promise<void> {
  if (!latin1Bytes) throw new Error('Etiket verisi boş');
  const key = address.trim().toUpperCase();
  try {
    await prepareLink(address);
    await writeChunked(address, latin1Bytes);
  } finally {
    lastJobEndAt.set(key, Date.now());
  }
}
