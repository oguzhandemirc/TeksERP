// =============================================================================
// FASON DOKUMA (G2p) — saf yardımcılar (bekçi doğrudan ölçer)
// =============================================================================
import type { FasonDispatch, FasonReceiptRow } from "./types";

export const EMPTY_ROW: FasonReceiptRow = { initialQty: "", width: "", weightKg: "", qualityGrade: "", colorId: null };

/** Sevkteki leventlerin giden/dönen metresi (iptal edilmemiş olaylar). */
export function dispatchMeters(d: FasonDispatch): { sentM: number; returnedM: number } {
  let sentM = 0;
  let returnedM = 0;
  for (const it of d.items) {
    for (const ev of it.events) {
      if (ev.kind === "SHIP_OUT") sentM += ev.lengthM ?? 0;
      if (ev.kind === "RETURNED_IN") returnedM += ev.lengthM ?? 0;
    }
  }
  return { sentM, returnedM };
}

export type RowValidation = { ok: true } | { ok: false; message: string };

/** Makbuz satırı: metre pozitif; en/kg boş ya da pozitif; kalite ≤ 16. */
export function validateReceiptRow(r: FasonReceiptRow): RowValidation {
  const m = Number(r.initialQty);
  if (r.initialQty.trim() === "" || !Number.isFinite(m) || m <= 0)
    return { ok: false, message: "Metre pozitif olmalı" };
  for (const [ad, v] of [
    ["En", r.width],
    ["Kg", r.weightKg],
  ] as const) {
    if (v.trim() === "") continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return { ok: false, message: `${ad} negatif olamaz` };
  }
  if (r.qualityGrade.trim().length > 16) return { ok: false, message: "Kalite en fazla 16 karakter" };
  return { ok: true };
}

/** Form satırı → uç gövdesi (boş = null; "0" ≠ "girilmedi"). */
export function rowToPayload(r: FasonReceiptRow): {
  initialQty: number;
  width: number | null;
  weightKg: number | null;
  qualityGrade: string | null;
  colorId: string | null;
} {
  const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));
  return { initialQty: Number(r.initialQty), width: num(r.width), weightKg: num(r.weightKg), qualityGrade: r.qualityGrade.trim() || null, colorId: r.colorId };
}

/** Fason bölümü yalnız fasonda dokunan işte çizilir. */
export function isFasonSectionVisible(o: { executionKind: string }): boolean {
  return o.executionKind === "SUBCONTRACTED";
}
