// Pano metin biçimleri — sayı `lib/format` (tr, program kuralı: binlik ayıracı yok), saat `lib/factory-time`.
import { formatNumber } from "@/lib/format";
import { factoryDayKey, formatFactory } from "@/lib/factory-time";
import type { PanoDonem, PanoKova, PanoKpi } from "./types";

export const DONEM_ETIKETI: Record<PanoDonem, string> = { bugun: "Bugün", hafta: "Hafta", ay: "Ay", yil: "Yıl" };

/** Backend önceki pencereyi aynı uzunlukta geri kaydırır (`pano-donem.ts`); rozet bunu söyler. */
const KIYAS_ETIKETI: Record<PanoDonem, string> = {
  bugun: "düne göre",
  hafta: "önceki 7 güne göre",
  ay: "önceki 30 güne göre",
  yil: "önceki 12 aya göre",
};

export const metre = (n: number): string => `${formatNumber(n, 0)} m`;
export const formatCount = (n: number): string => formatNumber(n, 0);
export const kg = (n: number): string => `${formatNumber(n, 0)} kg`;
export const para = (n: number, birim: string): string => `${formatNumber(n, 2)} ${birim}`;

export interface DegisimRozeti {
  metin: string;
  /** Rozetin renkli parçası ("%12,5") ve gri kıyas metni ("önceki 7 güne göre"). */
  yuzde: string;
  kiyas: string;
  trend: "up" | "down" | "neutral";
}

/** `degisimYuzde` null (önceki dönem 0) → rozet YOK; sıfır değişim nötr. */
export function degisimRozeti(k: PanoKpi | null | undefined, donem: PanoDonem): DegisimRozeti | null {
  if (!k || k.degisimYuzde === null) return null;
  const y = k.degisimYuzde;
  const trend = y > 0 ? "up" : y < 0 ? "down" : "neutral";
  const yuzde = `%${formatNumber(Math.abs(y), 1)}`;
  // Kartta kısa kıyas (dar kartta "önceki 30 güne göre" kırpılıyordu); kesin pencere `metin`de (ipucu).
  return { metin: `${yuzde} ${KIYAS_ETIKETI[donem]}`, yuzde, kiyas: donem === "bugun" ? "düne göre" : "önceki döneme göre", trend };
}

const AYLAR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

/** Eğilim ekseni etiketi: saat "09:00" · gün "11.11" · ay "Kas 26" (anahtar sunucuda fabrika diliminde kuruldu). */
export function kovaEtiketi(anahtar: string, kova: PanoKova): string {
  if (kova === "saat") return `${anahtar.padStart(2, "0")}:00`;
  if (kova === "gun") {
    const [, m, d] = anahtar.split("-");
    return `${d}.${m}`;
  }
  const [y, m] = anahtar.split("-");
  return `${AYLAR[Number(m) - 1] ?? m} ${y?.slice(2) ?? ""}`;
}

/** Hareket zamanı: bugünse "14:05", değilse "10.11 14:05" (fabrika dilimi). */
export function hareketZamani(iso: string, now: Date = new Date()): string {
  return factoryDayKey(iso) === factoryDayKey(now) ? formatFactory(iso, "HH:mm") : formatFactory(iso, "dd.MM HH:mm");
}
