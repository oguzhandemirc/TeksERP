// =============================================================================
// Sözleşmelerin ORTAK alanları — firma, belge durumu, baskı (her belge türü aynı)
// =============================================================================
// Port dilimleri bu parçaları yeniden kullanır; aynı kök iki belgede farklı adla
// doğarsa şablon kopyalanınca sessizce boş basar.
// =============================================================================

import type { PrintedDocSnapshot } from "../../printed-document.service";
import type { FieldDef, ContextValue, ContextObject, PrintInput, TableDef } from "./tipler";

/** Metin ya da null — bağlamda `undefined` olmaz. */
export function asText(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Sonlu sayı ya da null. */
export function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Dizi değilse boş dizi — eski/bozuk snapshot baskıyı düşürmez. */
export function asRows<T = Record<string, unknown>>(v: unknown): T[] {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as T[]) : [];
}

/** Nesne değilse boş nesne. */
export function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export const COMPANY_FIELDS: FieldDef[] = [
  { yol: "firma.ad", etiket: "Firma adı", tur: "metin", sinif: "musteri", ornek: "Örnek Tekstil A.Ş." },
  { yol: "firma.adres", etiket: "Firma adresi", tur: "metin", sinif: "musteri", ornek: "Organize Sanayi Bölgesi 3. Cadde No:5" },
  { yol: "firma.telefon", etiket: "Firma telefonu", tur: "metin", sinif: "musteri", ornek: "0232 000 00 00" },
  { yol: "firma.vergi_bilgisi", etiket: "Vergi dairesi / no", tur: "metin", sinif: "musteri", ornek: "Ege VD 1234567890" },
  { yol: "firma.logo", etiket: "Firma logosu", tur: "gorsel", sinif: "musteri", ornek: null },
];

/** Künyenin serbest ek satırları (IBAN, Mersis…) — tek kolonlu tablo. */
export const LETTERHEAD_EXTRA_TABLE: TableDef = {
  anahtar: "antet_ek",
  etiket: "Künye ek satırları",
  kolonlar: [{ yol: "metin", etiket: "Satır", tur: "metin", sinif: "musteri", ornek: "IBAN: TR00 0000 0000", hiza: "l" }],
};

export function companyRoot(snapshot: PrintedDocSnapshot, printInput: PrintInput | undefined): ContextObject {
  const company = asObject(snapshot?.company);
  const lh = asObject(company.letterhead);
  return {
    ad: asText(company.name),
    adres: asText(lh.addressLine),
    telefon: asText(lh.phone),
    vergi_bilgisi: asText(lh.taxInfo),
    logo: asText(printInput?.logo),
  };
}

export function letterheadExtraRows(snapshot: PrintedDocSnapshot): ContextObject[] {
  const lh = asObject(asObject(snapshot?.company).letterhead);
  const extra = Array.isArray(lh.extraLines) ? lh.extraLines : [];
  return extra.filter((s): s is string => typeof s === "string").map((s) => ({ metin: s }));
}

export const DOC_STATUS_FIELDS: FieldDef[] = [
  { yol: "belge.surum", etiket: "Belge sürümü", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 1 },
  { yol: "belge.durum", etiket: "Belge durumu (ACTIVE/VOIDED/SUPERSEDED)", tur: "metin", sinif: "musteri", ornek: "ACTIVE" },
  { yol: "belge.iptal_nedeni", etiket: "İptal nedeni", tur: "metin", sinif: "musteri", ornek: null },
];

export function docStatus(printInput: PrintInput | undefined): ContextObject {
  return {
    surum: asNumber(printInput?.surum),
    durum: asText(printInput?.durum),
    iptal_nedeni: asText(printInput?.iptalNedeni),
  };
}

export const PRINT_FIELDS: FieldDef[] = [
  { yol: "baski.zaman", etiket: "Basım zamanı", tur: "tarih_saat", sinif: "musteri", ornek: "2026-09-25T08:30:00.000Z" },
  { yol: "baski.basan", etiket: "Basan kullanıcı", tur: "metin", sinif: "musteri", ornek: "admin" },
  { yol: "baski.nusha", etiket: "Nüsha etiketi (ASIL, KOPYA…)", tur: "metin", sinif: "musteri", ornek: "ASIL" },
  { yol: "baski.not", etiket: "Tek seferlik baskı notu", tur: "metin", sinif: "musteri", ornek: null },
  { yol: "baski.taslak", etiket: "Taslak baskı mı", tur: "mantiksal", sinif: "musteri", ornek: false },
  { yol: "baski.qr", etiket: "Doğrulama karekodu", tur: "gorsel", sinif: "musteri", ornek: null },
];

/** `nusha` ayardan gelir (stamps.copyLabel); boş etiket basılmaz → null. */
export function printRoot(printInput: PrintInput | undefined, copyLabel: string | null | undefined): ContextObject {
  return {
    zaman: asText(printInput?.zaman),
    basan: asText(printInput?.basan),
    nusha: copyLabel?.trim() ? copyLabel : null,
    not: asText(printInput?.not),
    taslak: printInput?.taslak === true,
    qr: asText(printInput?.qr),
  };
}

/**
 * Beyanlı alanlardan bağlam nesnesi kurar — TEK İÇ ALAN KAPISI. Beyanda olmayan değer
 * bağlama giremez; `ic` alan yalnız kodu `internalFields`te ise yazılır, yoksa
 * anahtar HİÇ doğmaz (şablon atıf yaparsa `strictVariables` render'ı düşürür).
 * `fields[].yol` bu nesnenin içindeki anahtardır (kök öneki atılmış).
 */
export function fillFields(
  fields: ReadonlyArray<{ yol: string; sinif: "musteri" | "ic"; icKod?: string }>,
  values: Record<string, ContextValue | undefined>,
  optIn: ReadonlySet<string>,
): ContextObject {
  const out: ContextObject = {};
  for (const a of fields) {
    if (a.sinif === "ic" && !(a.icKod && optIn.has(a.icKod))) continue;
    out[a.yol] = values[a.yol] ?? null;
  }
  return out;
}

/** Kök alanların `<kok>.` önekini atar — `fillFields`a yerel anahtarla verilir. */
export function rootFields(fields: readonly FieldDef[], root: string): FieldDef[] {
  const prefix = `${root}.`;
  return fields.filter((a) => a.yol.startsWith(prefix)).map((a) => ({ ...a, yol: a.yol.slice(prefix.length) }));
}
