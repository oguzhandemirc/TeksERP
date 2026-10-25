import type { Editor } from "grapesjs";
import {
  barcodeHtml,
  DOCUMENT_BLOCK_CSS,
  itemTableBlockHtml,
  logoHtml,
  pageBreakHtml,
  qrHtml,
  signatureHtml,
  totalBoxHtml,
  dataFieldHtml,
} from "../binding/blockHtml";
import type { ContractView } from "../binding/contract";
import type { BlockDef } from "./blocks";
import { PAGE_REGION_ATTR } from "./documentComponents";

const icon = (path: string): string =>
  `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

export const DATA_CATEGORY = "Veri";
export const PAGE_CATEGORY = "Sayfa";

export interface BlockContext {
  contract: ContractView | null;
  settings: Readonly<Record<string, unknown>>;
  internalFields: readonly string[];
}

/** Blok içeriğine sınıf CSS'i eklenir: GrapesJS `<style>`u CSS kurallarına çevirir. */
const withCss = (html: string): string => `${html}<style>${DOCUMENT_BLOCK_CSS}</style>`;
const region = (kind: string, label: string): Record<string, unknown> => ({ tagName: "div", attributes: { [PAGE_REGION_ATTR]: kind }, content: label });

/** Belgeye özgü bloklar (plan §4); içerik sözleşmeden üretilir, tür değişince yeniden kurulur. */
export function documentBlocks(ctx: BlockContext): BlockDef[] {
  const c = ctx.contract;
  const first = c?.kokler.find((f) => f.yol === "belge.no") ?? c?.kokler[0];
  const d = (id: string, label: string, media: string, content: BlockDef["content"]): BlockDef => ({
    id, label, category: DATA_CATEGORY, media: icon(media), select: true, content,
  });
  const pg = (b: BlockDef): BlockDef => ({ ...b, category: PAGE_CATEGORY });
  return [
    d("data-field", "Veri alanı", '<path d="M4 6h16v12H4z"/><path d="M8 10h8M8 14h5"/>', dataFieldHtml(first?.yol ?? "belge.no", first)),
    d("item-table", "Kalem tablosu", '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M3 14h18M9 4v16"/>', withCss(itemTableBlockHtml(c, ctx.internalFields))),
    d("total-box", "Toplam kutusu", '<path d="M17 5H7l5 7-5 7h10"/>', withCss(totalBoxHtml(c))),
    d("logo", "Logo", '<circle cx="12" cy="12" r="8"/><path d="M8 14l3-4 2 3 3-4"/>', withCss(logoHtml())),
    d("barcode", "Barkod", '<path d="M4 5v14M7 5v14M10 5v14M14 5v14M16 5v14M20 5v14"/>', withCss(barcodeHtml())),
    d("qr", "QR", '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 18h2v2h-2z"/>', withCss(qrHtml())),
    d("signature", "İmza alanı", '<path d="M3 17c3-6 5-6 6 0s3 0 4-2 3 2 8 2"/><path d="M3 21h18"/>', withCss(signatureHtml(ctx.settings))),
    pg(d("page-header", "Üst bilgi", '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 8h18"/>', region("ust", "Üst bilgi"))),
    pg(d("page-footer", "Alt bilgi", '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 16h18"/>', region("alt", "Alt bilgi"))),
    pg(d("page-number", "Sayfa no", '<path d="M7 4h10v16H7z"/><path d="M11 9h2v6"/>', region("sayfa-no", "Sayfa no"))),
    pg(d("page-break", "Sayfa kesmesi", '<path d="M4 12h3M10 12h4M17 12h3"/><path d="M6 4v5h12V4M6 20v-5h12v5"/>', withCss(pageBreakHtml()))),
  ];
}

/** Blokları ekle ya da içeriğini tazele (aynı kimlik Backbone'da birleştirilmez, elle güncellenir). */
export function registerDocumentBlocks(editor: Editor, ctx: BlockContext): void {
  for (const b of documentBlocks(ctx)) {
    const existing = editor.Blocks.get(b.id);
    if (existing) existing.set({ content: b.content } as never);
    else editor.Blocks.add(b.id, b as never);
  }
}
