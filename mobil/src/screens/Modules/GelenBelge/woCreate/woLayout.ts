// İE formu yerleşimi: geniş ekranda (tablet yatay) belge solda, üretim/plan alanları sağda; dar ekranda tek sütun.
// Padding tek ölçek: tablet (kısa kenar ≥600dp) spacing.lg, telefon spacing.md.
import { spacing } from '../../../../theme';

export const WO_TWO_COLUMN_MIN_WIDTH = 960;
const TABLET_MIN_SHORT_SIDE = 600;

export interface WoFormLayout {
  columns: 1 | 2;
  pad: number;
}

/** `height` verilmezse kısa kenar genişlik sayılır. */
export function woFormLayout(width: number, height?: number): WoFormLayout {
  const shortSide = Math.min(width, height ?? width);
  return {
    columns: width >= WO_TWO_COLUMN_MIN_WIDTH ? 2 : 1,
    pad: shortSide >= TABLET_MIN_SHORT_SIDE ? spacing.lg : spacing.md,
  };
}
