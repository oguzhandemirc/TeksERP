/**
 * Kimlik yazısının GÜCÜ (2026-11-10): her tekstil belgesinde bulunan genel alan etiketi (Tarih, Açıklama, Cinsi,
 * Müşteri KG, "X No"…) şablonu tek başına tanıtamaz; şablon ancak en az bir GÜÇLÜ yazısı (başlık, firma adı) ya da
 * regex'i belgede tutarsa aday olur. Güç kayıtlı kimlik metninden türetilir — eski şablonlar yeniden tanıtılmadan yararlanır.
 */
import { normalizeForMatch } from "./text-normalize";

/**
 * Yalnız jenerik tekstil/belge alan sözcükleri (aksansız, küçük harf). Belge TÜRÜ sözcükleri (çeki, liste, fiş, irsaliye,
 * form, rapor…) burada YOK: "Kumaş Çeki Listesi", "Ürün Sevk Fişi" gibi başlıklar güçlü kalır. Firma adı asla buraya girmez.
 */
const GENERIC_WORDS: ReadonlySet<string> = new Set([
  "tarih", "tarihi", "saat", "musteri", "musterisi", "firma", "firmasi", "sayin", "adi", "ad", "unvan", "unvani",
  "adres", "adresi", "tel", "telefon", "fax", "faks", "mail", "vergi", "dairesi", "vd", "mah", "cad", "sok",
  "kg", "kilo", "kilosu", "mt", "metre", "metresi", "metraj", "cm", "gr", "gram", "gramaj", "en", "eni", "boy",
  "cins", "cinsi", "mamul", "kumas", "urun", "kalite", "kalitesi", "desen", "varyant", "renk", "rengi", "model",
  "kod", "kodu", "miktar", "miktari", "adet", "adedi", "toplam", "ara", "genel", "net", "brut", "dara", "birim",
  "fiyat", "fiyati", "tutar", "tutari", "kdv", "aciklama", "aciklamasi", "not", "notlar", "sevk", "sevkiyat",
  "giris", "cikis", "teslim", "eden", "alan", "imza", "kase", "parti", "partisi", "top", "sira", "ham", "islem",
  "islemi", "yapilan", "siparis", "is", "emri", "emir", "tip", "tipi", "tasima", "araba", "plaka", "sofor",
  "no", "nu", "numara", "numarasi", "irs", "fat", "fis", "lot", "bilgi", "bilgisi", "durum", "fason",
]);

/** "X No" / "X Numarası" alan etiketidir (Fiş No, Sevk No, İrsaliye No) — belgeyi değil alanı adlandırır. */
const LABEL_TAIL: ReadonlySet<string> = new Set(["no", "nu", "numara", "numarasi"]);

/** Bir sözcük jenerik mi: sözlükte, OCR'ın bitiştirdiği "X No" (PartiNo, FişNo), ya da harfsiz/tek harfli (rakam, "1", "a"). */
const genericToken = (w: string): boolean =>
  GENERIC_WORDS.has(w) || (w.length > 2 && w.endsWith("no") && GENERIC_WORDS.has(w.slice(0, -2))) || !/[a-z]{2}/.test(w);

/** Kimlik yazısı güçlü mü: en az bir sözcüğü jenerik değil ve "X No" alan etiketi değil. */
export function isStrongIdentifier(keyword: string): boolean {
  const words = normalizeForMatch(keyword).split(" ").filter(Boolean);
  if (words.length === 0) return false;
  if (words.length > 1 && LABEL_TAIL.has(words[words.length - 1]!)) return false;
  return words.some((w) => !genericToken(w));
}
