// Kaynak: ocr-test prototipi src/ocr-engine/text-normalize.ts (kullanıcının kendi kodu), vendor 2026-10-28 (D3a).
// Dış bağımlılık yok; yalnız göreli import. Değişiklikler: çift tırnak, proje lint/boyut kuralları, Türkçe yorumlar korundu.
/**
 * Türkçe-bilinçli metin normalizasyonu ve benzerlik ölçümü.
 * Dış bağımlılık yok; Levenshtein burada yazılmıştır.
 */

/** Türkçe'ye uygun küçük harf (I→ı, İ→i). */
export function turkishLower(s: string): string {
  return s.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
}

/** Türkçe'ye uygun büyük harf (i→İ, ı→I). */
export function turkishUpper(s: string): string {
  return s.replace(/i/g, "İ").replace(/ı/g, "I").toUpperCase();
}

const DIACRITIC_MAP: Record<string, string> = {
  ş: "s", ğ: "g", ı: "i", ö: "o", ü: "u", ç: "c", â: "a", î: "i", û: "u",
  Ş: "S", Ğ: "G", İ: "I", Ö: "O", Ü: "U", Ç: "C", Â: "A", Î: "I", Û: "U",
};

/** Aksanları sadeleştirir (ş→s, ğ→g, ı→i, ö→o, ü→u, ç→c); büyük/küçük korunur. */
export function stripDiacritics(s: string): string {
  let out = "";
  for (const ch of s) out += DIACRITIC_MAP[ch] ?? ch;
  // Kalan birleşik aksanları (NFD) da at
  return out.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Eşleme için normalizasyon: TR küçük harf → aksan sadeleştirme → noktalama/ayraçları boşluğa çevir →
 * boşlukları tekle → trim. Etiket ayraçları (':' '-' '=') bu sayede etikete ait sayılır.
 */
export function normalizeForMatch(s: string): string {
  return stripDiacritics(turkishLower(s))
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Klasik Levenshtein düzenleme uzaklığı. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const t = prev;
    prev = curr;
    curr = t;
  }
  return prev[b.length];
}

/** 0..1 benzerlik (1 - lev / maxLen); iki boş dizi 1 sayılır. Girdi normalize edilmez. */
export function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/** Normalize edilmiş benzerlik (her iki taraf normalizeForMatch'ten geçer). */
export function normalizedSimilarity(a: string, b: string): number {
  return similarity(normalizeForMatch(a), normalizeForMatch(b));
}

const PUNCT_CLASS = `[\\s:;=.,\\-–—_|/\\\\'"“”‘’()\\[\\]{}<>*#]`;
const LEADING_PUNCT_RE = new RegExp(`^${PUNCT_CLASS}+`);
const TRAILING_PUNCT_RE = new RegExp(`^(.*?)(${PUNCT_CLASS}+)$`);
/** Sondaki nokta kısaltmaya aitse korunur: "A.Ş." / "LTD. ŞTİ." (1-4 büyük harflik son parça). */
const ABBREV_TAIL_RE = /(^|[\s.])[A-ZÇĞİÖŞÜ]{1,4}$/;

/** Baş/son noktalama ve boşluk temizliği; kısaltma noktası ("A.Ş.") korunur. */
export function trimPunct(s: string): string {
  const v = s.replace(LEADING_PUNCT_RE, '');
  const m = TRAILING_PUNCT_RE.exec(v);
  if (!m) return v;
  const core = m[1];
  const tail = m[2];
  if (tail.startsWith('.') && ABBREV_TAIL_RE.test(core)) return core + '.';
  return core;
}

/** Boşlukları tekler ve trim eder. */
export function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
