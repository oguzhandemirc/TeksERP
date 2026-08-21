// =============================================================================
// MÜKERRER TESPİT KURALLARI — tek kaynak (mükerrer paneli v2 P1, 2026-08-22)
// =============================================================================
// Tasarım: docs/design/MUKERRER-PANELI-TASARIM.md §2.1 + §5 (canlı veri ölçümü).
// Üç kural sınıfı, her aday GEREKÇELİ gelir:
//   EXACT_NAME  — katlanmış ad eşitliği (renk: ayraç + token-sırası bağımsız)
//   IDENTITY    — kimlik alanı çakışması (VKN, ihracat kodu, e-posta, telefon,
//                 kumaş kodu harf-ikizi). ⚠️ Renk `hex` BİLİNÇLİ YOK: canlıda
//                 `#ffffff` 7 meşru beyaz — hex tek başına kimlik değil.
//   FUZZY_NAME  — Jaro-Winkler/token-set benzerliği ≥ eşik (panelden ayarlanır,
//                 `duplicates.fuzzyThresholdPct`, varsayılan 90) + NUMERİK TOKEN
//                 KORUMASI (her varlıkta): "KRİSTAL V-01"/"V-02" aday DEĞİLDİR.
// Varlık kümesi birleştirme motoruyla AYNI (`MERGE_ENTITIES`) — karar verilen
// çift birleştirilebilmeli; motorun tanımadığı varlık kuyruğa girmez (P3'te
// şube/istasyon/makine/kategori motorla birlikte gelir).
// =============================================================================
import type { MergeEntity } from "./merge-map";

export type DuplicateRuleKind = "EXACT_NAME" | "IDENTITY" | "FUZZY_NAME";

export const DUPLICATE_RULE_LABEL: Record<DuplicateRuleKind, string> = {
  EXACT_NAME: "Aynı ad",
  IDENTITY: "Kimlik çakışması",
  FUZZY_NAME: "Benzer ad",
};

/** Kimlik kuralı: kolon + etiket + normalizasyon (karşılaştırma anahtarı). */
export interface IdentityRule {
  field: string;
  label: string;
  /** Boş/anlamsız değerler `null` döner ve karşılaştırılmaz. */
  normalize: (raw: string) => string | null;
}

const digitsOnly = (min: number) => (raw: string): string | null => {
  const d = raw.replace(/\D+/g, "");
  return d.length >= min ? d : null;
};
const upperTrim = (raw: string): string | null => {
  const v = raw.trim().toUpperCase();
  return v.length >= 2 ? v : null;
};
const lowerTrim = (raw: string): string | null => {
  const v = raw.trim().toLowerCase();
  return v.length >= 3 ? v : null;
};

/**
 * Varlık → kimlik kuralları. Alan adları Prisma kolonlarıdır; tespit servisi
 * bunları `select` eder — yeni kural eklerken kolonun o modelde VAR olduğundan
 * emin ol (bekçi `test_duplicate_detection` §0 DMMF ile doğrular).
 */
export const IDENTITY_RULES: Record<MergeEntity, readonly IdentityRule[]> = {
  customer: [
    { field: "taxNumber", label: "Vergi no", normalize: digitsOnly(8) },
    { field: "exportCode", label: "İhracat kodu", normalize: upperTrim },
    { field: "email", label: "E-posta", normalize: lowerTrim },
    { field: "contactPhone", label: "Telefon", normalize: digitsOnly(10) },
  ],
  subcontractor: [
    { field: "taxNumber", label: "Vergi no", normalize: digitsOnly(8) },
    { field: "phone", label: "Telefon", normalize: digitsOnly(10) },
  ],
  // Kod harf-ikizi: "activo" ≠ "ACTIVO" olarak iki kayıt (canlıda 9 grup). Aday iki
  // sonuç üretir: gerçek mükerrer → birleştir · farklı ürün → "kodu düzelt" (panel).
  item: [{ field: "code", label: "Kod harf-ikizi", normalize: upperTrim }],
  color: [],
};

/**
 * Bulanık karşılaştırmada düşülen gürültü kelimeleri (katlanmış biçim). Firma
 * adlarında "X TEKSTİL LTD. ŞTİ." ≈ "X TEKSTİL A.Ş." — eklenti değil çekirdek
 * karşılaştırılır. Hepsi gürültüyse orijinal korunur (`stripNoiseWords`).
 */
export const FUZZY_NOISE_WORDS: ReadonlySet<string> = new Set([
  "tekstil", "ltd", "sti", "as", "san", "tic", "ve", "dis", "ic", "ithalat", "ihracat",
  "sanayi", "ticaret", "limited", "sirketi", "anonim", "a", "s", "koll", "kollektif",
  "boya", "boyahane", "iplik", "kumas", "dokuma", "orme",
]);

/**
 * BULANIK PROFİL — canlı veri ölçümü (2026-08-22, `tekserp_saha_0822`) iki farklı
 * dünyayı gösterdi. Ortak zemin: skor KELİME bazlıdır (sıralı hizalama), karakter
 * bazlı Jaro-Winkler KALDIRILDI — ön ek bonusu "BOYER EMRE" ↔ "BOYER"i 0.900'e
 * çıkarıp aday yapmıştı ve kullanıcı "farklı firma" dedi (bkz. string-similarity başlığı).
 *   FIRM    (müşteri, fason): eklentiler gürültüdür ("LTD ŞTİ" ↔ "A.Ş." → aynı),
 *           skor = hizalı kelimelerin ORTALAMASI; fazladan anlamlı kelime skoru böler.
 *   PRODUCT (kumaş, renk): ad bir VARYANT AİLESİDİR — "KRİSTAL GÜMÜŞ-EKRU" ↔ "-GRİ",
 *           "ACTİVO SİYAH-(KREM ALTIN)" ↔ "-(BEYAZ ALTIN)", "A.GRİ" ↔ "GRİ" farklı
 *           ürünlerdir. Gürültü listesi UYGULANMAZ (tek harfli "A."/"S." ön ekleri
 *           anlam taşır), iki ek koruma: numerik token'lar VE kelime SAYISI eşit; skor
 *           EN DÜŞÜK kelime çifti. Yazım/boşluk farkı (sıkıştırılmış metin eşit:
 *           "MİKRO CANVAS" ↔ "MIKROCANVAS") her iki profilde de %100 adaydır.
 */
export type FuzzyProfile = "FIRM" | "PRODUCT";
export const FUZZY_PROFILE: Record<MergeEntity, FuzzyProfile> = {
  customer: "FIRM",
  subcontractor: "FIRM",
  item: "PRODUCT",
  color: "PRODUCT",
};

/**
 * Panel varsayılanı — yüzde. Ölçek KELİME bazlı olduğu için okunabilir:
 * %100 yalnız yazım/boşluk farkı · %90 neredeyse aynı · %80 tek kelimede bir harf
 * hatası ("ŞAHİN"↔"SAHİM"). "Fazladan anlamlı kelime" sınıfı (BOYER EMRE ↔ BOYER)
 * 0.50'de kalır — hiçbir eşikte aday olmaz.
 */
export const DEFAULT_DUPLICATES_FUZZY_THRESHOLD_PCT = 90;
/** Panelin izin verdiği alt sınır — altı gürültü üretir (canlı ölçüm: kumaşta 0.7 → 26 yanlış pozitif). */
export const DUPLICATES_FUZZY_MIN_PCT = 50;
