// =============================================================================
// TAHAR TÜRÜ — TEK KAYNAK (Seyitoğlu K1, 2026-11-25)
// =============================================================================
// Tahar = çözgü telinin hangi çerçeveden geçtiği. Tür listeden seçilir (Düz · Sivri · Atlamalı · Özel);
// `drawingInNote` kısa not olarak kalır. Yalnız çerçeveli mekanizmada (Eksantrik/Armür) anlamlıdır.
// Standart dizilim (`drawingInUnit`) kumaş görünümünde kullanılır; Özel ve boş tür düz tahar varsayar.
// Panel aynası `Electron/src/components/weave/weave-drawing-in.ts` (parite: aynı örnek tablo).
// =============================================================================
import type { WeaveShedMechanismValue } from "./weave-classification";

export const WEAVE_DRAWING_IN_TYPES = ["STRAIGHT", "POINTED", "SKIP", "CUSTOM"] as const;
export type WeaveDrawingInTypeValue = (typeof WEAVE_DRAWING_IN_TYPES)[number];

export const WEAVE_DRAWING_IN_LABEL: Readonly<Record<WeaveDrawingInTypeValue, string>> = {
  STRAIGHT: "Düz", POINTED: "Sivri", SKIP: "Atlamalı", CUSTOM: "Özel",
};

/** Tahar türü yalnız çerçeveli mekanizmada (Eksantrik, Armür) yazılır; Jakar'da çerçeve yoktur. */
export function mechanismUsesFrames(m: WeaveShedMechanismValue): boolean {
  return m === "CAM" || m === "DOBBY";
}

/**
 * Bir tahar raporunun zemin sırası (0-tabanlı zemin indeksi). Düz: 0..n-1 · Sivri: 0..n-1..1 (dönüşte uçlar
 * tekrar etmez) · Atlamalı: tekler sonra çiftler (1,3,5…,2,4,6…). Özel / boş → düz (planı bilinmez).
 */
export function drawingInUnit(groundCount: number, type: WeaveDrawingInTypeValue | null | undefined): number[] {
  const n = Math.max(0, Math.floor(groundCount));
  const straight = Array.from({ length: n }, (_, i) => i);
  if (n < 3) return straight;
  if (type === "POINTED") return [...straight, ...straight.slice(1, n - 1).reverse()];
  if (type === "SKIP") return [...straight.filter((i) => i % 2 === 0), ...straight.filter((i) => i % 2 === 1)];
  return straight;
}

/** Kumaş görünümü bu türü gerçekten çizer mi (Özel ve boş tür düz varsayılır). */
export function drawingInIsDrawn(type: WeaveDrawingInTypeValue | null | undefined): boolean {
  return type === "STRAIGHT" || type === "POINTED" || type === "SKIP";
}
