// =============================================================================
// Formül dili yasağı — kart, cümle, tanım ve kolon başlığına girmeyen sözcükler (plan §3.5)
// =============================================================================
// Rapor okuru formül değil cevap görür. Liste dışa açıktır: R0-RAP dilimleri tanım ve kolon
// başlıklarını da `yasakSozcukBul` ile tarar. Eşleşme Türkçe küçük harfe katlanmış metinde,
// harf/rakam sınırıyla (ör. "ABC" yakalanır, "abece" yakalanmaz). Tarama SABİT metne yapılır
// (şablon, tanım, başlık); veri değeri taranmaz — "ABC Tekstil" müşterisi, "P90" partisi meşrudur.

import { lowerTr } from "../../../utils/tr-case";

export interface YasakSozcuk {
  sozcuk: string;
  /** Küçük harfe katlanmış metinde aranan desen. */
  desen: RegExp;
  karsilik: string;
}

const sinirli = (govde: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])(?:${govde})(?![\\p{L}\\p{N}])`, "u");

export const YASAK_SOZCUKLER: readonly YasakSozcuk[] = [
  { sozcuk: "Σ", desen: /[Σσ∑]/u, karsilik: "toplam" },
  { sozcuk: "P90", desen: sinirli("p90"), karsilik: "\"10 siparişten 9'u 21 gün içinde gitti\"" },
  { sozcuk: "P50", desen: sinirli("p50"), karsilik: "\"siparişlerin yarısı 12 günde gitti\"" },
  { sozcuk: "medyan", desen: sinirli("medyan\\p{L}*"), karsilik: "\"siparişlerin yarısı 12 günde gitti\"" },
  { sozcuk: "OEE", desen: sinirli("oee"), karsilik: "randıman (tek oran)" },
  { sozcuk: "ABC", desen: sinirli("abc"), karsilik: "\"işin %80'ini getiren 7 müşteri\"" },
  { sozcuk: "RFM", desen: sinirli("rfm"), karsilik: "\"son siparişi, sıklığı ve tutarıyla müşteri\"" },
  { sozcuk: "take-up", desen: sinirli("take[- ]?up"), karsilik: "\"leventten beklenen kumaş\"" },
  { sozcuk: "kohort", desen: sinirli("kohort\\p{L}*"), karsilik: "\"aynı ay ilk siparişini veren müşteriler\"" },
  { sozcuk: "mikro duruş", desen: sinirli("mikro[- ]?duruş\\p{L}*"), karsilik: "\"kısa duruşlar (birkaç dakikalık)\"" },
];

/** Metinde geçen yasak sözcükler (liste sırasıyla, tekrarsız). */
export function yasakSozcukBul(metin: string): string[] {
  const katli = lowerTr(metin);
  return YASAK_SOZCUKLER.filter((y) => y.desen.test(katli) || y.desen.test(metin)).map((y) => y.sozcuk);
}
