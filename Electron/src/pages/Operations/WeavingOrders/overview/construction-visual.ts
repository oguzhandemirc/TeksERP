// Dokuma iş emri "Yapı" görseli için tip + saf yerleşim. Veri SUNUCUDAN (`GET /weaving-orders/:id/construction`):
// armür (`liftPlan`), döner çerçeveler, atkı seçici (`pickSequence`), çözgü `endsSequence` — burada hiçbiri
// yeniden hesaplanmaz; yalnız mini ızgaranın sütun düzeni (döner | zemin | seçici blokları) ve kare boyu seçilir.
import type { EffectiveConstruction, LiftPlan, WeaveDesign } from "@/pages/WeaveDesigns/types";

export type ConstructionDesign = Pick<WeaveDesign, "id" | "code" | "name" | "kind" | "shedMechanism" | "weaveStructure" | "hookCount" | "repeatWidthCm" | "repeatCm" | "loomFileName" | "frameCount"> & {
  liftPlan?: LiftPlan | null;
  lenoFrames?: number[];
  drawingInNote?: string | null;
};

/** Uç cevabı: ürünün etkin yapısı (iş emrinin pin'li kartlarıyla) + iş emri no; eski alanlar opsiyonel. */
export type WeavingOrderConstruction = EffectiveConstruction & {
  weaveDesign?: ConstructionDesign | null;
  weavingOrderNumber?: string;
};

export interface MiniLiftLayout {
  rows: number;
  frames: number;
  /** Seçici sütun adedi (iplik satırı sayısı); seçici yoksa 0. */
  selCols: number;
  cols: number;
  /** WeaveGrid `colGapsBefore`: döner/zemin geçişleri + seçici bloğu önü. */
  gaps: number[];
  cell: number;
}

/** Mini ızgaranın hedef yüksekliği (px); aşan armür kutuda dikey kayar. */
const MINI_MAX_HEIGHT = 360;

/** Mini armür + seçici düzeni; çizilecek armür yoksa null. */
export function miniLiftLayout(
  plan: LiftPlan | null | undefined, lenoFrames: readonly number[], pickSequence: readonly number[] | null | undefined,
  yarnCount: number,
): MiniLiftLayout | null {
  const maxWidth = 560;
  const frames = (plan ?? []).reduce((m, row) => Math.max(m, row.length), 0);
  if (!plan || plan.length === 0 || frames === 0) return null;
  const seq = pickSequence && pickSequence.length > 0 ? pickSequence : null;
  const selCols = seq ? Math.max(1, yarnCount, ...seq) : 0;
  const rows = Math.max(plan.length, seq?.length ?? 0);
  const leno = new Set(lenoFrames);
  const gaps: number[] = [];
  for (let c = 1; c < frames; c++) if (leno.has(c) !== leno.has(c + 1)) gaps.push(c);
  if (selCols > 0) gaps.push(frames);
  const cols = frames + selCols;
  // Blok aralığı ~ bir kare; 6–12 px arası en iri kare. Uzun armürde (yüzlerce atkı) kutu kayar, kare küçülür.
  const byWidth = Math.floor(maxWidth / (cols + gaps.length + 3));
  const byHeight = Math.floor(MINI_MAX_HEIGHT / rows);
  const cell = Math.max(6, Math.min(12, byWidth, byHeight));
  return { rows, frames, selCols, cols, gaps, cell };
}

/** Desen kartı detayına bağlantı: Armür sekmesi, iş emrinin ürünü seçili. */
export function weaveDesignHref(designId: string, itemId: string): string {
  return `/definitions/weave-designs/${encodeURIComponent(designId)}?tab=lift&fabric=${encodeURIComponent(itemId)}`;
}
