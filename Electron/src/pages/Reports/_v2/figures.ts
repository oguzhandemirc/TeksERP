// Rapor v2 sayı kartı metinleri — ekran kartı ile PDF/Excel "Özet" AYNI metni bassın diye tek yerde.
// Biçim sunucunun anlatı biçimiyle aynı kural (`anlati/sayi-bicim.ts`): oran "%78", para 0 ondalık,
// diğerleri en çok 1 ondalık. Ölçülemeyen değer "0" YAZILMAZ — "Ölçülemedi" yazılır.
import { fixedDecimalsOf } from "@/lib/number-format";
import { BIRIM_METNI, PARA_BIRIMLERI, type AnaSayi, type Birim, type ComparisonTone } from "./sunum";
import { MONEY_NUM_FMT } from "./table-model";

export const NOT_MEASURED_TEXT = "Ölçülemedi";

function numberText(n: number, maxDecimals: number): string {
  return n.toLocaleString("tr-TR", { maximumFractionDigits: maxDecimals });
}

/** Değer + birim: "%78" · "42.300 m" · "1.200 TL"; `null` → "Ölçülemedi". */
export function formatFigure(value: number | null, unit: Birim): string {
  if (value === null || !Number.isFinite(value)) return NOT_MEASURED_TEXT;
  if (unit === "yuzde") return `%${numberText(value, 1)}`;
  if (PARA_BIRIMLERI.includes(unit)) return `${numberText(value, fixedDecimalsOf(MONEY_NUM_FMT))} ${BIRIM_METNI[unit]}`;
  return `${numberText(value, 1)} ${BIRIM_METNI[unit]}`;
}

const ARROW = { artti: "▲", azaldi: "▼", degismedi: "＝" } as const;

/**
 * Kıyas satırı: "▼ 6 puan (Eylül 2026: %84)". Oranlarda fark PUAN, diğerlerinde yüzde değişim;
 * sıfır payda (yüzde null) ise mutlak fark. Kıyas ölçülemediyse bunu söyler, sayı uydurmaz.
 */
export function comparisonText(figure: AnaSayi, periodLabel?: string): string | null {
  const c = figure.kiyas;
  if (!c) return null;
  const before = c.deger === null ? NOT_MEASURED_TEXT : formatFigure(c.deger, figure.birim);
  const tail = periodLabel ? ` (${periodLabel}: ${before})` : ` (önceki: ${before})`;
  if (c.yon === null || c.fark === null) return `Kıyas yapılamadı${tail}`;
  if (c.yon === "degismedi") return `${ARROW.degismedi} Değişmedi${tail}`;
  const arrow = ARROW[c.yon];
  if (figure.birim === "yuzde") return `${arrow} ${numberText(Math.abs(c.fark), 1)} puan${tail}`;
  if (c.yuzde !== null) return `${arrow} %${numberText(Math.abs(c.yuzde), 1)}${tail}`;
  return `${arrow} ${formatFigure(Math.abs(c.fark), figure.birim)}${tail}`;
}

/** Kıyas okunun rengi `durum`dan (sunucu `IyiYon` × yön ile hesapladı); istemci yeniden yorumlamaz. */
export function toneClass(tone: ComparisonTone | undefined): string {
  if (tone === "iyi") return "text-emerald-600 dark:text-emerald-400";
  if (tone === "kotu") return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}
