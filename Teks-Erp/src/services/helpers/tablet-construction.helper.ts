// =============================================================================
// TABLET İŞ KARTI — dokuma işinin ETKİN YAPISI, salt-okunur (Seyitoğlu SY-M4, tasarım §14.8 / K3)
// =============================================================================
// Yapı yalnız `resolveEffectiveConstruction`tan okunur (ikinci okuma yok); burası onu operatörün
// göreceği dar biçime indirir (armür ızgarası, iplik denyesi, uyarılar tablete gitmez). Yapısız iş
// (atkı kartı, desen kartı, ek çözgü katmanı yok) → `null`: tablet hiçbir şey çizmez (bugünkü ekran).
// =============================================================================
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { resolveEffectiveConstruction, type EffectiveConstruction } from "./effective-construction.helper";

export interface TabletConstructionDto {
  weavingOrderId: string;
  variantCode: string | null;
  design: { code: string; name: string; loomFileName: string | null; frameCount: number | null; repeatCm: number | null } | null;
  weft: {
    code: string;
    name: string;
    picksPerCm: number | null;
    sequenceCode: string | null;
    weftProgramNo: string | null;
    picksInRepeatTotal: number;
    yarns: Array<{ letter: string; picksInRepeat: number; yarnCode: string; yarnName: string; swapped: boolean }>;
  } | null;
  warpLayers: Array<{ role: string; beamMode: string; warpCode: string; warpName: string }>;
}

const num = (v: { toString(): string } | null | undefined): number | null => (v == null ? null : Number(v.toString()));

/** Etkin yapıyı tablet kartı biçimine indirir; yapı yoksa null (saf; bekçi doğrudan ölçer). */
export function toTabletConstruction(weavingOrderId: string, c: EffectiveConstruction): TabletConstructionDto | null {
  if (!c.weft && !c.weaveDesign && c.warpLayers.length === 0) return null;
  const d = c.weaveDesign;
  return {
    weavingOrderId,
    variantCode: c.variantCode,
    design: d ? { code: d.code, name: d.name, loomFileName: d.loomFileName, frameCount: d.frameCount, repeatCm: num(d.repeatCm) } : null,
    weft: c.weft
      ? {
        code: c.weft.code,
        name: c.weft.name,
        picksPerCm: num(c.weft.picksPerCm),
        sequenceCode: c.weft.sequenceCode,
        weftProgramNo: c.weft.weftProgramNo,
        picksInRepeatTotal: c.weft.picksInRepeatTotal,
        yarns: c.weft.yarns.map((y) => ({
          letter: y.letter, picksInRepeat: y.picksInRepeat, yarnCode: y.yarnItem.code, yarnName: y.yarnItem.name, swapped: y.cardYarnItem !== null,
        })),
      }
      : null,
    warpLayers: c.warpLayers.map((l) => ({ role: l.role, beamMode: l.beamMode, warpCode: l.warpSpec.code, warpName: l.warpSpec.name })),
  };
}

/** `GET /machine-runs/construction?weavingOrderId=` — dokuma işinin ürün + varyantından etkin yapı; iş yoksa 404. */
export async function weavingOrderTabletConstruction(weavingOrderId: string): Promise<TabletConstructionDto | null> {
  const wo = await prisma.weavingOrder.findUnique({ where: { id: weavingOrderId }, select: { id: true, itemId: true, recipeId: true } });
  if (!wo) throw AppError.notFound("Dokuma iş emri bulunamadı");
  return toTabletConstruction(wo.id, await resolveEffectiveConstruction(prisma, wo.itemId, wo.recipeId));
}
