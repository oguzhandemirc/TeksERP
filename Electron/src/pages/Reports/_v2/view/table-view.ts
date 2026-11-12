// Rapor tablosunun EKRAN görünüş kuralları (saf). Hücre metni/biçimi `table-model`den — PDF/Excel ile aynı.
// Görsel büyüklük çubuğu yeni SAYI üretmez: yalnız genişlik (kolonun en büyüğüne oranla), metin basmaz.
import type { TabloBlok, TabloKolonu } from "../sunum";
import { columnAlign } from "../table-model";

/** Bu satır sayısını aşan tabloda toplam satırı başlığın altına (üste, yapışkan) çıkar. */
export const TOTAL_ON_TOP_AFTER = 8;

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Görünür kolonlar: gizlenenler düşer; hepsi gizlenmişse ilk kolon kalır (boş tablo çizilmez). */
export function visibleColumns(table: TabloBlok, hidden: readonly string[]): TabloKolonu[] {
  const shown = table.kolonlar.filter((c) => !hidden.includes(c.anahtar));
  return shown.length > 0 ? shown : table.kolonlar.slice(0, 1);
}

/** Gizle/göster: son görünür kolon gizlenemez. */
export function toggleHidden(table: TabloBlok, hidden: readonly string[], key: string): string[] {
  if (hidden.includes(key)) return hidden.filter((k) => k !== key);
  const next = [...hidden, key];
  return visibleColumns(table, next).some((c) => !next.includes(c.anahtar)) ? next : [...hidden];
}

/**
 * Çubuk kolonu: ana sayının birimini taşıyan ilk sağa hizalı, eksisiz sayı kolonu; yoksa yok.
 * Oran (%) ve süre kolonlarına çubuk çizilmez (büyüklük değil).
 */
export function barColumnOf(table: TabloBlok, unit: string | undefined): string | null {
  if (!unit || unit === "yuzde" || unit === "gun" || unit === "saat" || unit === "dakika") return null;
  const col = table.kolonlar.find(
    (c) => c.birim === unit && columnAlign(table, c) === "right" && table.satirlar.every((r) => r[c.anahtar] == null || (isNumber(r[c.anahtar]) && (r[c.anahtar] as number) >= 0)),
  );
  return col?.anahtar ?? null;
}

/** Kolonun en büyük değeri (çubuk ölçeği); sayı yoksa 0. */
export function columnMax(table: TabloBlok, key: string): number {
  return table.satirlar.reduce<number>((m, r) => (isNumber(r[key]) && r[key] > m ? (r[key] as number) : m), 0);
}

/** Çubuk genişliği yüzdesi (0–100); ölçek ya da değer yoksa null. */
export function barWidth(value: unknown, max: number): number | null {
  if (!isNumber(value) || max <= 0) return null;
  return Math.max(2, Math.min(100, (value / max) * 100));
}
