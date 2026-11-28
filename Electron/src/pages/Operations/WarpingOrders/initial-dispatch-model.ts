// "Yeni sipariş" penceresinde ilk iplik sevki taslağı (D2) — saf: plan ipliği başına bir satır (depo · lot · kg · koli · bobin).
// Hepsi boşsa gövdeye `initialDispatch` HİÇ girmez (bugünkü sevksiz sipariş, bayt-aynı gövde). Karar sunucuda
// (plan dışı 400, lot kuralı, eksi bakiye); burada yalnız eksik alan önceden söylenir.
import { parsePieceCount, pieceCountFields, type PickedRef } from "./dispatch-model";
import { parseNum } from "./order-model";
import type { WarpingDispatchBody } from "./yarn-types";

export interface InitialLineDraft {
  warehouse: PickedRef | null;
  lot: PickedRef | null;
  qtyKg: string;
  packageCount: string;
  bobbinCount: string;
}
/** iplik kalemi id → satır taslağı. */
export type InitialDrafts = Record<string, InitialLineDraft>;

export const emptyInitialLine = (): InitialLineDraft => ({ warehouse: null, lot: null, qtyKg: "", packageCount: "", bobbinCount: "" });

const touched = (d: InitialLineDraft) => !!d.warehouse || !!d.lot || d.qtyKg.trim() !== "" || d.packageCount.trim() !== "" || d.bobbinCount.trim() !== "";

export type InitialDispatchResult = { ok: true; value: { lines: WarpingDispatchBody["lines"] } | undefined } | { ok: false; error: string };

/** Yalnız plandaki iplikler okunur (kart değişince eski satırlar sessizce düşer). Dokunulmuş satır kg + depo ister. */
export function buildInitialDispatch(drafts: InitialDrafts, yarns: ReadonlyArray<{ yarnItemId: string; code: string }>): InitialDispatchResult {
  const lines: WarpingDispatchBody["lines"] = [];
  for (const y of yarns) {
    const d = drafts[y.yarnItemId];
    if (!d || !touched(d)) continue;
    const kg = parseNum(d.qtyKg);
    if (kg === null || kg <= 0) return { ok: false, error: `İlk sevk — ${y.code}: sevk kg girin ya da satırı boşaltın.` };
    if (!d.warehouse) return { ok: false, error: `İlk sevk — ${y.code}: depo seçin.` };
    if (!parsePieceCount(d.packageCount).ok || !parsePieceCount(d.bobbinCount).ok) return { ok: false, error: `İlk sevk — ${y.code}: koli ve bobin adedi boş ya da sıfırdan büyük tam sayı olmalı.` };
    lines.push({ yarnItemId: y.yarnItemId, warehouseId: d.warehouse.id, lotId: d.lot?.id ?? null, qtyKg: kg, ...pieceCountFields(d.packageCount, d.bobbinCount) });
  }
  return { ok: true, value: lines.length > 0 ? { lines } : undefined };
}

/** "Plan kadar" kısa yolu: boş kg hücrelerine plan brüt kg'ı yazar (dolu hücreye dokunmaz). */
export function fillPlanKg(drafts: InitialDrafts, yarns: ReadonlyArray<{ yarnItemId: string; grossKg: string }>): InitialDrafts {
  const next: InitialDrafts = { ...drafts };
  for (const y of yarns) {
    const d = next[y.yarnItemId] ?? emptyInitialLine();
    if (d.qtyKg.trim() === "" && Number(y.grossKg) > 0) next[y.yarnItemId] = { ...d, qtyKg: String(Number(Number(y.grossKg).toFixed(3))).replace(".", ",") };
  }
  return next;
}

/** Taslaktaki toplam kg (düğme etiketi). */
export const initialTotalKg = (drafts: InitialDrafts, yarnIds: readonly string[]): number =>
  yarnIds.reduce((s, id) => s + (parseNum(drafts[id]?.qtyKg ?? "") ?? 0), 0);
