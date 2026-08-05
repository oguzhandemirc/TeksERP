// =============================================================================
// TeksERP - Otomatik Belge/Barkod Kod Formatı (tek tip)
// =============================================================================
// Tüm insan-okur belge numaraları ve tarama barkodları TEK kalıba oturur:
//
//   PREFIX + GGAAYY + NNNN
//   └─────┘ └────┘ └──┘
//   2-3 harf  gün-ay-yıl  4 hane günlük sıra (zero-pad)
//
// Örnek (12 Temmuz 2026): SIP1207260001, RK1207260001, CV1207260001.
//
// - Tarih Türkiye sırasında: GG.AA.YY (gün-ay-yıl) — `120726`.
// - Ayraçsız: el tarayıcı klavye-taklidi Türkçe düzende `-`'yi `*`'a çeviriyordu;
//   salt harf-rakam her düzende sorunsuz taranır.
// - Sıra GÜN + PREFIX başına 1'den başlar; 4 hane = 9999/gün kapasite.
// - ⚠️⚠️ PARTİ NO (`P`) BU KALIBIN TAMAMEN DIŞINA ÇIKABİLİR — `batch.shortNumberEnabled`
//   bayrağı AÇIKKEN (varsayılan) parti no `P01 … P99` arasında DÖNEN bir sayıdır ve
//   99'dan sonra P01'e sarar. Tarih taşımaz, dolayısıyla BENZERSİZ DEĞİLDİR: aynı
//   numara birkaç günde bir yeniden kullanılır (2026-08-05 kullanıcı kararı — fabrika
//   numaralı fiziksel parti plakası kullanıyor, plaka bitince başa dönüyor). Bunun
//   `batches.batchNumber` üzerindeki `@unique` kısıtının KALDIRILMASINI gerektirdiğini
//   unutma; kimlik artık yalnız `Batch.id` (uuid). Ayrıntı: `SHORT_BATCH_*` yardımcıları
//   ve `batch.service.generateBatchNumberTx`.
//   Bayrak KAPALIYKEN aşağıdaki dolgusuz günlük kalıba düşülür (eski davranış).
// - ⚠️ İKİNCİ İSTİSNA — PARTİ NO (`P`) günlük kalıpta da DOLGUSUZDUR (2026-08-05):
//   `P0508261`, `P05082619`, `P050826123`… Sıra kuralı aynı (gün başına 1'den),
//   yalnız zero-pad yok ve bu yüzden hane sayısı SERBEST (9999/gün tavanı da
//   düşer). Parti no OKUTULMAZ (barkod/QR değil, kâğıda basılan iz) — sabit
//   uzunluk varsayan bir tarayıcı/parser yolu yok, `isDailyCode` "P" ile hiç
//   çağrılmıyor. Ayrıştırma dolgudan bağımsızdır: prefix `P`+GGAAYY her zaman
//   7 karakter, kuyruk `parseInt` edilir → eski dolgulu kayıtlar (`P0508260019`)
//   aynı gün içinde bile sorunsuz okunur ve sayaç kaldığı yerden devam eder.
//   ⚠️ Bedeli: dolgusuz kodda SÖZLÜKSEL sıra ≠ SAYISAL sıra (`P05082610` <
//   `P0508262`). Parti listeleyen hiçbir yer `orderBy: batchNumber` KULLANMAZ,
//   hepsi `createdAt` ile sıralar — yeni bir yüzey eklerken aynısını yap.
// - Checksum/Crockford YOK: etiketler her zaman OKUTULUR (elle yazılmaz) ve
//   Code128/QR sembolünün kendi check-digit'i yanlış okumayı zaten yakalar.
//   İnsan-okur kod = tarama barkodu (tek kod) — kartta iki ayrı kod basılmaz.
// - "Gün" = FABRİKA takvim günü (Europe/Istanbul) — `src/constants/time.ts`.
//   Sayaç GÜN başına sıfırlandığı için bu bir gün SINIRI kararıdır, gösterim değil.
// =============================================================================

import { factoryYmd } from "../constants/time";

