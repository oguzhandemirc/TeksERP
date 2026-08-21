// =============================================================================
// METİN BENZERLİĞİ — saf yardımcılar (mükerrer tespiti, 2026-08-22)
// =============================================================================
// Canlıda `pg_trgm` YOK (saha yedeği: yalnız plpgsql) ve ana veri tabloları
// yüzlerce satır → benzerlik JS tarafında, O(n²) kabul. DB'ye dokunmaz, tamamı
// bekçiyle ölçülür (`scripts/test_duplicate_detection.ts`).
//
// Üç parça: Jaro-Winkler (yazım hatası / kısaltma), token-set oranı (kelime
// sırası / fazla kelime) ve NUMERİK TOKEN KORUMASI — canlı veri ölçümü
// (2026-08-22): kumaş adları varyant ailesidir ("KRİSTAL V-01" / "V-02",
// "QUALİTY 035" / "036"); trigram bunları 0.73–0.82 ile aday gösteriyordu ve
// HEPSİ yanlış pozitifti. Sayı taşıyan token kümeleri birebir eşit değilse
// iki ad ne kadar benzerse benzesin aday ÜRETİLMEZ.
// =============================================================================

/** Katlanmış metni token'lara böler: alfasayısal dışı her şey ayraç, boşlar atılır. */
export function tokenize(folded: string): string[] {
  return folded
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** İçinde rakam geçen token'lar (varyant/sayı) — sıralı, tekil. */
export function numericTokens(folded: string): string[] {
  return [...new Set(tokenize(folded).filter((t) => /\d/.test(t)))].sort();
}

/** İki numerik token kümesi birebir aynı mı (ikisi de boşsa evet). */
export function numericTokensEqual(a: string, b: string): boolean {
  const x = numericTokens(a);
  const y = numericTokens(b);
  return x.length === y.length && x.every((t, i) => t === y[i]);
}

/** Gürültü kelimelerini at (firma eklentileri: tekstil, ltd, sti, as, san, tic…). */
export function stripNoiseWords(folded: string, noise: ReadonlySet<string>): string {
  const kept = tokenize(folded).filter((t) => !noise.has(t));
  // Hepsi gürültüyse (örn. "TEKSTİL A.Ş.") orijinali koru — boş metin karşılaştırılamaz.
  return kept.length > 0 ? kept.join(" ") : tokenize(folded).join(" ");
}

/** Jaro benzerliği (0..1). */
function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;
  const matchWindow = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);
  const m1 = new Array<boolean>(len1).fill(false);
  const m2 = new Array<boolean>(len2).fill(false);
  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const lo = Math.max(0, i - matchWindow);
    const hi = Math.min(len2 - 1, i + matchWindow);
    for (let j = lo; j <= hi; j++) {
      if (m2[j] || s1[i] !== s2[j]) continue;
      m1[i] = true;
      m2[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!m1[i]) continue;
    while (!m2[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }
  const transpositions = t / 2;
  return (matches / len1 + matches / len2 + (matches - transpositions) / matches) / 3;
}

/** Jaro-Winkler (0..1): ortak ön ek (≤4) benzerliği yukarı çeker — firma adlarında iyi. */
export function jaroWinkler(s1: string, s2: string): number {
  const j = jaro(s1, s2);
  if (j === 0) return 0;
  let prefix = 0;
  const max = Math.min(4, s1.length, s2.length);
  for (let i = 0; i < max; i++) {
    if (s1[i] !== s2[i]) break;
    prefix++;
  }
  return j + prefix * 0.1 * (1 - j);
}

/** Levenshtein mesafesi. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Düzenleme-mesafesi oranı (0..1). */
function ratio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

/**
 * Token-SORT oranı (fuzzywuzzy `token_sort_ratio` kalıbı, 0..1): kelimeler sıralanıp
 * birleştirilir, düzenleme-mesafesi oranı alınır → kelime SIRASI cezalandırılmaz
 * ("TEKSTİL ŞAHİN" ≡ "ŞAHİN TEKSTİL"), fazladan kelime CEZALANDIRILIR.
 *
 * ⚠️ `token_set_ratio` BİLİNÇLİ KULLANILMADI: alt-küme adları %100 sayar ("MODA" ⊂
 * "MODA ANKARA" → 1.0) — firma adlarında bu, farklı şubeleri/firmaları eşik ne olursa
 * olsun aday yapardı (bekçi §4'te ölçüldü). Eklenti farkı ("LTD ŞTİ" ↔ "A.Ş.") zaten
 * gürültü kelimeleriyle (`stripNoiseWords`) düşüyor; geriye kalan çekirdek farkı gerçek farktır.
 */
export function tokenSortRatio(a: string, b: string): number {
  const sa = tokenize(a).sort().join(" ");
  const sb = tokenize(b).sort().join(" ");
  return ratio(sa, sb);
}

/** Sıkıştırılmış anahtar: yalnız harf+rakam ("MİKRO CANVAS" → "mikrocanvas"). */
export function compactKey(folded: string): string {
  return tokenize(folded).join("");
}

/**
 * FİRMA adı benzerliği (0..1) = max(Jaro-Winkler, token-sort) — gürültü kelimeleri
 * düşülmüş katlanmış adlar üzerinde. NUMERİK KORUMA çağıranda (`numericTokensEqual`).
 */
export function firmNameSimilarity(aFolded: string, bFolded: string, noise: ReadonlySet<string>): number {
  const a = stripNoiseWords(aFolded, noise);
  const b = stripNoiseWords(bFolded, noise);
  if (!a || !b) return 0;
  return Math.max(jaroWinkler(a, b), tokenSortRatio(a, b));
}

/**
 * ÜRÜN/RENK adı benzerliği (0..1) — muhafazakâr: ad bir varyant ailesidir.
 *   • sıkıştırılmış metin eşitse (yalnız boşluk/ayraç farkı) → 1
 *   • token SAYISI farklıysa → 0 ("KRİSTAL" ↔ "KRİSTAL -ALTIN", "A.GRİ" ↔ "GRİ")
 *   • aksi hâlde sıralı token'lar ÇİFT ÇİFT karşılaştırılır, skor = en DÜŞÜK çiftin
 *     düzenleme-mesafesi oranı. Birleşik metin oranı (token-sort) KULLANILMAZ: uzun
 *     ortak token'lar tek farklı kelimeyi sulandırıyor ("… KRİSTAL GÜMÜŞ EKRU" ↔ "… GRİ"
 *     birleşik %90'a çıkıyordu; çift çift bakınca "ekru"↔"gri" %25 → aday değil).
 *     Jaro-Winkler'in ön ek bonusu da YOK (aileleri %93'e çıkarıyordu).
 * Gürültü kelimesi uygulanmaz. NUMERİK KORUMA çağıranda.
 */
export function productNameSimilarity(aFolded: string, bFolded: string): number {
  const ca = compactKey(aFolded);
  const cb = compactKey(bFolded);
  if (!ca || !cb) return 0;
  if (ca === cb) return 1;
  const ta = tokenize(aFolded).sort();
  const tb = tokenize(bFolded).sort();
  if (ta.length !== tb.length) return 0;
  let min = 1;
  for (let i = 0; i < ta.length; i++) min = Math.min(min, ratio(ta[i], tb[i]));
  return min;
}

/** @deprecated Profilsiz eski ad — FIRM davranışı. Yeni kod `firmNameSimilarity`/`productNameSimilarity`. */
export const nameSimilarity = firmNameSimilarity;
