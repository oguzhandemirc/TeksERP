import notlar from '../data/surum-notlari.json';
import { storage } from '../utils/storage';

/**
 * Sürüm notları — "bu güncellemede neler değişti".
 *
 * Kaynak repo kökündeki `surum-notlari.json`; buradaki kopya
 * `scripts/surum-notlari-kopyala.mjs` ile üretilir ve bekçi
 * (`scripts/check-surum-notlari.mjs`) birebir eşitliği kilitler. Kopyayı ELLE
 * düzenleme.
 *
 * ⚠️ Notlar PAKETE GÖMÜLÜDÜR, sunucudan çekilmez. İki sebep: tablet bilinçli
 * olarak çevrimdışı çalışıyor (ağ isteği + hata dalı + önbellek yönetimi
 * gerekmesin) ve OTA güncellemesi not TAŞIMIYOR — gömülü dosya OTA paketiyle
 * birlikte gittiği için en sık güncelleme türü de kapsanıyor.
 */
export type NotKapsam = 'panel' | 'tablet' | 'her-ikisi';
export type NotTip = 'yeni' | 'duzeltme' | 'iyilestirme';

export interface SurumNotuMaddesi {
  kapsam: NotKapsam;
  tip: NotTip;
  metin: string;
}

export interface SurumNotuYayini {
  id: string;
  baslik: string;
  surumler: { panel?: string; tablet?: string };
  maddeler: SurumNotuMaddesi[];
}

/** Modalda gösterilecek en fazla yayın (fazlası "…ve N eski not daha"). */
export const MODAL_TAVAN = 5;

const ISARET_ANAHTAR = 'surum_notu_gorulen';

export const SURUM_NOTLARI: SurumNotuYayini[] =
  ((notlar as unknown as { yayinlar?: SurumNotuYayini[] }).yayinlar ?? []);

/** İki sürümü karşılaştırır (a<b negatif). Parçalar SAYISAL — "2.10.0" > "2.9.0". */
function surumKiyas(a: string, b: string): number {
  const p = (v: string) =>
    String(v ?? '')
      .trim()
      .split('.')
      .slice(0, 3)
      .map((x) => {
        const n = Number.parseInt(x, 10);
        return Number.isFinite(n) ? n : 0;
      });
  const pa = p(a);
  const pb = p(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function kapsamaGoreSuz(y: SurumNotuYayini): SurumNotuYayini {
  return {
    ...y,
    maddeler: y.maddeler.filter((m) => m.kapsam === 'tablet' || m.kapsam === 'her-ikisi'),
  };
}

/**
 * Açılışta gösterilecek yayınlar (tablet kapsamı).
 *
 * · **İlk kurulum** (işaret yok) → YALNIZ en yeni kayıt. Hiç göstermemek
 *   özelliğin ilk turda görünmemesi, hepsini basmak ise körleşme demekti.
 * · **Sürüm atlama** → aradaki tüm yayınlar (tavana kadar).
 * · **Kurulu sürümü aşan kayıt** gösterilmez.
 * · **Geri alma** (işaret ileride) → boş, çökme yok.
 *
 * Karşılaştırma `id > isaret` (düz string): `id` tarih biçiminde olduğu için
 * sözlüksel sıra kronolojik sırayla aynıdır ve kayıtlı işaret dosyadan silinse
 * bile mantık çalışır.
 */
export function gosterilecekYayinlar(
  yayinlar: SurumNotuYayini[],
  isaret: string | null,
  kuruluSurum: string | null,
): { liste: SurumNotuYayini[]; gizlenen: number } {
  if (!kuruluSurum) return { liste: [], gizlenen: 0 };

  const ilgili = yayinlar
    .filter((y) => {
      const s = y.surumler?.tablet;
      if (!s) return false; // bu turda tablet çıkmamış
      return surumKiyas(s, kuruluSurum) <= 0;
    })
    .map(kapsamaGoreSuz)
    .filter((y) => y.maddeler.length > 0);

  const aday = isaret === null ? ilgili.slice(0, 1) : ilgili.filter((y) => y.id > isaret);
  return { liste: aday.slice(0, MODAL_TAVAN), gizlenen: Math.max(0, aday.length - MODAL_TAVAN) };
}

/** "Görüldü" damgası — kurulu sürümü aşmayan en yeni yayın. */
export function damgalanacakId(
  yayinlar: SurumNotuYayini[],
  kuruluSurum: string | null,
): string | null {
  if (!kuruluSurum) return null;
  const u = yayinlar.find((y) => {
    const s = y.surumler?.tablet;
    return s != null && surumKiyas(s, kuruluSurum) <= 0;
  });
  return u?.id ?? null;
}

/** Ayarlar ekranı için: tableti ilgilendiren tüm geçmiş. */
export function tumYayinlar(): SurumNotuYayini[] {
  return SURUM_NOTLARI.map(kapsamaGoreSuz).filter((y) => y.maddeler.length > 0);
}

// --- İşaret (makine başına) ---------------------------------------------
export async function isaretOku(): Promise<string | null> {
  try {
    return await storage.getItem(ISARET_ANAHTAR);
  } catch {
    return null; // depolama okunamazsa pencere tekrar çıkar — sessizce yutmaktan iyi
  }
}

export async function isaretYaz(id: string): Promise<void> {
  try {
    await storage.setItem(ISARET_ANAHTAR, id);
  } catch {
    /* sessiz geç */
  }
}