/**
 * Türkiye sırasıyla tarih: GGAAYY (gün-ay-yıl). Örn 12 Temmuz 2026 → "120726".
 *
 * GÜN = FABRİKA TAKVİM GÜNÜ (`Europe/Istanbul`), süreç saat dilimi DEĞİL.
 * Bu bir gösterim tercihi değil, gün sınırı kararıdır: kod hem etikette basılan
 * insan-okur numaradır hem de günlük sıra sayacının anahtarıdır
 * (`where: { startsWith: prefix }`). Gece 01:30'da okutulan topun barkodu
 * operatörün takvimine göre BUGÜNÜ göstermeli ve sayaç o gün 0001'den
 * başlamalıdır.
 *
 * Eski hâli `date.getDate()/getMonth()/getFullYear()` ile süreç saat dilimine
 * (`TZ` env) yaslanıyordu ve bunu hiçbir yerde YAZMIYORDU. Sahadaki Windows
 * sunucu Europe/Istanbul olduğu için sonuç DOĞRUYDU — ama UTC kurulan/konteynere
 * alınan bir sunucuda her gece 00:00–03:00 arasında üretilen belge numaraları
 * BİR ÖNCEKİ günün GGAAYY'sini taşır ve o günün sayacına eklenirdi. Bugün
 * Europe/Istanbul host'ta bu değişiklik DAVRANIŞ DEĞİŞTİRMEZ (birebir aynı çıktı);
 * yaptığı tek şey kararı örtük olmaktan çıkarmaktır. Bkz. constants/time.ts.
 */
export function ddmmyy(date: Date = new Date()): string {
  const ymd = factoryYmd(date); // "YYYY-MM-DD" (fabrika takvim günü)
  return `${ymd.slice(8, 10)}${ymd.slice(5, 7)}${ymd.slice(2, 4)}`;
}

/**
 * Günlük kod prefix'i (sıra kuyruğu HARİÇ): `PREFIX + GGAAYY`.
 * `where: { field: { gte: prefix, startsWith: prefix } }` sorgusunda kullanılır —
 * gte index seek + startsWith collation-bağımsız tam-prefix (glibc seq-no bug'ına karşı).
 */
export function dailyCodePrefix(prefix: string, date: Date = new Date()): string {
  return `${prefix}${ddmmyy(date)}`;
}

/**
 * Tam kod: `PREFIX + GGAAYY + NNNN`. seq 1-tabanlı günlük sıra.
 * `digits = 1` → DOLGU YOK (`padStart(1)` seq ≥ 1 için no-op) ve hane serbest;
 * parti no (`P`) bunu kullanır, bkz. dosya başlığındaki istisna notu.
 */
export function buildDailyCode(
  prefix: string,
  seq: number,
  date: Date = new Date(),
  digits = 4,
): string {
  return `${dailyCodePrefix(prefix, date)}${String(seq).padStart(digits, "0")}`;
}

/**
 * Verilen kod listesinin (aynı gün+prefix) sayısal kuyruğundan SIRADAKİ sıra (max+1).
 * `fullPrefix` = `dailyCodePrefix(prefix, date)`. Prefix'i taşımayan / parse-edilemeyen
 * kayıtlar atlanır. Boş liste → 1. Lexicographic taşmaya (999>1000) karşı NUMERIC max.
 */
