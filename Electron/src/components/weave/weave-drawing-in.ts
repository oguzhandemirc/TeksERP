// Tahar türü (K1, 2026-11-25) — backend `src/constants/weave-drawing-in.ts` aynası (parite: weave-drawdown.test).
// Düz/Sivri/Atlamalı kumaş görünümünde standart dizilimle çizilir; Özel ve boş tür düz tahar varsayar.
export const DRAWING_IN_TYPES = ["STRAIGHT", "POINTED", "SKIP", "CUSTOM"] as const;
export type DrawingInType = (typeof DRAWING_IN_TYPES)[number];

export const DRAWING_IN_LABEL: Record<DrawingInType, string> = { STRAIGHT: "Düz", POINTED: "Sivri", SKIP: "Atlamalı", CUSTOM: "Özel" };

/** Seçenek altı tek satır açıklama — tezgâh başındaki kişinin dilinde. */
export const DRAWING_IN_HINT: Record<DrawingInType, string> = {
  STRAIGHT: "Teller çerçevelere sırayla geçer: 1, 2, 3, 4…",
  POINTED: "Teller çerçevelere gidip döner: 1, 2, 3, 4, 3, 2… (balıksırtı, elmas).",
  SKIP: "Önce tek, sonra çift çerçeveler: 1, 3, 5, 7, 2, 4, 6, 8.",
  CUSTOM: "Standart dışı tahar; düzeni aşağıdaki nota yazın. Kumaş görünümü düz tahar varsayar.",
};

export const isDrawingInType = (v: unknown): v is DrawingInType => (DRAWING_IN_TYPES as readonly unknown[]).includes(v);

/** Bir tahar raporunun zemin sırası (0-tabanlı zemin indeksi) — backend `drawingInUnit` ikizi. */
export function drawingInUnit(groundCount: number, type: DrawingInType | null | undefined): number[] {
  const n = Math.max(0, Math.floor(groundCount));
  const straight = Array.from({ length: n }, (_, i) => i);
  if (n < 3) return straight;
  if (type === "POINTED") return [...straight, ...straight.slice(1, n - 1).reverse()];
  if (type === "SKIP") return [...straight.filter((i) => i % 2 === 0), ...straight.filter((i) => i % 2 === 1)];
  return straight;
}

/** Kumaş görünümü bu türü gerçekten çizer mi (Özel ve boş tür düz varsayılır). */
export const drawingInIsDrawn = (type: DrawingInType | null | undefined): boolean => type === "STRAIGHT" || type === "POINTED" || type === "SKIP";
