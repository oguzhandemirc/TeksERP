// =============================================================================
// STANDART MALİYET BİLEŞEN GRUPLARI — `CostComponent` → beş özet grup (MAL-8)
// =============================================================================
// Patron bulutu `standart-maliyet.finans` grup toplamlarını buradan alır; grup kümesi tek yerde
// (yeni bileşen enum'a eklenirse `Record` tip denetimi grubunu sormadan derlenmez).
// =============================================================================
import { Prisma, type CostComponent } from "@prisma/client";

export type CostGroup = "cozguTl" | "atkiTl" | "dokumaTl" | "terbiyeTl" | "genelGiderTl";

export const COST_GROUPS: readonly CostGroup[] = ["cozguTl", "atkiTl", "dokumaTl", "terbiyeTl", "genelGiderTl"];

/** Dokuma = tezgah + işçilik + enerji + levent hazırlığı; terbiye = apre + boy çekmesi; genel = fire + genel gider + ek kalem. */
export const COST_COMPONENT_GROUP: Readonly<Record<CostComponent, CostGroup>> = {
  WARP_YARN: "cozguTl",
  WEFT_YARN: "atkiTl",
  LOOM_MACHINE: "dokumaTl",
  LOOM_LABOR: "dokumaTl",
  ENERGY: "dokumaTl",
  BEAM_PREP: "dokumaTl",
  FINISHING: "terbiyeTl",
  LENGTH_SHRINK: "terbiyeTl",
  FABRIC_WASTE: "genelGiderTl",
  OVERHEAD: "genelGiderTl",
  EXTRA: "genelGiderTl",
};

/** Sürüm kalemlerinin grup toplamları (TL/m, 4 hane — kalem `amountPerMTry` hassasiyeti). */
export function sumCostGroups(lines: ReadonlyArray<{ component: CostComponent; amountPerMTry: Prisma.Decimal.Value }>): Record<CostGroup, Prisma.Decimal> {
  const out = Object.fromEntries(COST_GROUPS.map((g) => [g, new Prisma.Decimal(0)])) as Record<CostGroup, Prisma.Decimal>;
  for (const l of lines) {
    const g = COST_COMPONENT_GROUP[l.component];
    out[g] = out[g].plus(new Prisma.Decimal(l.amountPerMTry));
  }
  for (const g of COST_GROUPS) out[g] = out[g].toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
  return out;
}