export function nextDailySeq(
  codes: Array<string | null | undefined>,
  fullPrefix: string,
): number {
  const max = codes.reduce<number>((m, code) => {
    if (!code || !code.startsWith(fullPrefix)) return m;
    const n = parseInt(code.slice(fullPrefix.length), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return max + 1;
}

/** Bir kodun `PREFIX + GGAAYY + NNNN` biçimine uyup uymadığı (tarama girişi doğrulaması). */
export function isDailyCode(code: string, prefix: string, digits = 4): boolean {
  const re = new RegExp(`^${prefix}\\d{6}\\d{${digits}}$`);
  return re.test(code.toUpperCase());
}

// =============================================================================
// KISA PARTİ NO — P01 … P99, körlemesine sarar (bayrak: batch.shortNumberEnabled)
// =============================================================================
// Buradaki üç fonksiyon SAF'tır (DB yok) — DB'ye dokunan orkestrasyon
// `batch.service.generateBatchNumberTx`'te. Ayrım bilinçli: sarma aritmetiği ve
// biçim, kilit/sorgu kurmadan birim testlenebilmeli (KK1 `duplicate-guard.helper`
// emsali; bekçi `scripts/test_batch_number_format.ts` §7).
// =============================================================================

/** Kısa parti no alt sınırı. Sıfır KULLANILMAZ — fabrikada P01'den başlayan plaka seti var. */
export const SHORT_BATCH_MIN = 1;

/** Kısa parti no üst sınırı; buradan sonra `SHORT_BATCH_MIN`'e sarılır. */
export const SHORT_BATCH_MAX = 99;

/**
 * Kısa parti no biçimi: `P` + İKİ HANE DOLGULU sıra → `P01`, `P42`, `P99`.
 *
 * Dolgu BURADA bilinçli olarak VAR — günlük parti kalıbının dolgusuzluğuyla
 * çelişmez, çünkü gerekçeleri farklıdır. Günlük kalıpta hane sayısı serbesttir
 * (sıra 9999'u aşabilsin diye); burada aralık 1-99 ile SABİT olduğu için dolgu
 * bedava gelir ve karşılığında sabit genişlik kazandırır: kâğıtta hizalı durur ve
 * yeni biçimin KENDİ içinde sözlüksel sıra = sayısal sıra olur.
 *
 * ⚠️ Bu, `orderBy: { batchNumber }` yasağını KALDIRMAZ. Eski günlük kodlar
 * (`P0508260019`) veritabanında kalıcı olarak yan yana yaşıyor ve karışık kümede
 * sözlüksel sıra yine anlamsızdır. Parti listeleyen her yer `createdAt` ile sıralar.
 */
export function buildShortBatchCode(seq: number): string {
  return `P${String(seq).padStart(2, "0")}`;
}

/**
 * Kod kısa parti biçiminde mi? Öyleyse sayısal değeri, değilse `null`.
 *
 * Aralık dışı (`P00`) `null` döner — üretmediğimiz bir değerdir; elle/veri
 * bozulmasıyla oluşmuşsa sayacın kaynağı olarak KABUL EDİLMEMELİ. `null` dönmesi
 * çağıranı `SHORT_BATCH_MIN`'e düşürür, yani en kötü ihtimalle P01'den devam edilir.
 *
 * Eski günlük kodlar (`P0508260019`) tanım gereği eşleşmez (8+ karakter) — sayaç
 * onları GÖRMEZ. Bu load-bearing: görseydi bayrak ilk açıldığında son günlük
 * partinin sırasını (örn. 28) okuyup P29'dan başlardı; oysa doğrusu P01'dir.
 */
export function parseShortBatchCode(code: string | null | undefined): number | null {
  if (!code || !/^P\d{2}$/.test(code)) return null;
  const n = parseInt(code.slice(1), 10);
  return n >= SHORT_BATCH_MIN && n <= SHORT_BATCH_MAX ? n : null;
}

/**
 * Sıradaki kısa parti no — KÖRLEMESİNE sarar (2026-08-05 kullanıcı kararı).
 *
 * "Körlemesine" = numaranın o an başka bir CANLI partide kullanılıp kullanılmadığına
 * BAKILMAZ. Bu bilinçli: fabrika benzersizliğin kalkacağını bilerek istedi ve
 * "boştaki numarayı bul" alternatifi "99'u da doluysa ne olacak" sorusunu doğurup
 * üretimi durdurabilecek bir hata yolu açardı.
 *
 * `last === null` (henüz hiç kısa parti yok / bozuk değer) → `SHORT_BATCH_MIN`.
 */
export function nextShortBatchSeq(last: number | null): number {
  if (last === null || !Number.isFinite(last)) return SHORT_BATCH_MIN;
  return (last % SHORT_BATCH_MAX) + SHORT_BATCH_MIN;
}
