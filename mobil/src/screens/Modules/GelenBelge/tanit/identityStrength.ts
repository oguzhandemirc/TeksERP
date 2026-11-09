// Kimlik yazısı GÜCÜ — backend `Teks-Erp/src/lib/gelen-belge/motor/kimlik-gucu.ts` `isStrongIdentifier` AYNASI (sözlük
// bayt-eşit tutulur): genel alan etiketi (Tarih, Cinsi, Açıklama, "X No"…) belgeyi tanıtmaz; motor yalnız güçlü yazısı
// (başlık, firma adı) tutan şablonu aday sayar. Tablet öneriyi güçlüden başlatır ve yalnız-zayıf seçimde uyarır.

const GENERIC_WORDS: ReadonlySet<string> = new Set([
  'tarih', 'tarihi', 'saat', 'musteri', 'musterisi', 'firma', 'firmasi', 'sayin', 'adi', 'ad', 'unvan', 'unvani',
  'adres', 'adresi', 'tel', 'telefon', 'fax', 'faks', 'mail', 'vergi', 'dairesi', 'vd', 'mah', 'cad', 'sok',
  'kg', 'kilo', 'kilosu', 'mt', 'metre', 'metresi', 'metraj', 'cm', 'gr', 'gram', 'gramaj', 'en', 'eni', 'boy',
  'cins', 'cinsi', 'mamul', 'kumas', 'urun', 'kalite', 'kalitesi', 'desen', 'varyant', 'renk', 'rengi', 'model',
  'kod', 'kodu', 'miktar', 'miktari', 'adet', 'adedi', 'toplam', 'ara', 'genel', 'net', 'brut', 'dara', 'birim',
  'fiyat', 'fiyati', 'tutar', 'tutari', 'kdv', 'aciklama', 'aciklamasi', 'not', 'notlar', 'sevk', 'sevkiyat',
  'giris', 'cikis', 'teslim', 'eden', 'alan', 'imza', 'kase', 'parti', 'partisi', 'top', 'sira', 'ham', 'islem',
  'islemi', 'yapilan', 'siparis', 'is', 'emri', 'emir', 'tip', 'tipi', 'tasima', 'araba', 'plaka', 'sofor',
  'no', 'nu', 'numara', 'numarasi', 'irs', 'fat', 'fis', 'lot', 'bilgi', 'bilgisi', 'durum', 'fason',
]);
const LABEL_TAIL: ReadonlySet<string> = new Set(['no', 'nu', 'numara', 'numarasi']);
const DIACRITIC = new Map([['ş', 's'], ['ğ', 'g'], ['ı', 'i'], ['ö', 'o'], ['ü', 'u'], ['ç', 'c'], ['â', 'a'], ['î', 'i'], ['û', 'u']]);

/** Backend `normalizeForMatch` aynası: TR küçük harf → aksansız → harf/rakam dışı boşluk. */
function normalizeForMatch(s: string): string {
  const lower = s.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
  let out = '';
  for (const ch of lower) out += DIACRITIC.get(ch) ?? ch;
  return out.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const genericToken = (w: string): boolean =>
  GENERIC_WORDS.has(w) || (w.length > 2 && w.endsWith('no') && GENERIC_WORDS.has(w.slice(0, -2))) || !/[a-z]{2}/.test(w);

/** Kimlik yazısı güçlü mü: en az bir sözcüğü jenerik değil ve "X No" alan etiketi değil. */
export function isStrongIdentifier(text: string): boolean {
  const words = normalizeForMatch(text).split(' ').filter(Boolean);
  if (words.length === 0) return false;
  if (words.length > 1 && LABEL_TAIL.has(words[words.length - 1]!)) return false;
  return words.some((w) => !genericToken(w));
}

export const DISTINCTIVE_IDENTIFIER_WARNING = 'Belgeyi ayırt eden bir yazı seçin: başlık ya da firma adı. Yalnız genel etiketlerle (Tarih, Açıklama, Cinsi…) belge tanınmaz.';

/** Kaydı engellemeyen uyarı: seçili kimlik yazılarının HİÇBİRİ güçlü değilse. */
export function identityWarning(selected: readonly string[]): string | null {
  return selected.length > 0 && !selected.some(isStrongIdentifier) ? DISTINCTIVE_IDENTIFIER_WARNING : null;
}
