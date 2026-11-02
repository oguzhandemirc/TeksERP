// El yazısı ızgarası ŞÜPHELİ DEĞER kuralı (saf; `taslak.ts`ten max-lines için ayrıldı, oradan yeniden dışa verilir).
// Oran K fabrika ayarıdır (`gelenBelge.handwritingOutlierFactor`); işaret `ocrRaw._suspect`, `lineProblems` SUSPECT_VALUE okur.
/** Metre hücresinin anahtarları (tablo + ızgara; taslak eşlemesi de buradan alır). */
export const METER_KEYS = ["m", "metre"];

/**
 * El yazısı ızgarasında şüpheli değer oranı K (fabrika ayarı `gelenBelge.handwritingOutlierFactor`): blok medyanının
 * 1/K'sından küçük ya da K katından büyük metre şüphelidir. 4 = bugünkü alt sınır (medyanın %25'i); üst sınır yeni.
 */
export const DEFAULT_OUTLIER_FACTOR = 4;
export const OUTLIER_FACTOR_MIN = 2;
export const OUTLIER_FACTOR_MAX = 20;
/** Şüpheli satırın `ocrRaw` işareti (hücre anahtarı değil; `lineProblems` SUSPECT_VALUE buradan okur). */
export const SUSPECT_MARK = "_suspect";
export type SuspectReason = "HARF" | "DUSUK" | "YUKSEK";

type GridLineLike = { senderRollNo: string | null; meters: string; ocrRaw: Record<string, string | null> };

/** Geçersiz/çöp oran varsayılana düşer (ayar okuyucusu da aynı aralığı uygular). */
export const clampOutlierFactor = (k: number | undefined): number =>
  typeof k === "number" && Number.isFinite(k) && k >= OUTLIER_FACTOR_MIN && k <= OUTLIER_FACTOR_MAX ? k : DEFAULT_OUTLIER_FACTOR;

/**
 * El yazısında OCR güveni yanlış rakamı doğrudan ayırmıyor (ölçüm 2026-11-02: yanlışlar 0,64–0,91, doğrular 0,59–0,98);
 * ucuz işaretler ayırıyor: ham metinde harf ("1J6" → 1), medyanın 1/K'sından küçük ("137" → 3) ya da K katından büyük
 * ("137" → 1370) değer. Satır başına neden (şüphesizse null). Yalnız UYARI; medyan ≥ 3 değerle.
 */
export function suspectGridReasons(lines: GridLineLike[], factor: number = DEFAULT_OUTLIER_FACTOR): Array<SuspectReason | null> {
  const k = clampOutlierFactor(factor);
  const vals = lines.map((l) => Number(l.meters)).sort((a, b) => a - b);
  const median = vals.length ? vals[Math.floor(vals.length / 2)]! : 0;
  return lines.map((l) => {
    const raw = Object.entries(l.ocrRaw).find(([key]) => METER_KEYS.includes(key))?.[1] ?? "";
    if (/\p{L}/u.test(raw)) return "HARF";
    if (vals.length < 3) return null;
    const m = Number(l.meters);
    if (m < median / k) return "DUSUK";
    if (m > median * k) return "YUKSEK";
    return null;
  });
}

export function suspectGridSeqs(lines: GridLineLike[], factor: number = DEFAULT_OUTLIER_FACTOR): string[] {
  const reasons = suspectGridReasons(lines, factor);
  return lines.filter((_, i) => reasons[i]).map((l) => l.senderRollNo ?? "?");
}

/** Bloğun şüpheli satırlarına `ocrRaw._suspect` işaretini koyar; şüpheli varsa uyarı metni döner. */
export function markGridSuspects(block: GridLineLike[], factor: number): string | null {
  const reasons = suspectGridReasons(block, factor);
  block.forEach((l, i) => {
    if (reasons[i]) l.ocrRaw[SUSPECT_MARK] = reasons[i];
  });
  const suspects = block.filter((_, i) => reasons[i]).map((l) => l.senderRollNo ?? "?");
  if (!suspects.length) return null;
  return `GRID_SUSPECT_VALUES: ${suspects.join(", ")} numaralı hücre(ler)in metresi şüpheli (harf karışmış ya da diğerlerinden çok küçük/büyük) — önce bunları kontrol edin`;
}
