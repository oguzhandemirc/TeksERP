// =============================================================================
// TEL DÜZENİ BANDI — saf yerleşim (çizim `WarpEndsBand.tsx`te)
// =============================================================================
// Bir raporun telleri soldan sağa, her tel iplik harfinin rengiyle. Açılım SUNUCUDAN (`endsSequence`,
// `warp-sequence.helper`); tablet dizilim notunu ÇÖZMEZ. Not yok/okunamaz → iplik paylarıyla oransal
// bloklar. Tek iplikli kartta bant anlamsız → null (bugünkü ekran). Ardışık aynı iplik TEK dikdörtgen.
// =============================================================================
import type { WarpEndsSequence, WarpSpecYarnRow } from '../../services/warpBeam.service';

export interface WarpBandSegment {
  /** 1-tabanlı iplik no (A = 1) — renk `yarnColor`dan. */
  yarn: number;
  x: number;
  w: number;
}

export interface WarpBandModel {
  kind: 'sequence' | 'proportional';
  segments: WarpBandSegment[];
  /** Tel ayraçları (yalnız tel yeterince genişse; dar bantta çizgi rengi bastırır). */
  ticksPath: string;
  width: number;
}

export interface WarpBandInput {
  yarns?: readonly WarpSpecYarnRow[] | null;
  endsSequence?: WarpEndsSequence | null;
}

/** Tel ayraçlarının çizildiği en dar tel genişliği (px). */
export const TICK_MIN_CELL = 6;

/** Bant çizilir mi? İki+ iplik satırı gerekir (eski sunucu `yarns` göndermez → false). */
export function hasWarpBand(input: WarpBandInput): boolean {
  return Array.isArray(input.yarns) && input.yarns.length >= 2;
}

export function warpBandLayout(input: WarpBandInput, width: number, height: number): WarpBandModel | null {
  if (!hasWarpBand(input) || !(width > 0)) return null;
  const yarns = input.yarns!;
  const seq = input.endsSequence;
  if (seq && seq.repeat.length > 0) {
    const cell = width / seq.repeat.length;
    const segments: WarpBandSegment[] = [];
    let start = 0;
    for (let i = 1; i <= seq.repeat.length; i++) {
      if (i < seq.repeat.length && seq.repeat[i] === seq.repeat[start]) continue;
      segments.push({ yarn: seq.repeat[start]!, x: start * cell, w: (i - start) * cell });
      start = i;
    }
    let ticksPath = '';
    if (cell >= TICK_MIN_CELL) for (let i = 1; i < seq.repeat.length; i++) ticksPath += `M${i * cell} 0V${height}`;
    return { kind: 'sequence', segments, ticksPath, width };
  }
  const total = yarns.reduce((s, y) => s + Math.max(0, y.endsCount), 0);
  if (!(total > 0)) return null;
  let x = 0;
  const segments = yarns.map((y, i) => {
    const w = (Math.max(0, y.endsCount) / total) * width;
    const seg = { yarn: i + 1, x, w };
    x += w;
    return seg;
  }).filter((s) => s.w > 0);
  return { kind: 'proportional', segments, ticksPath: '', width };
}

/** Bant altı satırı: "Çözgü raporu 3 tel × 1166 + 2 = 3500 tel" ya da oransal açıklaması. */
export function warpBandCaption(input: WarpBandInput & { sequenceNote?: string | null }): string {
  const seq = input.endsSequence;
  if (seq && seq.repeat.length > 0) {
    const rest = seq.remainder > 0 ? ` + ${seq.remainder}` : '';
    return `Çözgü raporu ${seq.repeat.length} tel × ${seq.repeatCount}${rest} = ${seq.totalEnds} tel`;
  }
  const note = input.sequenceNote?.trim();
  return note ? `Çözgü raporu "${note}" okunamadı — iplik payına göre gösteriliyor` : 'Çözgü raporu yazılmamış — iplik payına göre gösteriliyor';
}
