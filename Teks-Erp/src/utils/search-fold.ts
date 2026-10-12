// =============================================================================
// ARAMA KATLAMASI — TEK SÖZLEŞME (2026-08-19)
// =============================================================================
// ⚠️ BU DOSYA ÜÇ PROJEDE BAYT-BAYT AYNIDIR ve öyle KALMALIDIR:
//     Teks-Erp/src/utils/search-fold.ts
//     Electron/src/lib/search-fold.ts
//     mobil/src/utils/searchFold.ts
// Üçü ayrı projedir, ortak modül import EDİLEMEZ (mobil `permissions.ts` ile
// aynı durum). Bekçi md5 eşitliğini ölçer: `Teks-Erp/scripts/test_fold_contract.ts`.
// Birini değiştiren ÜÇÜNÜ birden değiştirir.
//
// ⚠️ AYRICA SQL `public.tr_fold(text)` İLE BİREBİR AYNI ÇIKTIYI ÜRETİR. Bu bir
// benzerlik değil SÖZLEŞMEDİR: aranan kolonların `xFold` gölgesini DB üretir
// (GENERATED ALWAYS … STORED), terimi ise bu dosya katlar. İkisi ayrışırsa arama
// SESSİZCE boş döner — hata yok, log yok. Bekçi tüm BMP'yi (63k karakter) canlı
// DB'ye karşı karşılaştırır; adım eklemek/çıkarmak İKİ TARAFTA birden yapılır
// (migration `20260819_search_fold*`).
//
// ── Neden `unaccent` DEĞİL ───────────────────────────────────────────────────
// İlk tasarım `lower(unaccent(x))` idi. Ölçüldü (2026-08-19): `unaccent`ın
// sözlüğü BMP'de 2407 karakterde saf NFD'den ayrılıyor ve JS'te taklit edilemez
// (`©`→`(c)`, `¼`→` 1/4`, `Ø`→`o`, `ß`→`ss`, Kiril/Yunan çevriyazısı). Ayrışma
// TEHLİKELİ yöndeydi: "Ø" içeren bir adı arayan operatöre 0 sonuç dönerdi.
// Bunun yerine katlama, JS'te BİREBİR üretilebilen adımlardan kuruldu:
//   normalize(NFD) → birleştirici işaretleri at → 26 harflik istisna tablosu →
//   YALNIZ ASCII küçültme → boşluk tekleme/kırpma
// Kazanç üç katmanlı: (1) JS ↔ SQL eşitliği YAPISAL; (2) `unaccent` uzantısı
// artık GEREKMİYOR (sahadaki PG'de kurulu değil); (3) `COLLATE "C"` pini ve
// ASCII-only küçültme sayesinde sonuç ORTAMDAN BAĞIMSIZ — dev (ICU en-US) ile
// sahadaki C locale kurulumu aynı cevabı verir. Eski `ILIKE` yolunun en sinsi
// hatası tam buydu: aynı arama iki ortamda farklı sonuç veriyordu.
//
// ⚠️ NFD/NFC KARARLILIĞI: Unicode'un normalizasyon kararlılık politikası,
// atanmış bir karakterin ayrışımının SÜRÜMLER ARASI DEĞİŞMEYECEĞİNİ garanti
// eder. Bu yüzden PostgreSQL 16 ile Node/Hermes farklı Unicode sürümleri
// taşısa bile bu katlama aynı kalır. (`unaccent.rules` böyle bir garanti
// TAŞIMIYORDU — vazgeçmenin dördüncü sebebi.)
//
// ⚠️ Latin DIŞI yazılar (Yunan, Kiril…) katlanmaz, İKİ TARAFTA DA olduğu gibi
// kalır — yani tutarlıdır, eşleşme çalışır; yalnız büyük/küçük duyarsızlığı
// olmaz. Fabrika ana verisi için bilinçli sınır.
//
// ⚠️ Bu KARŞILAŞTIRMA katlamasıdır — DEPOLANAN değeri DEĞİŞTİRMEZ. Depolama
// kuralı ayrıdır ve BÜYÜK harftir (backend `normalizeDisplayName`).
// ⚠️ SIRALAMA bu dosyanın işi DEĞİLDİR: Türkçede ç≠c, ı≠i ayrı harflerdir.
// Sıralama `Intl.Collator("tr")` / DB `COLLATE public.tr_sort` ile yapılır.
// Katlamayla sıralanan liste "Çanakkale"yi "Cebeci" ile "Ceyhan" arasına koyar.
// =============================================================================

/**
 * NFD ile ayrışmayan, tek karaktere inen harfler. Kaynak: `unaccent` sözlüğünün
 * Latin bölümünün bizimle örtüşen kısmı — mapping'i ONA UYDURDUK ki ileride
 * biri `unaccent`a dönmek isterse saklanan anahtarlar değişmesin.
 * `ı` (U+0131) BU TABLONUN ASIL SEBEBİDİR: Türkçe noktasız ı'nın ayrışımı yok.
 */
