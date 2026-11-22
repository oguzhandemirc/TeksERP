// Çözgü kartı görseli (tel düzeni şeridi + tarak planı) için SAF yerleşim yardımcıları. Dizilim notunu
// AÇMAZ — açılım sunucudan `endsSequence` olarak gelir (tek kaynak `warp-sequence.helper.ts`); burada yalnız
// gelen raporun kaç kez çizileceği, oransal blok payı ve tarak dişlerine dağılımı hesaplanır.

/** Sunucu `WarpEndsSequence` aynası (GET /api/item-construction, /api/warp-specs/:id). */
export interface WarpEndsSequenceView {
  /** Bir raporun tel tel açılımı: 1-tabanlı iplik satırı no (A = 1). */
  repeat: number[];
  repeatCount: number;
  remainder: number;
  totalEnds: number;
  matchesYarnEnds: boolean;
}

/** Şeritte çizilecek rapor adedi: kısa raporda tekrar görünsün diye 2–3 rapor, uzunda tek rapor. */
export function repeatsToShow(repeatLen: number, maxCells = 120): number {
  if (repeatLen <= 0) return 0;
  const fit = Math.floor(maxCells / repeatLen);
  return Math.max(1, Math.min(3, fit));
}

/** Şerit hücre kenarı (px): genişliğe sığacak en iri kare, 3–18 px (uzun raporda kutu yatay kayar). */
export function stripCell(cols: number, maxWidth = 640): number {
  if (cols <= 0) return 18;
  return Math.max(3, Math.min(18, Math.floor(maxWidth / cols)));
}

/** Açılım toplam tele yayılınca her ipliğe düşen tel (uyuşmazlık uyarısında kartla yan yana yazılır). */
export function endsPerYarnFromSequence(seq: WarpEndsSequenceView, yarnCount: number): number[] {
  const out = new Array<number>(Math.max(0, yarnCount)).fill(0);
  seq.repeat.forEach((n, i) => {
    if (n >= 1 && n <= out.length) out[n - 1] = out[n - 1]! + seq.repeatCount + (i < seq.remainder ? 1 : 0);
  });
  return out;
}

export interface ProportionalSegment {
  /** 1-tabanlı iplik no (A = 1). */
  yarn: number;
  ends: number;
  /** Bant genişliğindeki pay, 0–100. */
  pct: number;
}

/** Dizilim yoksa/çözülemezse: iplik başına tel payı kadar blok (sıfır telli satır çizilmez). */
export function proportionalSegments(endsByYarn: readonly number[]): ProportionalSegment[] {
  const total = endsByYarn.reduce((s, n) => s + (n > 0 ? n : 0), 0);
  if (total <= 0) return [];
  return endsByYarn
    .map((ends, i) => ({ yarn: i + 1, ends, pct: (ends / total) * 100 }))
    .filter((s) => s.ends > 0);
}

export interface ReedSample {
  /** Bir kenardaki kenar teli (toplam kenar telinin yarısı, aşağı yuvarlanır). */
  selvedgePerSide: number;
  /** Bir kenarın kaç dişe girdiği. */
  selvedgeDents: number;
  /** Zemin tellerinin girdiği diş adedi (yaklaşık; son diş eksik olabilir). */
  groundDents: number;
  totalDents: number;
  /** Örnek olarak çizilen hücreler: diş başına `endsPerDent` tel; değer = iplik no, 0 = kenar teli. */
  cells: number[];
  /** Hücre dizisinde diş başlangıçları (WeaveGrid `colGapsBefore`). */
  dentStarts: number[];
  /** Örnekte kaç kenar dişi çizildi (kalanı "…" ile kısaltılır). */
  shownSelvedgeDents: number;
}

/**
 * Tarak planı örneği: sol kenardan başlayarak birkaç kenar dişi + birkaç zemin dişi. Zemin telleri rapor
 * sırasıyla (yoksa A) boyanır; kenar teli 0. Tarak/diş bilgisi yoksa null.
 */
export function reedSample(input: {
  endsPerDent: number | null | undefined;
  totalEnds: number;
  selvedgeEnds: number | null | undefined;
  repeat?: readonly number[] | null;
  maxSelvedgeDents?: number;
  groundDentsShown?: number;
}): ReedSample | null {
  const epd = input.endsPerDent ?? 0;
  if (!Number.isInteger(epd) || epd <= 0 || epd > 12 || input.totalEnds <= 0) return null;
  const selvedgePerSide = Math.max(0, Math.floor((input.selvedgeEnds ?? 0) / 2));
  const selvedgeDents = Math.ceil(selvedgePerSide / epd);
  const groundEnds = Math.max(0, input.totalEnds - 2 * selvedgePerSide);
  const groundDents = Math.ceil(groundEnds / epd);
  const shownSelvedgeDents = Math.min(selvedgeDents, input.maxSelvedgeDents ?? 2);
  const shownGround = Math.min(groundDents, input.groundDentsShown ?? 12);
  const cells: number[] = [];
  const dentStarts: number[] = [];
  for (let d = 0; d < shownSelvedgeDents; d++) {
    dentStarts.push(cells.length);
    // Son kenar dişi eksik dolabilir; örnekte tam diş çizilir, sayı özet satırında doğrudur.
    for (let e = 0; e < epd; e++) cells.push(0);
  }
  const rep = input.repeat && input.repeat.length > 0 ? input.repeat : [1];
  let k = 0;
  for (let d = 0; d < shownGround; d++) {
    dentStarts.push(cells.length);
    for (let e = 0; e < epd; e++) cells.push(rep[k++ % rep.length]!);
  }
  return {
    selvedgePerSide, selvedgeDents, groundDents, totalDents: 2 * selvedgeDents + groundDents,
    cells, dentStarts, shownSelvedgeDents,
  };
}
