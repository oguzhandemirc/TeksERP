/**
 * Temel bloklar (T2): Metin · Kutu · Çizgi · Görsel. Veri alanı, kalem tablosu,
 * barkod gibi belgeye özgü bloklar T3'te gelir.
 */

const icon = (path: string): string =>
  `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

export const BLOCK_CATEGORY = "Temel";

export interface BlockDef {
  id: string;
  label: string;
  category: string;
  media: string;
  activate?: boolean;
  select?: boolean;
  content: string | Record<string, unknown>;
}

export const BASIC_BLOCKS: BlockDef[] = [
  {
    id: "text",
    label: "Metin",
    category: BLOCK_CATEGORY,
    media: icon('<path d="M4 7V5h16v2"/><path d="M12 5v14"/><path d="M9 19h6"/>'),
    activate: true,
    content: { type: "text", content: "Metin yazın", style: { padding: "1mm" } },
  },
  {
    id: "box",
    label: "Kutu",
    category: BLOCK_CATEGORY,
    media: icon('<rect x="4" y="5" width="16" height="14" rx="1"/>'),
    select: true,
    content: { tagName: "div", style: { padding: "3mm", border: "0.3mm solid #333333", "min-height": "12mm" } },
  },
  {
    id: "line",
    label: "Çizgi",
    category: BLOCK_CATEGORY,
    media: icon('<path d="M3 12h18"/>'),
    select: true,
    content: { tagName: "hr", void: true, style: { border: "0", "border-top": "0.3mm solid #333333", margin: "2mm 0" } },
  },
  {
    id: "image",
    label: "Görsel",
    category: BLOCK_CATEGORY,
    media: icon('<rect x="3" y="4" width="18" height="16" rx="1"/><circle cx="9" cy="10" r="1.6"/><path d="m21 17-5-5-9 8"/>'),
    activate: true,
    select: true,
    content: { type: "image", style: { "max-width": "40mm" } },
  },
];
