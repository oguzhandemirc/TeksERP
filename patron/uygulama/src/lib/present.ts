// Projeksiyon satırı/anlık veri şekli FABRİKADA tanımlıdır; uygulama alan adını ve değeri jenerik
// biçimler (bulut hesap yapmaz, uygulama da yapmaz). Kimlik alanları (…Id) kullanıcıya gösterilmez.
import { formatDate, formatDateTime, formatNumber, statusLabel } from "./format";

const DATE_KEY = /(tarih|Tarihi|termin|olusturulma|guncelleme|baslangic|bitis|vade|Baslangic|Bitis|At)$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;

export function isHiddenKey(key: string): boolean {
  return key === "id" || /Id$/.test(key) || /Idleri$/.test(key) || key === "surum";
}

/** Anahtarın tamamı için okunur ad (fabrika rapor sonuçlarında İngilizce parametre adları da gelir). */
const KEY_LABEL: Readonly<Record<string, string>> = {
  dateFrom: "Başlangıç",
  dateTo: "Bitiş",
  asOf: "Tarih itibarıyla",
  disNo: "Dış belge no",
  vadesiGecti: "Vadesi geçti",
};

/** ASCII anahtar kelimesi → Türkçe yazımı (anahtarlar ASCII; ekranda "Doviz", "Siparis" yazılmaz). */
const WORD: Readonly<Record<string, string>> = {
  acik: "açık", adedi: "adedi", agirlik: "ağırlık", alici: "alıcı", baslangic: "başlangıç", bitis: "bitiş",
  cari: "cari", cikis: "çıkış", degisim: "değişim", dis: "dış", donem: "dönem", doviz: "döviz", gecikme: "gecikme",
  gecikmis: "gecikmiş", gecti: "geçti", giris: "giriş", gun: "gün", guncelleme: "güncelleme", is: "iş", islem: "işlem",
  karsilama: "karşılama", kisi: "kişi", miktari: "miktarı", musteri: "müşteri", odeme: "ödeme", olcu: "ölçü",
  olusturulma: "oluşturulma", onceki: "önceki", orani: "oranı", ortalama: "ortalama", ozet: "özet", sayisi: "sayısı",
  sevk: "sevk", siparis: "sipariş", sure: "süre", tasima: "taşıma", tur: "tür", turu: "türü", tutari: "tutarı",
  uretim: "üretim", urun: "ürün", yuzde: "yüzde", yon: "yön", yontem: "yöntem", olu: "ölü",
};

/** "toplamMetre" → "Toplam metre"; "siparisAdedi" → "Sipariş adedi"; bilinmeyen kelime olduğu gibi okunur. */
export function humanize(key: string): string {
  const whole = KEY_LABEL[key];
  if (whole) return whole;
  const spaced = key
    .replace(/[._-]+/g, " ")
    .replace(/([a-zçğıöşü0-9])([A-ZÇĞİÖŞÜ])/g, "$1 $2")
    .trim()
    .toLowerCase()
    .split(" ")
    .map((w) => WORD[w] ?? w)
    .join(" ");
  // Yerel ayar işlevi Hermes'te güvenilmez — Türkçe büyük harfler elle.
  const first = spaced.charAt(0);
  const upper: Readonly<Record<string, string>> = { i: "İ", ı: "I", ç: "Ç", ğ: "Ğ", ö: "Ö", ş: "Ş", ü: "Ü" };
  return (upper[first] ?? first.toUpperCase()) + spaced.slice(1);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

export function formatValue(key: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Evet" : "Hayır";
  if (typeof v === "number") return formatNumber(v, Number.isInteger(v) ? 0 : 2);
  if (typeof v === "string") {
    if (DATE_KEY.test(key) && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.length === 10 ? formatDate(v) : formatDateTime(v);
    // Anahtar adı tarih demese de tam ISO damga ham basılmaz (ör. `onay`, rapor `dateFrom`).
    if (ISO_DATETIME.test(v)) return formatDateTime(v);
    if (ISO_DATE.test(v)) return formatDate(v);
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

/** Seçici satırının ikinci satırı: kod · il (varsa); başlıkta zaten gösterilen değer tekrar edilmez. */
export function recordSubtitle(kayit: unknown): string {
  const o = (typeof kayit === "object" && kayit !== null ? kayit : {}) as Record<string, unknown>;
  const title = recordTitle(kayit);
  const parts = ["kod", "il"].map((k) => o[k]).filter((v): v is string => typeof v === "string" && v !== "" && v !== title);
  if (o.aktif === false) parts.push("Pasif");
  return parts.join(" · ");
}
