// Projeksiyon satırı/anlık veri şekli FABRİKADA tanımlıdır; uygulama alan adını ve değeri jenerik
// biçimler (bulut hesap yapmaz, uygulama da yapmaz). Kimlik alanları (…Id) kullanıcıya gösterilmez.
import { formatDate, formatDateTime, formatNumber, statusLabel } from "./format";

const DATE_KEY = /(tarih|Tarihi|termin|olusturulma|guncelleme|baslangic|bitis|vade|Baslangic|Bitis|At)$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;

export function isHiddenKey(key: string): boolean {
  return key === "id" || /Id$/.test(key) || /Idleri$/.test(key) || key === "surum";
}

/** "toplamMetre" → "Toplam metre"; "is-emri" → "İs emri" (ASCII anahtar olduğu gibi okunur). */
export function humanize(key: string): string {
  const spaced = key
    .replace(/[._-]+/g, " ")
    .replace(/([a-zçğıöşü0-9])([A-ZÇĞİÖŞÜ])/g, "$1 $2")
    .trim()
    .toLowerCase();
  // Anahtarlar ASCII; yerel ayar işlevi Hermes'te güvenilmez — Türkçe büyük İ elle.
  const first = spaced.charAt(0);
  return (first === "i" ? "İ" : first.toUpperCase()) + spaced.slice(1);
}

export function formatValue(key: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Evet" : "Hayır";
  if (typeof v === "number") return formatNumber(v, Number.isInteger(v) ? 0 : 2);
  if (typeof v === "string") {
    if (DATE_KEY.test(key) && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.length === 10 ? formatDate(v) : formatDateTime(v);
    if (DECIMAL.test(v)) return formatNumber(v, v.includes(".") ? 2 : 0);
    if (key === "durum") return statusLabel(v);
    return v;
  }
  if (Array.isArray(v)) return `${v.length} kalem`;
  return "…";
}

/** Nesnenin gösterilecek skaler alanları (sıra korunur). */
export function scalarEntries(obj: unknown): { key: string; label: string; value: string }[] {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return [];
  return Object.entries(obj as Record<string, unknown>)
    .filter(([k, v]) => !isHiddenKey(k) && (v === null || typeof v !== "object"))
    .map(([k, v]) => ({ key: k, label: humanize(k), value: formatValue(k, v) }));
}

/** Nesnenin iç içe alanları (bölüm olarak gösterilir). */
export function nestedEntries(obj: unknown): { key: string; label: string; value: unknown }[] {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return [];
  return Object.entries(obj as Record<string, unknown>)
    .filter(([k, v]) => !isHiddenKey(k) && v !== null && typeof v === "object")
    .map(([k, v]) => ({ key: k, label: humanize(k), value: v }));
}

/** Liste satırı başlığı: bilinen numara/ad alanlarından ilki. */
export function recordTitle(kayit: unknown): string {
  const o = (typeof kayit === "object" && kayit !== null ? kayit : {}) as Record<string, unknown>;
  for (const k of ["ad", "siparisNo", "sevkNo", "isEmriNo", "belgeNo", "faturaNo", "cuvalNo", "kod", "no"]) {
    const v = o[k];
    if (typeof v === "string" && v !== "") return v;
  }
  return "Kayıt";
}
