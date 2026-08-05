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
// - ⚠️ TEK İSTİSNA — PARTİ NO (`P`) DOLGUSUZDUR (2026-08-05, kullanıcı kararı):
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
