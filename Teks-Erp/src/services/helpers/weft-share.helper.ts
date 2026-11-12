// =============================================================================
// ATKI İPLİK PAYI % — atkı kartının okuma yanıtına salt-okunur süs (Seyitoğlu 3. bölüm L3)
// =============================================================================
// Kütle payı = ipliğin atkı kg/m'si ÷ Σ atkı kg/m; kg/m maliyet motorunun atkı formülünden (`yarnUsagePerM`),
// kopya yok. Karttaki sıklık/atkı boyu/fire bilinmese de pay hesaplanır: üçü her ipliğin kg/m'sinde ORTAK
// çarpandır ve oranda sadeleşir — bu yüzden motora sabit (1 atkı/cm · 100 cm · %0 fire) verilir. Bir ipliğin
// denyesi yoksa kütle payı çıkmaz → atım sayısı payı (picksInRepeat ÷ Σ) ve `shareBasis: "PICKS"`.
// =============================================================================
import { Prisma } from "@prisma/client";
import { yarnUsagePerM, type CostInput, type CostWeftYarn } from "./fabric-cost.helper";
import type { Sourced } from "./fabric-cost-types.helper";

export type WeftShareBasis = "MASS" | "PICKS";

export interface WeftShareYarnIn {
  yarnItemId: string;
  picksInRepeat: number;
  yarnItem: { name: string; linearDensityDen: Prisma.Decimal | null };
}

const NORMALIZED = new Prisma.Decimal(1);
const SOURCED = (v: Prisma.Decimal) => ({ value: v, source: "KART" as const });
const round2 = (d: Prisma.Decimal): number => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
// Pay sorusu yalnız atkı bölümünü okur (`weftKgs`); çözgü/tezgâh/terbiye terimleri bilinmiyor olarak geçer.
const UNKNOWN = (): Sourced<Prisma.Decimal> => ({ value: null, source: "KART" });
const weftOnlyInput = (weft: NonNullable<CostInput["weft"]>): CostInput => ({
  schemaVersion: 1, parameterSetId: null, warp: null, weft,
  loom: { rpm: UNKNOWN(), efficiencyPct: UNKNOWN(), machineRateTry: UNKNOWN(), laborRateTry: UNKNOWN(), loomsPerOperator: UNKNOWN(), energyKwhPerHour: UNKNOWN(), energyPriceTry: UNKNOWN() },
  beam: { prepCostTry: UNKNOWN(), lengthM: UNKNOWN() },
  finishing: null, lengthShrinkPct: UNKNOWN(), fabricWastePct: UNKNOWN(), overheadPct: UNKNOWN(), extra: null,
});

/** Satır sırasıyla pay % (2 hane) + esas; satır yoksa ya da Σ atım 0 ise `{ basis: null, shares: [] }`. */
export function weftYarnShares(yarns: ReadonlyArray<WeftShareYarnIn>): { basis: WeftShareBasis | null; shares: number[] } {
  const totalPicks = yarns.reduce((a, y) => a + y.picksInRepeat, 0);
  if (yarns.length === 0 || totalPicks <= 0) return { basis: null, shares: [] };
  if (yarns.every((y) => y.yarnItem.linearDensityDen != null)) {
    const input = weftOnlyInput({
      weftSpecId: null, picksPerCm: SOURCED(NORMALIZED), lengthCm: SOURCED(new Prisma.Decimal(100)), wastePct: SOURCED(new Prisma.Decimal(0)),
      yarns: yarns.map((y): CostWeftYarn => ({ yarnItemId: y.yarnItemId, name: y.yarnItem.name, denier: SOURCED(y.yarnItem.linearDensityDen!), price: null, picksInRepeat: y.picksInRepeat })),
    });
    const kg = yarnUsagePerM(input).weft.map((w) => w.kgPerM);
    const total = kg.reduce((a, k) => a.plus(k), new Prisma.Decimal(0));
    if (kg.length === yarns.length && total.gt(0)) return { basis: "MASS", shares: kg.map((k) => round2(k.div(total).mul(100))) };
  }
  return { basis: "PICKS", shares: yarns.map((y) => round2(new Prisma.Decimal(y.picksInRepeat).div(totalPicks).mul(100))) };
}

/** Okuma yanıtı süsü: her iplik satırına `sharePct`, karta `shareBasis` (hesaplanamıyorsa null). */
export function withWeftShares<T extends { yarns: ReadonlyArray<WeftShareYarnIn> }>(row: T): Omit<T, "yarns"> & {
  shareBasis: WeftShareBasis | null;
  yarns: Array<T["yarns"][number] & { sharePct: number | null }>;
} {
  const { basis, shares } = weftYarnShares(row.yarns);
  return { ...row, shareBasis: basis, yarns: row.yarns.map((y, i) => ({ ...y, sharePct: shares[i] ?? null })) };
}
