/**
 * FasonReceiveInline'ın saf (test edilebilir) parça mantığı.
 *
 * Boyahane topları genelde DİKEREK tek parça döndürür → varsayılan mod SINGLE:
 * tek parça, metre = giden topların toplamı. İstisna PER_ROLL ("adet adet
 * geldi"): giden her top için bir parça, metre = topun sevk metresi.
 */

export type FasonReceiveMode = "SINGLE" | "PER_ROLL";

/** Metraj toplamındaki yüzer-nokta gürültüsünü at (0.1+0.2 → 0.30000000000000004). */
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Seçilen moda göre varsayılan parça listesi (metre değerleri). */
export function defaultPieces(rollQtys: number[], mode: FasonReceiveMode): number[] {
  if (mode === "SINGLE") return [piecesTotal(rollQtys)];
  return rollQtys.map((q) => (q > 0 ? q : 0));
}

/** Pozitif parçaların toplam metresi. */
export function piecesTotal(pieces: number[]): number {
  return round2(pieces.reduce((s, q) => s + (q > 0 ? q : 0), 0));
}

/** Dönen − giden metraj farkı (2 hane). |fark| ≤ 0.01 fark sayılmaz. */
export function meterDiff(sentQtys: number[], pieces: number[]): number {
  return round2(piecesTotal(pieces) - piecesTotal(sentQtys));
}

export function hasMeterDiff(sentQtys: number[], pieces: number[]): boolean {
  return Math.abs(meterDiff(sentQtys, pieces)) > 0.01;
}
