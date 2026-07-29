// =============================================================================
// Etiket Stüdyosu — çoklu seçim: hizalama + boşluk eşitleme
// =============================================================================
// canvas-model'den ayrık dosya (300 satır sınırı). Saf fonksiyonlar — tek undo
// adımı olarak applyPatches ile uygulanır. Sınır kutuları estimateBounds
// tahminiyle (kesinlik değil erken uyarı hedeflenir).

import type { LabelElement } from "@/types/label-canvas";
import { estimateBounds, snap, clamp, FONT_MM, type BoundsMm } from "./canvas-model";

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

/** Tek elemanı tuvale ortala (X veya Y). estimateBounds ile bounds merkezi tuval
 *  merkezine oturur (hizalama kaymasını da hesaba katar). */
export function centerOnCanvas(
  el: LabelElement,
  axis: "x" | "y",
  canvas: { widthMm: number; heightMm: number },
): Partial<LabelElement> {
  const b = estimateBounds(el, canvas);
  if (axis === "x") {
    const targetBx = (canvas.widthMm - b.w) / 2;
    return { x: Math.max(0, snap(el.x + (targetBx - b.x))) } as Partial<LabelElement>;
  }
  const targetBy = (canvas.heightMm - b.h) / 2;
  return { y: Math.max(0, snap(el.y + (targetBy - b.y))) } as Partial<LabelElement>;
}

// =============================================================================
// Birlikte ölçekleme (büyüt/küçült) — seçimi ortak sınır-kutusu MERKEZİ etrafında
// factor ile ölçekler. Konum: newX = cx + (x−cx)·factor (boyut factor ile büyürken
// merkezler orantılı kayar → grup şekli/aralıkları korunur). Boyut TİPE ÖZEL.
// =============================================================================

/** Tipe özel boyut ölçekleme yaması (konum HARİÇ). Metin→hMm, QR→scale, barkod→bar
 *  yüksekliği, çizgi/kutu/bant→wMm+hMm, ikon→hMm. Kademeli/varsayılan boyutlar önce
 *  fiili mm'e çözülür (resize tutamacıyla aynı mantık). */
function scaleSizePatch(el: LabelElement, f: number): Partial<LabelElement> {
  const cl = (v: number, lo: number, hi: number) => clamp(snap(v), lo, hi); // 0.5 snap + clamp
  switch (el.type) {
    case "field":
    case "text": {
      const cur = el.hMm ?? FONT_MM[el.font ?? "md"].h * (el.bold ? 2 : 1);
      return { hMm: cl(cur * f, 1, 30) };
    }
    case "qr":
      return { scale: clamp(Math.round((el.scale ?? 5) * f), 2, 15) };
    case "code128":
      return { hMm: cl((el.hMm ?? 9) * f, 3, 40) };
    case "line":
      return { wMm: Math.max(0.5, snap(el.wMm * f)), hMm: Math.max(0.5, snap(el.hMm * f)) };
    case "box":
      return { wMm: Math.max(2, snap(el.wMm * f)), hMm: Math.max(2, snap(el.hMm * f)) };
    case "lengthBanner": {
      const p: Partial<LabelElement> = {
        wMm: Math.max(3, snap((el.wMm ?? 9) * f)),
        hMm: Math.max(10, snap((el.hMm ?? 40) * f)),
      };
      if (el.glyphHMm != null) (p as { glyphHMm?: number }).glyphHMm = cl(el.glyphHMm * f, 1, 30);
      return p;
    }
    case "icon":
      return { hMm: cl((el.hMm ?? 8) * f, 3, 50) };
  }
}

/** Seçili elemanları ortak sınır-kutusu merkezi etrafında `factor` ile ölçekle
 *  (≥1 eleman). Konum + tipe özel boyut yaması → tek undo adımı (applyPatches). */
export function scaleElements(
  elements: LabelElement[],
  ids: string[],
  factor: number,
  canvas: { widthMm: number; heightMm: number },
): Record<string, Partial<LabelElement>> {
  const sel = selectedBounds(elements, ids, canvas);
  if (sel.length < 1 || !Number.isFinite(factor) || factor <= 0) return {};
  const minX = Math.min(...sel.map((s) => s.b.x));
  const maxR = Math.max(...sel.map((s) => s.b.x + s.b.w));
  const minY = Math.min(...sel.map((s) => s.b.y));
  const maxB = Math.max(...sel.map((s) => s.b.y + s.b.h));
  const cx = (minX + maxR) / 2;
  const cy = (minY + maxB) / 2;

  const patches: Record<string, Partial<LabelElement>> = {};
  for (const { el } of sel) {
    const patch = { ...scaleSizePatch(el, factor) } as Record<string, number>;
    const nx = Math.max(0, snap(cx + (el.x - cx) * factor));
    const ny = Math.max(0, snap(cy + (el.y - cy) * factor));
    if (nx !== el.x) patch.x = nx;
    if (ny !== el.y) patch.y = ny;
    if (Object.keys(patch).length > 0) patches[el.id] = patch as Partial<LabelElement>;
  }
  return patches;
}
