// =============================================================================
// TABLET İŞ KARTI — dokuma işinin ETKİN YAPISI, salt-okunur (Seyitoğlu SY-M4, tasarım §14.8 / K3)
// =============================================================================
// Yapı yalnız `resolveEffectiveConstruction`tan okunur (ikinci okuma yok); burası onu operatörün
// göreceği dar biçime indirir (iplik denyesi, uyarılar tablete gitmez; armür planı + seçici kart görseli
// için 2026-11-22'den beri EKLEME alan olarak gider). Yapısız iş
// (atkı kartı, desen kartı, ek çözgü katmanı yok) → `null`: tablet hiçbir şey çizmez (bugünkü ekran).
// =============================================================================
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { resolveEffectiveConstruction, type EffectiveConstruction } from "./effective-construction.helper";

export interface TabletConstructionDto {
  weavingOrderId: string;
  variantCode: string | null;
  design: {
    code: string; name: string; loomFileName: string | null; frameCount: number | null; repeatCm: number | null;
    // Kart görseli (2026-11-22) — EKLEME alanlar; eski tablet bilinmeyen alanı yok sayar.
    /** PLAIN · DOBBY · JACQUARD · LENO. */
    kind: string;
    /** Mekanizma (CAM · DOBBY · JACQUARD) + örgü (PLAIN · TWILL · SATIN · LENO · OTHER | null) — 2026-11-25 EKLEME. */
    shedMechanism: string;
    weaveStructure: string | null;
    /** Armür planı: satır = atkı, sütun = çerçeve, 1 = kalkık; girilmemişse ya da Armür dışı mekanizmada null. */
    liftPlan: number[][] | null;
    /** 1-tabanlı döner çerçeve no'ları. */
    lenoFrames: number[];
    /** 1-tabanlı kenar çerçeve no'ları (2026-11-25 EKLEME; Armür dışında boş). Tablet henüz çizmez. */
    selvedgeFrames: number[];
    drawingInNote: string | null;
  } | null;
  weft: {
    code: string;
    name: string;
    picksPerCm: number | null;
    sequenceCode: string | null;
    weftProgramNo: string | null;
    picksInRepeatTotal: number;
    yarns: Array<{ letter: string; picksInRepeat: number; yarnCode: string; yarnName: string; swapped: boolean }>;
    /** Atkı seçici: atkı başına 1-tabanlı iplik satırı no (sunucu `expandWeftSequence`); kod yoksa null. */
    pickSequence: number[] | null;
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
    design: d
      ? {
        code: d.code, name: d.name, loomFileName: d.loomFileName, frameCount: d.frameCount, repeatCm: num(d.repeatCm),
        kind: d.kind, shedMechanism: d.shedMechanism, weaveStructure: d.weaveStructure, liftPlan: Array.isArray(d.liftPlan) ? (d.liftPlan as number[][]) : null, lenoFrames: d.lenoFrames, selvedgeFrames: d.selvedgeFrames, drawingInNote: d.drawingInNote,
      }
      : null,
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
        pickSequence: c.weft.pickSequence,
      }
      : null,
    warpLayers: c.warpLayers.map((l) => ({ role: l.role, beamMode: l.beamMode, warpCode: l.warpSpec.code, warpName: l.warpSpec.name })),
  };
}

/** İş emrinin pin'li etkin yapısı (tablet iş kartı, panel iş emri "Yapı" bölümü ve iş emri desen kartı aynı yol); iş yoksa 404. */
export async function weavingOrderConstruction(weavingOrderId: string): Promise<{ weavingOrderNumber: string; recipeId: string | null; construction: EffectiveConstruction }> {
  const wo = await prisma.weavingOrder.findUnique({
    where: { id: weavingOrderId }, select: { id: true, weavingOrderNumber: true, itemId: true, recipeId: true, weftSpecId: true, weaveDesignId: true },
  });
  if (!wo) throw AppError.notFound("Dokuma iş emri bulunamadı");
  // İş emrinin doğuşta seçtiği atkı/desen kartı (ürün sonradan başka karta geçse de iş kartı onu gösterir).
  const pin = { weftSpecId: wo.weftSpecId, weaveDesignId: wo.weaveDesignId };
  return { weavingOrderNumber: wo.weavingOrderNumber, recipeId: wo.recipeId, construction: await resolveEffectiveConstruction(prisma, wo.itemId, wo.recipeId, pin) };
}

/** `GET /machine-runs/construction?weavingOrderId=` — dokuma işinin ürün + varyantından etkin yapı; iş yoksa 404. */
export async function weavingOrderTabletConstruction(weavingOrderId: string): Promise<TabletConstructionDto | null> {
  return toTabletConstruction(weavingOrderId, (await weavingOrderConstruction(weavingOrderId)).construction);
}
