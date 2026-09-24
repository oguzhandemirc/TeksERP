import ham from "@/data/surum-notlari.json";
import { compareVersions } from "@/lib/version-compare";

/**
 * Sürüm notları — "bu güncellemede neler değişti".
 *
 * Kaynak repo kökündeki `surum-notlari.json`; buradaki kopya
 * `scripts/surum-notlari-kopyala.mjs` ile üretilir ve bekçi
 * (`scripts/test_surum_notlari.ts`) birebir eşitliği kilitler. Kopyayı ELLE
 * düzenleme — kaynağı düzenle, script'i çalıştır.
 *
 * Notlar pakete GÖMÜLÜDÜR, sunucudan çekilmez: tablet bilinçli olarak çevrimdışı
 * çalışıyor ve mobil OTA güncellemesi not taşımıyor — gömülü dosya paketle
 * birlikte gittiği için en sık güncelleme türü de kapsanıyor.
 */
export type NotKapsam = "panel" | "tablet" | "her-ikisi";
export type NotTip = "yeni" | "duzeltme" | "iyilestirme";

export interface SurumNotuMaddesi {
  kapsam: NotKapsam;
  tip: NotTip;
  metin: string;
}

export interface SurumNotuYayini {
  /** Yayın turunun kimliği: YYYY-AA-GG (aynı gün ikinci yayın → "2026-08-28b"). */
  id: string;
  baslik: string;
  /** O turda hangi ürün hangi sürüme çıktı; çıkmayan ürünün alanı yoktur. */
  surumler: { panel?: string; tablet?: string };
  maddeler: SurumNotuMaddesi[];
}

interface Dosya {
  yayinlar: SurumNotuYayini[];
}

/** Tüm yayınlar, en yeni önce. */
export const SURUM_NOTLARI: SurumNotuYayini[] = (ham as unknown as Dosya).yayinlar ?? [];

/** Bu ürünü ilgilendiren maddeler ("her-ikisi" her zaman girer). */
function kapsamaGoreSuz(yayin: SurumNotuYayini, kapsam: "panel" | "tablet"): SurumNotuYayini {
  return {
    ...yayin,
    maddeler: yayin.maddeler.filter((m) => m.kapsam === kapsam || m.kapsam === "her-ikisi"),
  };
}

/** Yayının bu ürün için ilan ettiği sürüm (yoksa null — o turda bu ürün çıkmamış). */
function yayinSurumu(yayin: SurumNotuYayini, kapsam: "panel" | "tablet"): string | null {
  return (kapsam === "panel" ? yayin.surumler.panel : yayin.surumler.tablet) ?? null;
}

/**
 * Modalda gösterilecek en fazla yayın sayısı. Bir ay kapalı kalmış makine
 * duvar gibi metinle açılmasın; fazlası "…ve N eski not daha" satırıyla
 * Ayarlar'a yönlendirilir.
 */
export const MODAL_TAVAN = 5;

/**
 * Açılışta gösterilecek yayınlar.
 *
 * @param yayinlar     tüm notlar (en yeni önce)
 * @param sonGorulenId bu makinede en son gösterilen yayın id'si (hiç yoksa null)
 * @param kuruluSurum  bu üründe kurulu sürüm
 * @param kapsam       "panel" | "tablet"
 *
 * Kurallar ve gerekçeleri:
 * · **İlk kurulum** (`sonGorulenId` null) → YALNIZ en yeni kayıt döner. İki uç da
 *   yanlıştı: hiçbir şey göstermemek, özelliğin sahaya çıktığı ilk turda kimseye
 *   görünmemesi (ve "çalışmıyor" sanılması) demekti; 20 kaydı birden basmak ise
 *   bu repoda adı konmuş arızadır — hep bağıran bir uyarı, bir süre sonra hiç
 *   okunmayan bir uyarıdır. Orta yol: "elindeki sürüm bu, getirdiği bu".
 * · **Sürüm atlama** → aradaki TÜM yayınlar döner (tavana kadar); atlanan
 *   sürümlerin değişiklikleri o makinede yenidir.
 * · **Kuruluyu aşan kayıt** gösterilmez — paket kendi geleceğini duyurmamalı.
 * · **Geri alma** (işaret ileride) → boş döner; geriye giden makineye "yenilikler"
 *   göstermek yanlış olurdu. Bilinen bedel: geri alınıp tekrar ileri alınan
 *   makine, atladığı turun notunu modalda kaçırır — Ayarlar'daki arşivde durur.
 *   Tam doğruluk için işaretin bir KÜME olması gerekirdi; geri alma elle ve nadir
 *   bir işlem, sınırsız büyüyen bir küme taşımaya değmez.
 * · **Süzme sonrası maddesi kalmayan yayın** listeye girmez (boş modal çıkmasın).
 *
 * Karşılaştırma `id > sonGorulenId` (düz string) — `id` tarih biçiminde olduğu
 * için sözlüksel sıra kronolojik sırayla AYNIDIR ve kayıtlı id dosyadan silinse
 * bile mantık çalışmaya devam eder (indeks araması öyle değildi).
 */
export function gosterilecekYayinlar(
  yayinlar: SurumNotuYayini[],
  sonGorulenId: string | null,
  kuruluSurum: string | null,
  kapsam: "panel" | "tablet",
): { liste: SurumNotuYayini[]; gizlenen: number } {
  if (!kuruluSurum) return { liste: [], gizlenen: 0 };

  // Bu ürünü ilgilendiren ve kurulu sürümü aşmayan kayıtlar.
  const ilgili = yayinlar
    .filter((y) => {
      const s = yayinSurumu(y, kapsam);
      // Bu üründe çıkmamış tur (ör. yalnız tablet yayını) panelde gösterilmez.
      if (!s) return false;
      return compareVersions(s, kuruluSurum) <= 0;
    })
    .map((y) => kapsamaGoreSuz(y, kapsam))
    .filter((y) => y.maddeler.length > 0);

  const aday =
    sonGorulenId === null ? ilgili.slice(0, 1) : ilgili.filter((y) => y.id > sonGorulenId);

  return { liste: aday.slice(0, MODAL_TAVAN), gizlenen: Math.max(0, aday.length - MODAL_TAVAN) };
}

/**
 * "Görüldü" damgası için kaydedilecek id — kurulu sürümü AŞMAYAN en yeni yayın.
 * Aşan kayıtları damgalasaydık, o sürüme geçildiğinde notu bir daha görmezdik.
 */
export function damgalanacakId(
  yayinlar: SurumNotuYayini[],
  kuruluSurum: string | null,
  kapsam: "panel" | "tablet",
): string | null {
  if (!kuruluSurum) return null;
  const uygun = yayinlar.find((y) => {
    const s = yayinSurumu(y, kapsam);
    return s != null && compareVersions(s, kuruluSurum) <= 0;
  });
  return uygun?.id ?? null;
}

/** Ayarlar ekranı için: bu ürünü ilgilendiren tüm geçmiş (maddesi olanlar). */
export function tumYayinlar(kapsam: "panel" | "tablet"): SurumNotuYayini[] {
  return SURUM_NOTLARI.map((y) => kapsamaGoreSuz(y, kapsam)).filter((y) => y.maddeler.length > 0);
}

/** İngilizce adlar — yeni kod bu takma adları kullanır (tanımlayıcı dili kuralı). */
export type ReleaseEntry = SurumNotuYayini;
export type ReleaseItem = SurumNotuMaddesi;
export type ReleaseItemType = NotTip;
export type ReleaseItemScope = NotKapsam;
export const RELEASE_ENTRIES: ReleaseEntry[] = SURUM_NOTLARI;
