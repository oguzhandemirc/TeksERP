// Tahar planı (T1) — sunucu `DRAWING_IN_PLAN_SELECT` biçimi. Dizi 1-tabanlı çerçeve no'dur (tel sırasıyla).
export interface DrawingInPlan {
  id: string;
  code: string;
  name: string;
  frameCount: number;
  threading: number[];
  notation: string;
  threadingKey: string;
  selvedgeThreading: number[];
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { fabricItems: number };
}

/** Yazım gövdesi — sunucu `notation` (kısaltmalı yazım) ya da `threading`ten biriyle diziyi kurar. */
export interface DrawingInPlanInput {
  name: string;
  frameCount: number;
  notation: string;
  /** Kısaltmalı yazım ya da boş (kenar taharı yok). */
  selvedgeThreading: string;
  notes: string | null;
}
