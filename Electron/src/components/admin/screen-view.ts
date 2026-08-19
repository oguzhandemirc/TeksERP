// =============================================================================
// "Ekrana göre" yetki görünümünün saf mantığı (2026-08-19)
// =============================================================================
// Bileşenden AYRI: kural render'sız sınanabilmeli. İçeride kalsaydı test ya DOM
// kurardı ya da kuralın KOPYASINI sınardı (kopya sonda, ifade değişince eskir).
//
// Karar belgesi: docs/design/YETKI-MIMARISI.md
// =============================================================================
import type { ScreenEntry } from "@/services/screenCatalogService";

/** Bir ekranın, seçili yetkilere göre durumu. */
export type ScreenAccess =
  /** Giriş izni seçili — ekran açılır. */
  | "open"
  /** Giriş izni YOK ama içeriden yetenek işaretlenmiş → o yetenek ETKİSİZ. */
  | "capability-only"
  /** Hiçbiri seçili değil. */
  | "closed";

export function screenAccess(screen: ScreenEntry, selectedCodes: Set<string>): ScreenAccess {
  // `requires` HERHANGİ BİRİ yeterlidir (ör. belge tasarımı: admin:settings VEYA
  // document-template:read VEYA :write) — "hepsi" aramak ekranı kapalı gösterirdi.
  if (screen.requires.some((c) => selectedCodes.has(c))) return "open";
  if (screen.capabilities.some((c) => selectedCodes.has(c.code))) return "capability-only";
  return "closed";
}

/**
 * Bir yetkiyi kullanan ekranlar — "bunu kaldırırsam nereler etkilenir".
 *
 * ⚠️ Bu, yetkiyi ÇOĞALTMAMANIN bedelidir ve arayüz bunu SÖYLEMEK ZORUNDA:
 * `mobile:kumas` üç ekranda kullanılıyor; birinden kaldıran kişi diğer ikisini
 * de kapattığını görmezse "KK1'den kaldırdım, Hızlı İş Emri bozuldu" sürprizi olur.
 */
export function screensUsing(screens: ScreenEntry[], code: string): ScreenEntry[] {
  return screens.filter(
    (s) => s.requires.includes(code) || s.capabilities.some((c) => c.code === code),
  );
}

/** Ekran başlığı/anahtarı üzerinde arama — Türkçe-duyarsız katlama çağıran verir. */
export function filterScreens(
  screens: ScreenEntry[],
  term: string,
  fold: (v: string) => string,
): ScreenEntry[] {
  const q = fold(term.trim());
  if (!q) return screens;
  return screens.filter(
    (s) =>
      fold(s.title).includes(q) ||
      fold(s.key).includes(q) ||
      // Yetki KODUYLA da bulunabilsin: yönetici "label:edit nerede kullanılıyor"
      // diye arayabilmeli — manifestonun en çok işe yarayacağı sorgu bu.
      s.requires.some((c) => fold(c).includes(q)) ||
      s.capabilities.some((c) => fold(c.code).includes(q) || fold(c.label).includes(q)),
  );
}

/** Ekranı açan + içindeki tüm yetkiler (tekilleştirilmiş, sıra korunur). */
export function screenCodes(screen: ScreenEntry): string[] {
  return [...new Set([...screen.requires, ...screen.capabilities.map((c) => c.code)])];
}
