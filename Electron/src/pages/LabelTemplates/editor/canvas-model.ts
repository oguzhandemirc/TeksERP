// =============================================================================
// Etiket Stüdyosu — kanvas editör model yardımcıları
// =============================================================================
// Tipler @/types/label-canvas'tan (backend ile birebir). Burada yalnız editörün
// ihtiyacı: mm↔px, eleman fabrikaları, YAKLAŞIK sınır kutusu (lint + kanvas
// çizimi — gerçek WYSIWYG backend önizlemesindedir), kimlik üretimi.

import type {
  CanvasFontSize,
  CanvasLayout,
  CanvasRotation,
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

/**
 * Köşe tutamacıyla boyutlandırma — hedef kutu (mm) elemanın tipine çevrilir.
 * Her tip "boyut"u farklı taşır: line/box/banner gerçek w/h; code128 yalnız bar
 * yüksekliği; QR ayrık ölçek (2-15); metin 4 kademeli font (native bitmap font
 * gerçeği — serbest punto YOK, en yakın kademeye oturur).
 */
export function applyResize(
  el: LabelElement,
  targetWmm: number,
  targetHmm: number,
): Partial<LabelElement> | null {
  const w = Math.max(0.5, snap(targetWmm));
  const h = Math.max(0.5, snap(targetHmm));
  switch (el.type) {
    case "line":
      return { wMm: w, hMm: h };
    case "box":
      return { wMm: Math.max(2, w), hMm: Math.max(2, h) };
    case "lengthBanner":
      return { wMm: Math.max(3, w), hMm: Math.max(10, h) };
    case "code128": {
      // Sürüklenen kutu okunur satırı da içerir — bar yüksekliğine geri çevir.
      const human = el.human !== false ? 3.5 : 0;
      return { hMm: clamp(snap(h - human), 3, 40) };
    }
    case "qr": {
      // Ayak izi = (modül+8)×scale/8 mm → hedef kenardan ölçek çöz (2-15 ayrık).
      const side = Math.max(w, h);
      const scale = clamp(Math.round((side * 8) / (qrModules(SAMPLE_BC_LEN) + 8)), 2, 15);
      return { scale };
    }
    case "field":
    case "text": {
      // Native bitmap font: yalnız 4 kademe (+bold=2x). Hedef yüksekliğe en yakın
      // kademe seçilir — serbest punto basılamaz, dürüst davranış budur.
      const mul = el.bold ? 2 : 1;
      let best: CanvasFontSize = "sm";
      let bestDiff = Number.POSITIVE_INFINITY;
      for (const f of Object.keys(FONT_MM) as CanvasFontSize[]) {
        const diff = Math.abs(FONT_MM[f].h * mul - h);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = f;
        }
      }
      return best === (el.font ?? "md") ? null : { font: best };
    }
  }
}

/** Döndürme tutamacı açısı → 90° adımlı rotasyon (yazıcı dillerinin sınırı:
 *  PPLA/PPLB bitmap font + ZPL ^A0 yalnız N/R/I/B — serbest açı basılamaz). */
export function snapRotation(deg: number): CanvasRotation {
  const norm = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  return norm as CanvasRotation;
}

// =============================================================================
// Çoklu seçim: hizalama + boşluk eşitleme (saf fonksiyonlar — tek undo adımı
// olarak applyPatches ile uygulanır). Sınır kutuları estimateBounds tahminiyle.
// =============================================================================

export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
export type DistributeMode = "h" | "v";

type PatchMap = Record<string, { x?: number; y?: number }>;

function selectedBounds(
  elements: LabelElement[],
  ids: string[],
  canvas: { widthMm: number; heightMm: number },
): Array<{ el: LabelElement; b: BoundsMm }> {
  const set = new Set(ids);
  return elements.filter((e) => set.has(e.id)).map((el) => ({ el, b: estimateBounds(el, canvas) }));
}

/** Seçimi kendi ortak sınır kutusuna göre hizalar (≥2 eleman). */
export function alignElements(
  elements: LabelElement[],
  ids: string[],
  mode: AlignMode,
  canvas: { widthMm: number; heightMm: number },
): PatchMap {
  const sel = selectedBounds(elements, ids, canvas);
  if (sel.length < 2) return {};
  const minX = Math.min(...sel.map((s) => s.b.x));
  const maxR = Math.max(...sel.map((s) => s.b.x + s.b.w));
  const minY = Math.min(...sel.map((s) => s.b.y));
  const maxB = Math.max(...sel.map((s) => s.b.y + s.b.h));
  const cx = (minX + maxR) / 2;
  const cy = (minY + maxB) / 2;

  const patches: PatchMap = {};
  for (const { el, b } of sel) {
    let x: number | undefined;
    let y: number | undefined;
    switch (mode) {
      case "left":    x = minX; break;
      case "hcenter": x = cx - b.w / 2; break;
      case "right":   x = maxR - b.w; break;
      case "top":     y = minY; break;
      case "vcenter": y = cy - b.h / 2; break;
      case "bottom":  y = maxB - b.h; break;
    }
    const patch: { x?: number; y?: number } = {};
    if (x !== undefined && snap(x) !== el.x) patch.x = Math.max(0, snap(x));
    if (y !== undefined && snap(y) !== el.y) patch.y = Math.max(0, snap(y));
    if (patch.x !== undefined || patch.y !== undefined) patches[el.id] = patch;
  }
  return patches;
}

/** Aradaki boşlukları eşitler (≥3 eleman): ilk ve son sabit kalır, aradakiler
 *  eşit aralıkla dizilir (negatif boşluk = bilinçli bindirme, korunur). */
export function distributeElements(
  elements: LabelElement[],
  ids: string[],
  mode: DistributeMode,
  canvas: { widthMm: number; heightMm: number },
): PatchMap {
  const sel = selectedBounds(elements, ids, canvas);
  if (sel.length < 3) return {};
  const pos = (b: BoundsMm) => (mode === "h" ? b.x : b.y);
  const size = (b: BoundsMm) => (mode === "h" ? b.w : b.h);
  const sorted = [...sel].sort((a, z) => pos(a.b) - pos(z.b));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const span = pos(last.b) + size(last.b) - pos(first.b);
  const total = sorted.reduce((acc, s) => acc + size(s.b), 0);
  const gap = (span - total) / (sorted.length - 1);

  const patches: PatchMap = {};
  let cursor = pos(first.b);
  for (const { el, b } of sorted) {
    const target = snap(cursor);
    if (mode === "h") {
      if (target !== el.x) patches[el.id] = { x: Math.max(0, target) };
    } else if (target !== el.y) {
      patches[el.id] = { y: Math.max(0, target) };
    }
    cursor += size(b) + gap;
  }
  // İlk/son eleman konumu değişmemeli (sabit uçlar) — snap sapması olursa çıkar.
  delete patches[first.el.id];
  delete patches[last.el.id];
  return patches;
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
