// Toplu çuval etiketi (saf): basılacak çuvallar, ilerleme metni ve BT yazıcı yokken tek pencerelik HTML birleşimi.
import type { HandheldLoadState } from '../../../../services/handheldShipment.service';

export interface LabelTarget {
  sackId: string;
  label: string;
}

/** Dolu çuvallar, çuval sırasıyla (boş çuval sevkte düşer, etiketi basılmaz). */
export function labelTargets(state: HandheldLoadState | undefined): LabelTarget[] {
  if (!state) return [];
  return state.sacks
    .filter((s) => s.rolls.length > 0)
    .slice()
    .sort((a, b) => (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER))
    .map((s) => ({ sackId: s.id, label: s.sackNo }));
}

/** Düğme etiketi: boşta "Çuval etiketleri", basarken "Etiket 3/5", hatadan sonra "Kalanları bas (2)". */
export function labelButtonText(p: { running: boolean; done: number; total: number; failed: number }): string {
  if (p.running) return `Etiket ${p.done}/${p.total}`;
  if (p.failed > 0) return `Kalanları bas (${p.failed})`;
  return 'Çuval etiketleri';
}

const HEAD_RE = /<head[^>]*>([\s\S]*?)<\/head>/i;
const BODY_RE = /<body[^>]*>([\s\S]*?)<\/body>/i;

/** Aynı şablondan gelen etiket sayfalarını tek belgede birleştirir (sayfa sonu araya); başlık ilk belgeden. */
export function mergeLabelHtml(htmls: string[]): string {
  if (htmls.length === 0) return '';
  if (htmls.length === 1) return htmls[0]!;
  const head = HEAD_RE.exec(htmls[0]!)?.[1] ?? '';
  const pages = htmls.map((h, i) => {
    const body = BODY_RE.exec(h)?.[1] ?? h;
    const brk = i < htmls.length - 1 ? ' style="page-break-after:always;break-after:page"' : '';
    return `<div${brk}>${body}</div>`;
  });
  return `<!DOCTYPE html><html><head>${head}</head><body>${pages.join('')}</body></html>`;
}