const FOLD_SINGLE_FROM = "ıØøŁłĐđÐðĦħŦŧŊŋĿŀſ";
const FOLD_SINGLE_TO = "iOoLlDdDdHhTtNnLls";
// ⚠️ İki dizi AYNI UZUNLUKTA olmalı ve i. karakterler eşleşmeli; sıra anlamlıdır.

/** Tek karakterin ÇOK karaktere indiği durumlar (`translate` ile yapılamaz). */
const FOLD_MULTI: readonly (readonly [string, string])[] = [
  ["Æ", "AE"],
  ["æ", "ae"],
  ["Œ", "OE"],
  ["œ", "oe"],
  ["Þ", "TH"],
  ["þ", "th"],
  ["ß", "ss"],
  ["Ĳ", "IJ"],
  ["ĳ", "ij"],
];

/**
 * Metni arama karşılaştırmasının kanonik biçimine indirger.
 * "ÇANAKKALE" · "çanakkale" · "Canakkale" · "ÇANAKKALE " → hepsi "canakkale".
 * "IŞIK" · "ışık" · "Işık" → hepsi "isik" (i-ailesinin dördü de `i`ye iner).
 */
export function foldSearchText(value: string): string {
  let out = value.normalize("NFD").replace(/[\u0300-\u036F]/g, "");
  out = out.replace(/[ıØøŁłĐđÐðĦħŦŧŊŋĿŀſ]/g, (ch) => {
    // ⚠️ `?? ch` yalnız tip tatmini değil: iki sabitin uzunluğu ayrışırsa
    // (birine harf eklenip diğerine eklenmezse) sessizce `undefined` yazılırdı.
    const idx = FOLD_SINGLE_FROM.indexOf(ch);
    return idx < 0 ? ch : (FOLD_SINGLE_TO[idx] ?? ch);
  });
  for (const [from, to] of FOLD_MULTI) out = out.split(from).join(to);
  // ⚠️ YALNIZ ASCII küçültme — `toLowerCase()` DEĞİL. SQL tarafı `COLLATE "C"`
  // ile küçültüyor ve o da yalnız A-Z'yi indiriyor; `toLowerCase()` Yunan/Kiril
  // harflerini de indirir ve iki taraf sessizce ayrışırdı.
  out = out.replace(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 32));
  // ⚠️ Boşluk sınıfı AÇIK yazılır: JS `\s` NBSP/U+2028'i de kapsar, PostgreSQL'in
  // C locale `[[:space:]]`'i kapsamaz. Açık sınıf ikisini eşitler.
  return out.replace(/[ \t\n\r\f\v]+/g, " ").replace(/^ +| +$/g, "");
}

/**
 * ARAMA TERİMİ katlaması — `foldSearchText` + LIKE joker temizliği.
 *
 * ⚠️ Prisma `contains` jokerleri KAÇIRMAZ (ölçüldü 2026-08-19: `contains:"%"`
 * tablodaki 32 müşterinin 32'sini döndürdü). Yani temizlenmemiş bir terim hem
 * yanlış sonuç verir hem de `%%%` gibi bir girdiyle index'i işe yaramaz kılar.
 * Sunucuya giden HER terim buradan geçer.
 */
export function foldSearchTerm(value: string): string {
  return foldSearchText(value).replace(/[%_\\]/g, "");
}

/**
 * `needle` katlanmış hâliyle `haystack` içinde geçiyor mu? (istemci içi süzme)
 * Boş/whitespace arama TÜM kayıtları eşleştirir (süzgeç yok sayılır).
 *
 * ⚠️ Çağıran terime ÖN İŞLEM UYGULAMAZ. `foldedIncludes(x, q.toLowerCase())`
 * yazımı BOZUKTUR: "ŞAHİN".toLowerCase() → "şahi̇n" (i + U+0307 birleştirici
 * nokta) ve o nokta katlamadan sonra da kalır. 2026-08-19'da beş Electron
 * ekranında tam bu satır vardı; büyük "İ" içeren her arama 0 satır dönüyordu.
 */
export function foldedIncludes(haystack: string | null | undefined, needle: string): boolean {
  const q = foldSearchText(needle);
  if (q.length === 0) return true;
  return foldSearchText(haystack ?? "").includes(q);
}

/**
 * Çok kelimeli terimi parçalarına ayırır — "şahin tekstil" ↔ "tekstil şahin"
 * aynı sonucu versin diye her kelime AYRI `contains` koşulu olur (AND).
 * Boş dizi = süzgeç yok (çağıran `if (tokens.length)` ile korur).
 */
export function foldSearchTokens(value: string): string[] {
  const folded = foldSearchTerm(value);
  return folded.length === 0 ? [] : folded.split(" ").filter((t) => t.length > 0);
}
