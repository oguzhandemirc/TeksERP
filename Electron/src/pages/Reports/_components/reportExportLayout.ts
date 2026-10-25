// Özel rapor düzeninin baskısı (R2-DUZEN): bloklar 12 sütunluk akışta yan yana, sayfa kesmesi yeni
// sayfa + yeni satır. Yalnız bloklardan biri yerleşim taşıdığında devreye girer — eski çıktı bayt bayt aynı.
import type { ExportBlok } from "./reportExport";

export const hasPlacement = (blocks: readonly ExportBlok[]): boolean => blocks.some((b) => b.genislik !== undefined || b.sayfaKesmesi !== undefined);

export function placedBodyHtml(blocks: readonly ExportBlok[], render: (b: ExportBlok) => string): string {
  const cells = blocks.map((b) => {
    const w = Math.min(12, Math.max(1, b.genislik ?? 12));
    return `<div class="blk${b.sayfaKesmesi ? " kesme" : ""}" style="width:${((w / 12) * 100).toFixed(4)}%">${render(b)}</div>`;
  });
  return `<div class="duzen">${cells.join("\n")}</div>`;
}

export const LAYOUT_CSS = `
  .duzen { display: flex; flex-wrap: wrap; margin: 0 -5px; }
  .blk { padding: 0 5px; min-width: 0; }
  .blk.kesme { break-before: page; }
  .blk .grafik svg { max-width: 100%; }
  .metin p { margin: 0; white-space: pre-wrap; }`;
