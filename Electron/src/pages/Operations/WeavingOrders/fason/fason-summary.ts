// =============================================================================
// FASON DOKUMA (G2p) — saf yardımcılar (bekçi doğrudan ölçer)
// =============================================================================
import type { FasonDispatch, FasonReceiptRow, FasonYarnItem, FasonYarnReturnRow, YarnKgSource } from "./types";
import type { FasonYarnLine } from "./service";

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

/** G1: iplik satırı taslağı (form) → uç gövdesi; geçersiz satır `null` (kg pozitif sayı, kalem+depo dolu). */
export interface YarnLineDraft {
  itemId: string | null;
  warehouseId: string;
  lotId: string;
  qtyKg: string;
}
export function yarnLineToPayload(l: YarnLineDraft): FasonYarnLine | null {
  const kg = Number(l.qtyKg);
  if (!l.itemId || !l.warehouseId || l.qtyKg.trim() === "" || !Number.isFinite(kg) || kg <= 0) return null;
  return { itemId: l.itemId, warehouseId: l.warehouseId, lotId: l.lotId || null, qtyKg: kg };
}

/** Sevkte fasonda hâlâ ipliği kalan kalemler (dönüş adayı). */
export function openYarnItems(d: FasonDispatch): FasonYarnItem[] {
  return (d.yarnItems ?? []).filter((it) => it.remainingKg > 0);
}

/**
 * Storno edilebilir dönüş satırları — backend KARŞI OLAY kalıbı: aynı depo·lot·sebep grubunda
 * Σdönüş − Σstorno ≥ satırın kg'sı ise satır hâlâ açık (ikinci storno 409 YARN_RETURN_NOT_OPEN).
 */
export function openYarnReturns(item: Pick<FasonYarnItem, "returns">): FasonYarnReturnRow[] {
  const key = (r: FasonYarnReturnRow) => `${r.warehouseId}|${r.lotId ?? ""}|${r.reasonCode ?? ""}`;
  const net = new Map<string, number>();
  for (const r of item.returns) {
    const delta = r.kind === "SUBCONTRACT_RETURN" ? r.qtyKg : r.kind === "SUBCONTRACT_RETURN_CANCEL" ? -r.qtyKg : 0;
    net.set(key(r), (net.get(key(r)) ?? 0) + delta);
  }
  return item.returns.filter((r) => r.kind === "SUBCONTRACT_RETURN" && (net.get(key(r)) ?? 0) >= r.qtyKg);
}

/** Sarım kaynağı beyanı etiketi — "ölçüldü mü hesaplandı mı" raporda görünür, gizlenmez. */
export function kgSourceLabel(k: YarnKgSource | "KARMA" | null): string {
  if (k === "THEORETICAL") return "nominal (hesap)";
  if (k === "WEIGHED") return "tartıldı";
  if (k === "KARMA") return "karma (hesap + tartı)";
  return "—";
}

/** Fason bölümü yalnız fasonda dokunan işte çizilir. */
export function isFasonSectionVisible(o: { executionKind: string }): boolean {
  return o.executionKind === "SUBCONTRACTED";
}
