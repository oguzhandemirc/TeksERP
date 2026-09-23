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

/**
 * KOD karşılaştırma anahtarı (tekillik kontrolü): `trim()` + iç boşluk tekleme +
 * **i-AİLESİ ASCII'ye indirgeme** + **YEREL-BAĞIMSIZ** büyük harf. Depolanan
 * değeri DEĞİŞTİRMEZ — yalnız "bu kod zaten var mı" sorusunu cevaplar.
 *
 * ⚠️ `foldNameForCompare` (name-normalize.helper) KOD İÇİN KULLANILAMAZ. O
 * fonksiyon `toLocaleUpperCase("tr-TR")` yapar; Türkçe kuralda `i → İ` ve
 * `I → I` olduğu için `"sip"` → `"SİP"`, `"SIP"` → `"SIP"` olur ve **tam da
 * korunmak istenen harf-farkı çifti eşleşmez**. Canlı fabrika verisinde 218
 * ürün kodunun 62'si `i/I` içeriyor (mitra, kristal, linen, piramit, victoria…)
 * — yanlış katlama korumanın büyük kısmını doğar doğmaz öldürürdü.
 *
 * ⚠️⚠️ AMA DÜZ `toUpperCase()` DE YETMEZ (2026-08-15 denetim düzeltmesi) —
 * TERS yönde aynı deliği açar ve o delik ölçüldü:
 *   • `"İ".toUpperCase() === "İ"` (U+0130 sabit kalır) → `"İSTANBUL"` ile
 *     `"istanbul"` ASLA eşleşmez. Bu, harf-duyarsızlığın en sık ihtiyaç duyulan
 *     hâlidir ve `customer-branch` şube ihracat kodunda ZATEN ÇALIŞIYORDU
 *     (orası eskiden tr-TR katlaması kullanıyordu) — düz `toUpperCase()`'e
 *     geçmek orada var olan bir korumayı SESSİZCE kaybettirirdi.
 *   • Kod alanında ASCII regex bulunmayan modeller (QualityGrade —
 *     canlı kod `1.KALITE`, PeripheralDevice, SubcontractorCategory,
 *     CustomerBranch) Türkçe harf kabul ediyor → `"1.KALİTE"` ikinci bir kimlik
 *     olarak sessizce doğabilirdi. `Roll.qualityGrade` bir SNAPSHOT KOD olduğu
 *     için etiketteki koşullu eleman (`label-elements.normalizeConditionValue`)
 *     o topları hiç eşleştiremezdi: hata yok, log yok.
 *
 * Bu yüzden i-ailesi (`i ı İ I`) karşılaştırmadan ÖNCE tek bir `I`'ya indirgenir.
 * Türkçe'de büyük/küçük eşlemesi İngilizce'den ayrışan **tek** harf ailesi budur;
 * `ç/ğ/ö/ş/ü` düz `toUpperCase()` ile zaten doğru döner.
 *
 * ⚠️ BEDELİ BİLİNÇLİ: `AKıN` ile `AKIN` artık AYNI kod sayılır (yanlış pozitif →
 * 409). Yön tercihi fail-closed: kimlik alanında "iki kayıt aynı kodu taşıyor"
 * sessiz ve kalıcı bir hatadır, "farklı bir kod girin" ise ekranda okunan ve
 * anında düzeltilebilen bir uyarıdır.
 *
 * İç boşluk teklenir (`"TR 34"` ≡ `"TR  34"`) — kod alanında boşluğa izin veren
 * tek yüzey `CustomerBranch.code`'dur ve orada bu davranış tr-TR katlamasından
 * MİRAS ALINMIŞTIR; kaldırmak yine sessiz bir koruma kaybı olurdu.
 *
 * Aynı ayrım repoda üç yerde daha yazılı (kod KİMLİKTİR, görüntü metni değil):
 * `config/label-elements.normalizeConditionValue`, `helpers/fold-type.ts`,
 * `fabric-property.service` değer kodu normalizasyonu. Bu, o kuralın kod
 * tekilliğine uygulanmış hâlidir.
 *
 * ⚠️ Katlama PG'YE BIRAKILMAZ (`mode:'insensitive'` / ILIKE / `lower()`):
 *   • Prisma `equals` + `mode:'insensitive'` **ILIKE** üretir → kullanıcının
 *     yazdığı kod PATTERN olur; `CODE_REGEX` alt çizgiye izin verdiği için
 *     `MUS_T10` arayan kullanıcı ilgisiz `MUSXT10` kaydına çarpıp SAHTE 409 alır.
 *   • `upper()/lower()` kolonun COLLATION'ına bağlıdır → dev'de yeşil, sahada
 *     kırmızı (ya da tersi) olabilir ve fark hiçbir yerde loglanmaz.
 *   • i-ailesi indirgemesinin SQL karşılığı zaten yok.
 * Karşılaştırma her zaman JS'te yapılır (base.service.ts:504-510 ile aynı kural).
 */
