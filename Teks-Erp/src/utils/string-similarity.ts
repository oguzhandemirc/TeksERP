// =============================================================================
// METİN BENZERLİĞİ — saf yardımcılar (mükerrer tespiti, 2026-08-22)
// =============================================================================
// Canlıda `pg_trgm` YOK (saha yedeği: yalnız plpgsql) ve ana veri tabloları
// yüzlerce satır → benzerlik JS tarafında, O(n²) kabul. DB'ye dokunmaz, tamamı
// bekçiyle ölçülür (`scripts/test_duplicate_detection.ts`).
//
// ── KARŞILAŞTIRMA BİRİMİ KARAKTER DEĞİL **KELİME** (2026-08-22, saha kararı) ──
// İlk sürüm skoru `max(Jaro-Winkler, token-sort)` ile hesaplıyordu. Jaro-Winkler'in
// ORTAK ÖN EK BONUSU, adın sonuna eklenen ANLAMLI bir kelimeyi görmezden geliyor:
// canlı veride "BOYER EMRE" ↔ "BOYER" tam **0.900** ile eşiği geçip aday oldu ve
// kullanıcı "farklı firma" dedi (aynı mekanizma "MODA" ↔ "MODA ANKARA"yı da
// aday yapardı). Ölçüldü: JW 0.900 · token-sort 0.500 — yani kelime bazlı bakış
// zaten DOĞRU cevabı veriyordu. Bu yüzden JW KALDIRILDI; skor artık SIRALI KELİME
// HİZALAMASIDIR: her kelime karşısındakiyle eşlenir, eşi olmayan kelime 0 alır.
//   • FIRM    (müşteri/fason): gürültü kelimeleri düşer ("LTD ŞTİ" ↔ "A.Ş."),
//     skor = hizalı çiftlerin ORTALAMASI → eklenen anlamlı kelime skoru yarıya böler.
//   • PRODUCT (kumaş/renk): ad bir VARYANT AİLESİDİR; gürültü uygulanmaz, kelime
//     sayısı farkı doğrudan 0, skor = EN DÜŞÜK çift (tek renk kelimesi farkı yeter).
// Yalnız boşluk/ayraç farkı (sıkıştırılmış metin eşit) her iki profilde de 1.
//
// ⚠️ Eşik artık ANLAMLI bir ölçek: %100 = yalnız yazım/boşluk farkı · %90 =
// neredeyse aynı · %80 = tek kelimede bir harf hatası ("ŞAHİN"↔"SAHİM").
// Panelden düşürülünce (Ayarlar → Müşteriler) yazım hataları da gelir; "BOYER EMRE"
// sınıfı (fazladan kelime) hiçbir eşikte gelmez — 0.50'de kalır.
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

/** Sıkıştırılmış anahtar: yalnız harf+rakam ("MİKRO CANVAS" → "mikrocanvas"). */
export function compactKey(folded: string): string {
  return tokenize(folded).join("");
}

/** Gürültü kelimelerini at (firma eklentileri: tekstil, ltd, sti, as, san, tic…). */
export function stripNoiseWords(folded: string, noise: ReadonlySet<string>): string {
  const kept = tokenize(folded).filter((t) => !noise.has(t));
  // Hepsi gürültüyse (örn. "TEKSTİL A.Ş.") orijinali koru — boş metin karşılaştırılamaz.
  return kept.length > 0 ? kept.join(" ") : tokenize(folded).join(" ");
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

/** Düzenleme-mesafesi oranı (0..1). İki boş metin → 1, biri boş → 0. */
export function editRatio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

/**
 * SIRALI KELİME HİZALAMASI (0..1). Token'lar sıralanır (kelime SIRASI önemsiz),
 * aynı sıradakiler karşılaştırılır; kısa listenin eksik kalan yerleri boş sayılır
 * ve 0 alır — yani "fazladan anlamlı kelime" cezalandırılır.
 *   `avg` → çiftlerin ortalaması (firma: bir kelime eklenmesi skoru böler)
 *   `min` → en düşük çift (ürün: tek kelime farkı yeter)
 */
export function alignedTokenScore(a: string, b: string, mode: "avg" | "min"): number {
  const ta = tokenize(a).sort();
  const tb = tokenize(b).sort();
  const n = Math.max(ta.length, tb.length);
  if (n === 0) return 0;
  let sum = 0;
  let min = 1;
  for (let i = 0; i < n; i++) {
    const s = editRatio(ta[i] ?? "", tb[i] ?? "");
    sum += s;
    if (s < min) min = s;
  }
  return mode === "avg" ? sum / n : min;
}

/**
 * FİRMA adı benzerliği (0..1) — müşteri / fason firma.
 * Gürültü kelimeleri düşer, sonra sıralı kelime hizalaması (ortalama).
 * "BOYER EMRE" ↔ "BOYER" = 0.50 (fazladan anlamlı kelime), "X A.Ş." ↔ "X LTD ŞTİ" = 1.
 * NUMERİK KORUMA çağıranda (`numericTokensEqual`).
 */
export function firmNameSimilarity(aFolded: string, bFolded: string, noise: ReadonlySet<string>): number {
  const a = stripNoiseWords(aFolded, noise);
  const b = stripNoiseWords(bFolded, noise);
  if (!a || !b) return 0;
  if (compactKey(a) === compactKey(b)) return 1;
  return alignedTokenScore(a, b, "avg");
}

/**
 * ÜRÜN/RENK adı benzerliği (0..1) — muhafazakâr: ad bir varyant ailesidir.
 *   • sıkıştırılmış metin eşitse (yalnız boşluk/ayraç farkı) → 1
 *   • kelime SAYISI farklıysa → 0 ("KRİSTAL" ↔ "KRİSTAL -ALTIN", "A.GRİ" ↔ "GRİ")
 *   • aksi hâlde sıralı kelime hizalamasının EN DÜŞÜK çifti — "KRİSTAL GÜMÜŞ EKRU"
 *     ↔ "… GRİ"de "ekru"↔"gri" %25 çeker (birleşik metin oranı bunu %90'a
 *     sulandırıyordu, canlı kopyada ölçüldü).
 * Gürültü kelimesi uygulanmaz (tek harfli "A."/"S." ön ekleri anlam taşır).
 */
export function productNameSimilarity(aFolded: string, bFolded: string): number {
  if (!aFolded.trim() || !bFolded.trim()) return 0;
  if (compactKey(aFolded) === compactKey(bFolded)) return 1;
  if (tokenize(aFolded).length !== tokenize(bFolded).length) return 0;
  return alignedTokenScore(aFolded, bFolded, "min");
}
