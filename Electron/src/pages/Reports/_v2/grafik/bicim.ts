// Grafik metin/istatistik yardımcıları — seçenek (ekran/SVG) ve veri tablosu (Excel/PDF)
// AYNI metni bassın diye tek yerde. Sayı `lib/number-format`, tarih `lib/factory-time`.
import { upTo3Text } from "@/lib/number-format";
import { fmtDayKey, fmtFactoryDate } from "@/lib/factory-time";
import type { GrafikBlok } from "./tipler";

/** Boş grafik metni — ekran, PDF ve anlatının `veriYok` dili aynı. */
export const GRAFIK_VERI_YOK = "Grafik için veri yok";

export const sonlu = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Zaman ekseni anahtarı → görünen tarih: gün `yyyy-MM-dd`, an (ISO) fabrika diliminde, ay `yyyy-MM`. */
export function kategoriEtiketi(k: string, xTur: GrafikBlok["eksen"]["x"]["tur"]): string {
  if (xTur !== "zaman") return k;
  if (/^\d{4}-\d{2}-\d{2}$/.test(k)) return fmtDayKey(k, k);
  if (/^\d{4}-\d{2}-\d{2}T/.test(k)) return fmtFactoryDate(k, k);
  const ay = /^(\d{4})-(\d{2})$/.exec(k);
  return ay ? `${ay[2]}.${ay[1]}` : k;
}

/** Değer + birim metni (tooltip, pasta etiketi): `%12,5` · `9.800 m` · `—`. */
export function valueText(v: unknown, birim: string): string {
  if (!sonlu(v)) return "—";
  if (birim === "%") return `%${upTo3Text(v)}`;
  return birim ? `${upTo3Text(v)} ${birim}` : upTo3Text(v);
}

/** Çizilecek nokta yok mu (kategori yok ya da bütün değerler boş). */
export function grafikBosMu(blok: GrafikBlok): boolean {
  const hasValue = blok.seriler.some((s) => s.veri.some(sonlu));
  if (blok.tur === "kutu") return !hasValue;
  return blok.kategoriler.length === 0 || !hasValue;
}

/** Kutu istatistiği: [en küçük, alt çeyrek, orta, üst çeyrek, en büyük] (bıyık 1,5 × çeyrek aralığı) + aykırılar. */
export function kutuIstatistigi(veri: (number | null)[]): { kutu: [number, number, number, number, number]; aykirilar: number[] } | null {
  const s = veri.filter(sonlu).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const q = (p: number) => {
    const i = (s.length - 1) * p;
    const a = Math.floor(i);
    const b = Math.ceil(i);
    return s[a]! + (s[b]! - s[a]!) * (i - a);
  };
  const q1 = q(0.25);
  const q3 = q(0.75);
  const iqr = q3 - q1;
  const ic = s.filter((v) => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
  return {
    kutu: [ic[0] ?? s[0]!, q1, q(0.5), q3, ic[ic.length - 1] ?? s[s.length - 1]!],
    aykirilar: s.filter((v) => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr),
  };
}

/** Ortak eksen tavanı yuvarlak sayıya: 1.246 → 1.500 (ham tavan eksende çirkin etiket basar). */
export function niceCeiling(v: number): number {
  if (v <= 0) return 0;
  const us = 10 ** Math.floor(Math.log10(v));
  const adim = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((k) => k * us >= v) ?? 10;
  return adim * us;
}
