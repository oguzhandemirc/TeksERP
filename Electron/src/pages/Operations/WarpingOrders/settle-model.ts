// Kapanış — saf yardımcılar (D7b). Panel hesap YAPMAZ: sunucunun varsayılan planından satır taslağı, taslaktan
// istek gövdesi, satır içi sınır uyarısı ve biçim. Fire %, tolerans ve "kalır" kararı sunucunun önizlemesinden gelir;
// satırdaki "kalır" yalnız girdi yardımıdır (tutulan − iade − fire).
import { formatQty } from "@/lib/format";
import { parseNum } from "./order-model";
import type { PickedRef } from "./dispatch-model";
import type { WarpingSettleFields, WarpingSettlePlanLine } from "./settle-types";

export interface SettleLineDraft {
  line: WarpingSettlePlanLine;
  returnKg: string;
  wasteKg: string;
  warehouse: PickedRef | null;
}

const toInput = (v: string) => (Number(v) === 0 ? "" : String(Number(v)).replace(".", ","));

/** Sunucunun (varsayılan A1-a ya da son önizleme) planından taslak. */
export const draftsFromPlan = (lines: WarpingSettlePlanLine[]): SettleLineDraft[] =>
  lines.map((line) => ({ line, returnKg: toInput(line.returnKg), wasteKg: toInput(line.wasteKg), warehouse: null }));

export type Bucket = "return" | "keep" | "waste";

/** Satırın bütün tutmasını tek kovaya koyar (hızlı düğmeler). */
export function fillLine(d: SettleLineDraft, b: Bucket): SettleLineDraft {
  const all = toInput(d.line.holdingKg);
  return { ...d, returnKg: b === "return" ? all : "", wasteKg: b === "waste" ? all : "" };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Girdi yardımı: satırda kalan (tutulan − iade − fire); geçersiz girdide null. */
export function keepOf(d: SettleLineDraft): number | null {
  const r = d.returnKg.trim() === "" ? 0 : parseNum(d.returnKg);
  const w = d.wasteKg.trim() === "" ? 0 : parseNum(d.wasteKg);
  if (r === null || w === null || r < 0 || w < 0) return null;
  return round3(Number(d.line.holdingKg) - r - w);
}

export type SettleBuild = { ok: true; body: WarpingSettleFields; hasReturn: boolean } | { ok: false; error: string };

interface BuildOpts { reason: string; returnReasonCode: string }

/** Her kalem gövdeye girer (listede olmayan kalem sunucuda tümüyle "kalır" sayılır — açık olsun diye 0'lar da gider). */
export function buildSettleBody(drafts: SettleLineDraft[], opts: BuildOpts): SettleBuild {
  const lines: NonNullable<WarpingSettleFields["lines"]> = [];
  let hasReturn = false;
  for (const d of drafts) {
    const keep = keepOf(d);
    const label = `${d.line.dispatchNo} · ${d.line.lotNo ?? "lotsuz"}`;
    if (keep === null) return { ok: false, error: `${label}: geçerli bir sayı girin.` };
    if (keep < -1e-9) return { ok: false, error: `${label}: iade + fire, deverecide tutulanı aşıyor.` };
    const returnKg = round3(parseNum(d.returnKg) ?? 0);
    const wasteKg = round3(parseNum(d.wasteKg) ?? 0);
    if (returnKg > 0) hasReturn = true;
    lines.push({ dispatchItemId: d.line.dispatchItemId, returnKg, wasteKg, ...(returnKg > 0 && d.warehouse ? { warehouseId: d.warehouse.id } : {}) });
  }
  if (hasReturn && !opts.returnReasonCode) return { ok: false, error: "İade satırı var — iade sebebini seçin." };
  return {
    ok: true, hasReturn,
    body: { reason: opts.reason.trim() || null, returnReasonCode: hasReturn ? opts.returnReasonCode : null, lines },
  };
}

/** Yüzde metni (sunucu `12.50` → `%12,5`). */
export const pctText = (v: string | null) => (v === null ? "—" : `%${formatQty(v, 2)}`);
