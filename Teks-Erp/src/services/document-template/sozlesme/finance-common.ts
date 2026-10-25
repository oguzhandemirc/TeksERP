// =============================================================================
// Ön muhasebe sözleşmelerinin ORTAK parçaları (fatura, makbuz, mutabakat, çek bordrosu)
// =============================================================================
// Dört renderer (`document-render/finance-doc.html.ts`) aynı iskeleti, aynı taraf satırını
// ve aynı sayı biçimlerini kullanır; sözleşmede de tek yerde yazılır. Tutarlar `para` türünde
// Decimal DİZEDİR (float'a çevrilmez); şablon `para` filtresiyle `fmtMoney`e bayt-eşit basar.
// =============================================================================

import { asObject, asText } from "./ortak";
import type { ContextValue, FieldDef } from "./tipler";

/** Para alanı: Decimal dizesi aynen (boş dize → null, sayı gelirse dizeye çevrilir). */
export function moneyText(v: unknown): string | null {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  return typeof v === "string" && v !== "" ? v : null;
}

/** Tarih alanı: çözülebilen dolu metin ya da null (Sistem `fmtDate(x, "—")` eşi). */
export function dateText(v: unknown): string | null {
  return typeof v === "string" && v !== "" && !Number.isNaN(Date.parse(v)) ? v : null;
}

/**
 * Sistem'in `fmtQty` biçimi (tr-TR, EN ÇOK 2 hane, sondaki sıfır yok) Liquid'de hesapsız
 * basılsın diye değer basılan haneye yuvarlanmış gelir, hane sayısı yanında taşınır:
 * şablon `{{ x | sayi: x_hane }}` yazar.
 */
export function shownQty(v: unknown): { value: number | null; digits: number } {
  if (v === null || v === undefined || v === "") return { value: null, digits: 0 };
  const n = Number(v);
  if (!Number.isFinite(n)) return { value: null, digits: 0 };
  const s = n.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
  const frac = s.split(",")[1] ?? "";
  return { value: Number(s.replace(/\./g, "").replace(",", ".")), digits: frac.length };
}

/** `shownQty`yi bağlam anahtarlarına açar: `<ad>` ve `<ad>_hane`. */
export function qtyPair(name: string, v: unknown): Record<string, ContextValue> {
  const q = shownQty(v);
  return { [name]: q.value, [`${name}_hane`]: q.digits };
}

/** `qtyPair` alanlarının beyanı (değer + hane). */
export function qtyFields(path: string, label: string, sample: number, digits: number): FieldDef[] {
  return [
    { yol: path, etiket: `${label} (basılan haneye yuvarlı)`, tur: "sayi", ondalik: 2, sinif: "musteri", ornek: sample },
    { yol: `${path}_hane`, etiket: `${label} — basılan ondalık hane (0–2)`, tur: "sayi", ondalik: 0, sinif: "musteri", ornek: digits },
  ];
}

/** Cari taraf (fatura/makbuz/mutabakat): ad, kod, vergi bilgisi — renderer üçünü de basar. */
export const PARTY_FIELDS: FieldDef[] = [
  { yol: "karsi_taraf.ad", etiket: "Cari adı", tur: "metin", sinif: "musteri", ornek: "Örnek Tekstil Ltd. Şti." },
  { yol: "karsi_taraf.kod", etiket: "Cari kodu", tur: "metin", sinif: "musteri", ornek: "CR-000148" },
  { yol: "karsi_taraf.vergi_bilgisi", etiket: "Cari vergi dairesi / no", tur: "metin", sinif: "musteri", ornek: "Merkez V.D. · 1234567890" },
];

export function partyValues(header: Record<string, unknown>): Record<string, ContextValue> {
  return { ad: asText(header.partyName), kod: asText(header.partyCode), vergi_bilgisi: asText(header.partyTaxInfo) };
}

export const CREATED_BY_FIELD: FieldDef = { yol: "belge.duzenleyen", etiket: "Düzenleyen", tur: "metin", sinif: "musteri", ornek: "Ayşe Kaya" };
export const NOTES_FIELD: FieldDef = { yol: "belge.notlar", etiket: "Not", tur: "metin", sinif: "musteri", ornek: "Ağustos dönemi kısmi tahsilat." };

export const docHeader = (snapshotDoc: unknown) => asObject(asObject(snapshotDoc).header);

/**
 * Tutarın YAZIYLA basılabileceği alan (`{{ <tutar> | yaziyla: <para_birimi> }}`). Sistem
 * şablonu yazıyla basmaz; beyan kullanıcı şablonu ve bekçi içindir. Kaynak negatif olamaz.
 */
export interface AmountInWordsSource {
  tutar: string;
  paraBirimi: string | null;
}
