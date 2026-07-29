// =============================================================================
// TeksERP - Etiket İkon Kayıt Defteri (bakım sembolleri — tek kaynak)
// =============================================================================
// Kanvas "icon" elemanının sembol kataloğu: kayıt sorgulama + SVG üretimi.
// Sembol çizim verisi label-icons.data.ts'te (IconPrimitive DSL); ZPL/raster
// baskı yolu AYNI primitifleri raster-icon.ts ile 1bpp'e döker — editör
// önizlemesi (SVG) ile baskı birebir aynı geometriyi görür.
//
// SVG sözleşmesi: viewBox 0 0 100 100, stroke="currentColor" fill="none",
// varsayılan stroke-width 6, uçlar/köşeler yuvarlak. Dolu primitifler
// fill="currentColor" stroke="none" ile basılır.
// =============================================================================

import { LABEL_ICONS_DATA, type IconPrimitive, type LabelIconDef } from "./label-icons.data";

export type { IconPrimitive, LabelIconDef };

/** Varsayılan kontur kalınlığı (0-100 birim uzayında) — w verilmeyen primitifler. */
export const ICON_DEFAULT_STROKE = 6;

export const LABEL_ICON_CATEGORIES: { key: string; label: string }[] = [
  { key: "yikama", label: "Yıkama" },
  { key: "agartma", label: "Ağartma" },
  { key: "kurutma", label: "Kurutma" },
  { key: "utu", label: "Ütü" },
  { key: "kuru-temizleme", label: "Kuru Temizleme" },
];

export const LABEL_ICONS: LabelIconDef[] = LABEL_ICONS_DATA;

const byKey = new Map<string, LabelIconDef>(LABEL_ICONS.map((d) => [d.key, d]));

export function getLabelIcon(key: string): LabelIconDef | undefined {
  return byKey.get(key);
}

export function labelIconKeys(): string[] {
  return LABEL_ICONS.map((d) => d.key);
}

// -----------------------------------------------------------------------------
// SVG üretimi (editör önizleme / HTML raster kaynağı)
// -----------------------------------------------------------------------------

/** Sayıyı kısa biçimle yaz (en çok 2 ondalık; 34.40 → "34.4"). */
function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** w varsayılandan farklıysa stroke-width niteliği üret (kök 6'yı miras bırakır). */
function sw(w: number | undefined): string {
  return w != null && w !== ICON_DEFAULT_STROKE ? ` stroke-width="${fmt(w)}"` : "";
}

function ptsAttr(pts: [number, number][]): string {
  return pts.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(" ");
}

/** Yay ucu — a derece (0°=saat 3, saat-yönü-tersi pozitif, y aşağı ekran uzayı). */
function arcPoint(cx: number, cy: number, r: number, a: number): { x: number; y: number } {
  const rad = (a * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

function primToSvg(p: IconPrimitive): string {
  switch (p.t) {
    case "line":
      return `<line x1="${fmt(p.x1)}" y1="${fmt(p.y1)}" x2="${fmt(p.x2)}" y2="${fmt(p.y2)}"${sw(p.w)}/>`;
    case "pline":
      return p.closed
        ? `<polygon fill="none" points="${ptsAttr(p.pts)}"${sw(p.w)}/>`
        : `<polyline points="${ptsAttr(p.pts)}"${sw(p.w)}/>`;
    case "poly":
      return `<polygon fill="currentColor" stroke="none" fill-rule="evenodd" points="${ptsAttr(p.pts)}"/>`;
    case "circle":
      return p.fill
        ? `<circle cx="${fmt(p.cx)}" cy="${fmt(p.cy)}" r="${fmt(p.r)}" fill="currentColor" stroke="none"/>`
        : `<circle cx="${fmt(p.cx)}" cy="${fmt(p.cy)}" r="${fmt(p.r)}"${sw(p.w)}/>`;
    case "arc": {
      const s = arcPoint(p.cx, p.cy, p.r, p.a1);
      const e = arcPoint(p.cx, p.cy, p.r, p.a2);
      const large = Math.abs(p.a2 - p.a1) > 180 ? 1 : 0;
      // Açı artışı = ekranda saat-yönü-tersi → SVG sweep=0; azalış → sweep=1.
      const sweep = p.a2 > p.a1 ? 0 : 1;
      return `<path d="M ${fmt(s.x)} ${fmt(s.y)} A ${fmt(p.r)} ${fmt(p.r)} 0 ${large} ${sweep} ${fmt(e.x)} ${fmt(e.y)}"${sw(p.w)}/>`;
    }
    case "text":
      // font-size ≈ h/capRatio — büyük-harf yüksekliği h'i hedefler (raster ile uyum).
      return (
        `<text x="${fmt(p.x)}" y="${fmt(p.y)}" text-anchor="middle" dominant-baseline="central"` +
        ` font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" fill="currentColor"` +
        ` stroke="none" font-size="${fmt(p.h * 1.35)}">${escapeXml(p.s)}</text>`
      );
  }
}

/** İkonun bağımsız SVG dizgesi — bilinmeyen anahtar → null (çağıran atlar). */
export function labelIconSvg(key: string): string | null {
  const def = byKey.get(key);
  if (!def) return null;
  const body = def.prims.map(primToSvg).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none"` +
    ` stroke="currentColor" stroke-width="${ICON_DEFAULT_STROKE}" stroke-linecap="round"` +
    ` stroke-linejoin="round">${body}</svg>`
  );
}
