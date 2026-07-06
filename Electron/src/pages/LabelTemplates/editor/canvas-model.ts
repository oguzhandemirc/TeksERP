// =============================================================================
// Etiket Stüdyosu — kanvas editör model yardımcıları
// =============================================================================
// Tipler @/types/label-canvas'tan (backend ile birebir). Burada yalnız editörün
// ihtiyacı: mm↔px, eleman fabrikaları, YAKLAŞIK sınır kutusu (lint + kanvas
// çizimi — gerçek WYSIWYG backend önizlemesindedir), kimlik üretimi.

import type {
  CanvasFontSize,
  CanvasLayout,
  LabelElement,
  LabelElementType,
} from "@/types/label-canvas";
import { CANVAS_SCHEMA_VERSION } from "@/types/label-canvas";

export const GRID_SNAP_MM = 0.5;
export const MIN_ZOOM = 2;
export const MAX_ZOOM = 10;
export const DEFAULT_ZOOM = 5; // px / mm

/** Yaklaşık glif yüksekliği (mm) — EPL bitmap font @203dpi (dot/8). */
export const FONT_MM: Record<CanvasFontSize, { h: number; w: number }> = {
  sm: { h: 1.5, w: 1.0 },
  md: { h: 2.0, w: 1.25 },
  lg: { h: 2.5, w: 1.5 },
  xl: { h: 3.0, w: 1.75 },
};

export const snap = (mm: number): number => Math.round(mm / GRID_SNAP_MM) * GRID_SNAP_MM;
export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** Örnek barkod uzunluğu (TEKS+tarih ~19) — QR ayak izi kestirimi editör içindir. */
const SAMPLE_BC_LEN = 19;

function qrModules(len: number): number {
  if (len <= 16) return 21;
  if (len <= 30) return 25;
  if (len <= 50) return 29;
  return 33;
}

/** QR ayak izi (mm) — (modül + 2×4 sessiz) × scale dot / 8 dot-per-mm. */
export function qrSizeMm(scale: number | undefined): number {
  return ((qrModules(SAMPLE_BC_LEN) + 8) * (scale ?? 5)) / 8;
}

export interface BoundsMm {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Elemanın YAKLAŞIK kapladığı alan (mm) — lint (çakışma/taşma) + seçim kutusu.
 *  Metinde genişlik içerik-tahminidir; kesin doğruluk backend önizlemesinde. */
export function estimateBounds(el: LabelElement, canvas: { widthMm: number; heightMm: number }): BoundsMm {
  switch (el.type) {
    case "field":
    case "text": {
      const font = FONT_MM[el.font ?? "md"];
      const mul = el.bold ? 2 : 1;
      const sample = el.type === "text" ? el.text : `${el.label ? `${el.label}: ` : ""}Örnek Değer`;
      const w = Math.max(8, sample.length * font.w * mul * 0.9);
      const h = font.h * mul;
      const rot = el.rot ?? 0;
      return rot === 90 || rot === 270
        ? { x: el.x, y: el.y, w: h, h: w }
        : { x: el.x, y: el.y, w, h };
    }
    case "qr": {
      const s = qrSizeMm(el.scale);
      return { x: el.x, y: el.y, w: s, h: s };
    }
    case "code128": {
      const h = (el.hMm ?? 9) + (el.human !== false ? 3.5 : 0);
      return { x: el.x, y: el.y, w: Math.min(60, canvas.widthMm - el.x - 2), h };
    }
    case "line":
      return { x: el.x, y: el.y, w: el.wMm, h: el.hMm };
    case "box":
      return { x: el.x, y: el.y, w: el.wMm, h: el.hMm };
    case "lengthBanner":
      return {
        x: el.x,
        y: el.y,
        w: el.wMm ?? 10,
        h: el.hMm ?? Math.max(10, canvas.heightMm - 2 * el.y),
      };
  }
}

let seq = 0;
export function newElementId(type: LabelElementType): string {
  seq += 1;
  return `${type}-${Date.now().toString(36)}${seq}`;
}

/** Palet fabrikası — tuvale tıklama noktasına makul varsayılanlarla eleman doğurur. */
export function makeElement(
  type: LabelElementType,
  at: { x: number; y: number },
  opts?: { bind?: string; label?: string },
): LabelElement {
  const id = newElementId(type);
  const base = { id, x: snap(at.x), y: snap(at.y) };
  switch (type) {
    case "field":
      return { ...base, type, bind: opts?.bind ?? "itemName", label: opts?.label ?? "", font: "md" };
    case "text":
      return { ...base, type, text: "Metin", font: "md" };
    case "qr":
      return { ...base, type, scale: 5 };
    case "code128":
      return { ...base, type, hMm: 9, human: true };
    case "line":
      return { ...base, type, wMm: 40, hMm: 0.8 };
    case "box":
      return { ...base, type, wMm: 30, hMm: 15, thickMm: 0.5 };
    case "lengthBanner":
      return { ...base, type, wMm: 9, hMm: 40 };
  }
}

/** Yeni (varyantsız) şablon için başlangıç iskeleti — sol-üst QR + ürün + metraj
 *  + alt barkod. Kullanıcı üstünden düzenler. */
export function starterLayout(canvas: { widthMm: number; heightMm: number }): CanvasLayout {
  const bcY = Math.max(10, canvas.heightMm - 15);
  return {
    v: CANVAS_SCHEMA_VERSION,
    elements: [
      { id: newElementId("qr"), type: "qr", x: 3, y: 3, scale: 5 },
      { id: newElementId("field"), type: "field", bind: "itemName", label: "", x: 26, y: 3, font: "lg", bold: true },
      { id: newElementId("field"), type: "field", bind: "lengthMeters", label: "Metraj", x: 26, y: 8, font: "md" },
      { id: newElementId("field"), type: "field", bind: "qualityGrade", label: "Kalite", x: 26, y: 12.5, font: "md" },
      { id: newElementId("code128"), type: "code128", x: 3, y: bcY, hMm: 9, human: true },
    ],
  };
}
