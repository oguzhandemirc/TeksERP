// =============================================================================
// GELEN BELGE İŞLEM METNİ → KURŞUN GRAMAJ ÇEŞİDİ — belirlenimli kalıp (H9, OCR F1.2)
// =============================================================================
// Saf fonksiyonlar (DB yok). Sıra çağıranda: önce `DeliveryNoteAlias` PROCESS, yoksa bu kalıp.
// İlke: yanlış öneri verilmez — metinde birden çok gramaj, aralık ("25-30 GR") ya da birimsiz
// sayı varsa BOŞ; kalıbın sayısına birden çok çeşit uyuyorsa BOŞ. Katlama tek kaynak `foldSearchText`.
// =============================================================================
import { foldSearchText } from "../../utils/search-fold";

export interface GramajOption {
  readonly id: string;
  readonly name: string;
}

// Sayı + "gr"/"g"/"gram"/"grm", isteğe bağlı "/m", "/mt", "/m2"; sayının önünde rakam/ayraç yok.
const GRAM_RE = /(?<![\d.,/-])(\d{1,4}(?:[.,]\d{1,2})?) ?(?:gr|grm|gram|g)(?: ?\/ ?(?:m|mt|m2|mtul))?(?![a-z0-9])/g;
// "25-30 gr", "25/30gr", "25~30 gr": aralık ya da oran — tek değere indirilemez.
const RANGE_RE = /\d ?[-~/–] ?\d{1,4}(?:[.,]\d{1,2})? ?(?:gr|grm|gram|g)(?![a-z0-9])/;
// Gramaj eşleşmeleri çıkarıldıktan sonra kalan çıplak sayı ("25 VE 50 GR", "25X50", "50 GR 2 KAT", "30/1"):
// sayı harfe yapışık değilse (kod/etiket parçası "M2", "TST3A" sayılmaz) metin belirsizdir → boş.
const BARE_NUMBER_RE = /(?<![a-z\d])\d/;

const toNumber = (s: string): number => Number(s.replace(",", "."));

/** Satırın geçerli işlem metni: satır kendi metnini taşırsa o, yoksa belge başlığınınki (boşluk = yok). */
export function effectiveProcessText(lineText: string | null | undefined, noteText: string | null | undefined): string | null {
  return lineText?.trim() || noteText?.trim() || null;
}

/** Metindeki gramaj sayıları (tekilleştirilmiş). Aralık ya da gramaj dışı çıplak sayı varsa boş. */
export function extractGramValues(text: string | null | undefined): number[] {
  const folded = foldSearchText(text ?? "");
  if (!folded || RANGE_RE.test(folded)) return [];
  if (BARE_NUMBER_RE.test(folded.replace(GRAM_RE, " "))) return [];
  const out = new Set<number>();
  for (const m of folded.matchAll(GRAM_RE)) {
    const n = toNumber(m[1]!);
    if (Number.isFinite(n) && n > 0) out.add(n);
  }
  return [...out];
}

/** Çeşit adının gramajı: "25 gr" / "25GR" / yalın "25". Tanınmazsa null. */
export function optionGramValue(name: string): number | null {
  const folded = foldSearchText(name);
  if (/^\d{1,4}(?:[.,]\d{1,2})?$/.test(folded)) return toNumber(folded);
  const found = extractGramValues(folded);
  return found.length === 1 ? found[0]! : null;
}

/**
 * İşlem metni → gramaj çeşidi (kalıp). Metinde TEK gramaj ve ona uyan TEK aktif çeşit varsa döner;
 * aksi halde null (emin değilse boş).
 */
export function matchGramajOption<T extends GramajOption>(text: string | null | undefined, options: readonly T[]): T | null {
  const grams = extractGramValues(text);
  if (grams.length !== 1) return null;
  const hits = options.filter((o) => optionGramValue(o.name) === grams[0]);
  return hits.length === 1 ? hits[0]! : null;
}