export function foldCodeForCompare(code: string): string {
  return code
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[iıİI]/g, "I")
    .toUpperCase();
}

/**
 * OKUTULAN KODU DEPOLANMIŞ BİÇİME ÇEVİRİR — barkod/kart/çuval aramalarının TEK kapısı.
 *
 * SAHA VAKASI (2026-08-17): kâğıda BÜYÜK harfle basılan barkod, el tarayıcısından
 * KÜÇÜK harf olarak geliyordu (klavye-taklidi düzen / Caps Lock inversiyonu — kodun
 * kontrolünde değil). Tam-eşleşme aramaları (`where: { barcode: code }`) yalnız
 * `.trim()` yapıyordu → top "yok" görünüyor, operatör sevkiyatı tamamlayamıyordu.
 * Ölçüldü: `T130826F0230` bulunuyor, `t130826f0230` bulunmuyor. Kayıtlı kodların
 * TAMAMI zaten büyük harf (rolls/traveler_cards/sacks: 0 istisna), yani düzeltilecek
 * olan VERİ değil GİRDİ.
 *
 * ⚠️ ÇÖZÜM `mode:"insensitive"` DEĞİL: Prisma onu ILIKE'a çevirir, `barcode`
 * üzerindeki unique index devre dışı kalır ve top tablosu büyüdükçe her okutma
 * seq scan'e döner. Girdiyi büyütmek index'i OLDUĞU GİBİ bırakır.
 *
 * ⚠️ `toLocaleUpperCase("tr")` KULLANMA: "i" → "İ" üretir ve ASCII barkodu bozar
 * (kodlarımızda Türkçe harf yok — `code-format` başlığındaki kalıba bak).
 *
 * ⚠️ `foldCodeForCompare` İLE KARIŞTIRMA: o bir KARŞILAŞTIRMA katlamasıdır
 * (i-ailesini `I`ya indirger, mükerrer ad/kod kontrolü için) ve sonucu bir
 * arama anahtarı olarak kullanılamaz. Bu fonksiyon ise "kullanıcının okuttuğu
 * şeyin DB'deki yazımı" sorusunu cevaplar.
 *
 * ⚠️ SERBEST METNE UYGULAMA: yalnız okutulan/yazılan KOD alanları içindir
 * (barkod, kart no, çuval no, sevk belge no). Müşteri adı, not, açıklama gibi
 * alanları büyütmek veriyi bozar.
 */
export function normalizeScanCode(code: string): string {
  return code.trim().toUpperCase();
}

// =============================================================================
// KISA PARTİ NO — 2026-09-23'te BURADAN KALKTI
// =============================================================================
// `SHORT_BATCH_MIN/MAX`, `buildShortBatchCode`, `parseShortBatchCode` ve
// `nextShortBatchSeq` silindi: ikisi de artık VERİDİR, kod değil. Aralık
// `number_series.startValue/maxValue`, sarma `number_series.wrap`, biçim
// `prefix/digits` kolonlarında yaşıyor (seri anahtarı `batchShort`) ve hesabı
// `helpers/series-counter.helper` ile `helpers/series-format.helper` yapıyor.
//
// Gerekçe (kullanıcı, 2026-09-23): "plakalar değişirse fabrikadakiler
// yazılımdan değiştirebilsin, benim yazılıma müdahale etmem gerekmesin; başka
// fabrikalara satarsak onların standardı farklı olabilir." Sabit kalsaydı her
// plaka seti değişimi bir sürüm gerektirirdi.
//
// Davranış AYNEN korundu: tohum `P` + 2 hane + aralık 1–99 + sarma AÇIK.
// =============================================================================
