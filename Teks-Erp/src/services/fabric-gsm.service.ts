// =============================================================================
// KUMAŞ KARTI — HESAPLANAN GRAMAJ (salt okuma; Seyitoğlu temel, 2026-11-11)
// =============================================================================
// Yeni formül YOK: kg/m maliyet motorunun `yarnUsagePerM`inden (`includeWaste: false` = çözgü/atkı
// firesi HARİÇ net kumaş), girdi `buildCostInput`tan (tek kurucu; atkı boyu, take-up zinciri aynı).
// Eksik veri → ilgili alan null ("bilinmiyor"), 0 ya da hata DEĞİL. Fiyat sorgusu koşmaz.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { buildCostInput, loadCostStructureSourcesTx } from "./helpers/cost-assembler.helper";
import { yarnUsagePerM } from "./helpers/fabric-cost.helper";

type Dec = Prisma.Decimal;
const KG_TO_G = new Prisma.Decimal(1000);
const HUNDRED = new Prisma.Decimal(100);
const num2 = (v: Dec | null): number | null => (v === null ? null : v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber());

export interface ComputedGsm {
  rawWidthCm: number | null;
  warpGPerM: number | null;
  weftGPerM: number | null;
  totalGPerM: number | null;
  gsm: number | null;
  enteredRawGsm: number | null;
  diffPct: number | null;
}

/** Ham değerlerden (Decimal) sözleşme alanları — yuvarlama yalnız burada (2 hane). */
export function presentComputedGsm(p: { rawWidthCm: Dec | null; warpKgPerM: Dec | null; weftKgPerM: Dec | null; enteredRawGsm: Dec | null }): ComputedGsm {
  const warpG = p.warpKgPerM?.mul(KG_TO_G) ?? null;
  const weftG = p.weftKgPerM?.mul(KG_TO_G) ?? null;
  const total = warpG && weftG ? warpG.plus(weftG) : null;
  const width = p.rawWidthCm && p.rawWidthCm.gt(0) ? p.rawWidthCm : null;
  const gsm = total && width ? total.div(width.div(HUNDRED)) : null;
  const diff = gsm && gsm.gt(0) && p.enteredRawGsm ? p.enteredRawGsm.minus(gsm).div(gsm).mul(HUNDRED) : null;
  return {
    rawWidthCm: num2(p.rawWidthCm),
    warpGPerM: num2(warpG),
    weftGPerM: num2(weftG),
    totalGPerM: num2(total),
    gsm: num2(gsm),
    enteredRawGsm: num2(p.enteredRawGsm),
    diffPct: num2(diff),
  };
}

/** Ürün yoksa 404; KUMAŞ değilse ya da yapı eksikse kg alanları null (hata değil). */
export async function computedGsmForItem(itemId: string): Promise<ComputedGsm> {
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { id: true, itemType: true, rawWidthCm: true, rawGsm: true } });
  if (!item) throw AppError.notFound("Ürün bulunamadı.");
  const base = { rawWidthCm: item.rawWidthCm, enteredRawGsm: item.rawGsm };
  if (item.itemType !== "FABRIC") return presentComputedGsm({ ...base, warpKgPerM: null, weftKgPerM: null });
  const src = await loadCostStructureSourcesTx(prisma as unknown as Prisma.TransactionClient, [item.id]);
  const input = buildCostInput(src, { itemId: item.id });
  const usage = yarnUsagePerM(input, { includeWaste: false });
  // Çözgü: zemin + HER ek katman çözülmeli (yarım çözgü gösterilmez). Atkı: boş dizi = çözülemedi.
  const layersOk = usage.warpLayers.length === (input.warpLayers?.length ?? 0);
  const warpKgPerM = usage.warp && layersOk ? usage.warpLayers.reduce((a, l) => a.plus(l.kgPerM), usage.warp.kgPerM) : null;
  const weftKgPerM = usage.weft.length > 0 ? usage.weft.reduce((a, w) => a.plus(w.kgPerM), new Prisma.Decimal(0)) : null;
  return presentComputedGsm({ ...base, warpKgPerM, weftKgPerM });
}
