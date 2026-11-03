// =============================================================================
// Belgeden okunan KOD ↔ kayıtlı kod karşılaştırması (Gülkesim K30-E; saf, DB yok)
// =============================================================================
// İstasyonda "Belge okut" her seferinde yeni fotoğraf okur; bir karakterlik OCR hatası (O↔0, I/l↔1, S↔5, B↔8)
// ya da ayraç farkı ("P26-18733") iş emrini kaybettirmesin. Belge no ve parti no yolu AYNI fonksiyondan geçer.
// Yanlış eşleşmeye karşı: tolerans yalnız ≥4 karakterli değerde; tam eşleşme varsa toleranslı aday düşer.
// =============================================================================

/** Toleranslı karşılaştırmanın en kısa değeri (ayraçsız) — daha kısası yalnız tam eşleşir. */
export const MIN_TOLERANT_CODE_LENGTH = 4;

export type CodeMatchTier = "EXACT" | "TOLERANT";

const SEPARATORS = /[\s\-‐-―._*/\\]/g;
/** Rakam koşusunda harfin karıştığı rakam (OCR). */
const DIGIT_LOOKALIKE: Readonly<Record<string, string>> = { O: "0", I: "1", L: "1", S: "5", B: "8" };
const RUN = /[0-9OILSB]+/g;

/** Harf büyüklüğü + aksan katlaması (İ/ı → I, Ş → S); dil-yerel büyük harf kullanılmaz. */
function fold(v: string): string {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

/** Tam eşleşme anahtarı: kırpılmış + harf duyarsız (SQL `equals … insensitive` ile aynı ölçü). */
export function exactCodeKey(v: string | null | undefined): string {
  return fold((v ?? "").trim());
}

/**
 * Toleranslı anahtar: ayraçsız (boşluk/tire/nokta/alt çizgi/yıldız/eğik çizgi), büyük harf; içinde EN AZ BİR gerçek rakam olan
 * [0-9OILSB] koşusunda O→0, I/L→1, S→5, B→8. Rakamsız koşu (ör. "SOL") olduğu gibi kalır.
 */
export function tolerantCodeKey(v: string | null | undefined): string {
  const s = fold(v ?? "").replace(SEPARATORS, "");
  return s.replace(RUN, (run) => (/[0-9]/.test(run) ? run.replace(/[OILSB]/g, (c) => DIGIT_LOOKALIKE[c]!) : run));
}

/** İki değerin eşleşme sınıfı: tam · toleranslı (iki anahtar da ≥4) · yok. Boş değer eşleşmez. */
export function codeMatchTier(read: string | null | undefined, stored: string | null | undefined): CodeMatchTier | null {
  const a = exactCodeKey(read);
  const b = exactCodeKey(stored);
  if (!a || !b) return null;
  if (a === b) return "EXACT";
  const ta = tolerantCodeKey(read);
  const tb = tolerantCodeKey(stored);
  if (ta.length < MIN_TOLERANT_CODE_LENGTH || tb.length < MIN_TOLERANT_CODE_LENGTH) return null;
  return ta === tb ? "TOLERANT" : null;
}

/**
 * Okunan değerlerle eşleşen KAYITLI değerler (kayıttaki yazımıyla, tekil, ilk görülme sırası). Herhangi bir tam eşleşme
 * varsa yalnız tam eşleşenler döner (toleranslı aday ezilir); yoksa toleranslılar; hiçbiri yoksa null.
 */
export function matchCodes(
  reads: ReadonlyArray<string | null | undefined>,
  stored: ReadonlyArray<string | null | undefined>,
): { tier: CodeMatchTier; values: string[] } | null {
  const exact: string[] = [];
  const tolerant: string[] = [];
  for (const s of stored) {
    if (!s) continue;
    let best: CodeMatchTier | null = null;
    for (const r of reads) {
      const t = codeMatchTier(r, s);
      if (t === "EXACT") { best = t; break; }
      if (t === "TOLERANT") best = t;
    }
    const bucket = best === "EXACT" ? exact : best === "TOLERANT" ? tolerant : null;
    if (bucket && !bucket.includes(s)) bucket.push(s);
  }
  if (exact.length > 0) return { tier: "EXACT", values: exact };
  return tolerant.length > 0 ? { tier: "TOLERANT", values: tolerant } : null;
}
