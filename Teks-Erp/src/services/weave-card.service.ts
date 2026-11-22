// =============================================================================
// DESEN KARTI BASIMI — kumaşın etkin yapısından A4 görünüm modeli (Seyitoğlu dilim b)
// =============================================================================
// Yapı yalnız `resolveEffectiveConstruction`tan, varyant iplik değişimleri `readWeftOverridesForRecipes`ten
// (K3 tek kaynak). ANLIK belge: donmaz, numara almaz; basım izi panelde `printTracked` ile yazılır.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { factoryDateTimeTr } from "../constants/time";
import { readWeftOverridesForRecipes, resolveEffectiveConstruction } from "./helpers/effective-construction.helper";
import { warpSpecDenierLines } from "./helpers/warp-spec-yarn.helper";
import { qtyText } from "./helpers/qty-text.helper";
import { renderWeaveDesignCardHtml, type WeaveCardView, type WeaveCardYarn } from "./document-render/weave-design-card.html";

const KIND_LABEL: Record<string, string> = { PLAIN: "Bez ayağı", DOBBY: "Armür", JACQUARD: "Jakar", LENO: "Döner (leno)" };
const LAYER_ROLE_LABEL: Record<string, string> = { LENO: "döner", SECONDARY: "ikinci" };

const dec = (v: Prisma.Decimal | null | undefined): string | null => (v == null ? null : qtyText(v));
const yarn = (y: { code: string; name: string; linearDensityDen: Prisma.Decimal | null }): WeaveCardYarn => ({
  code: y.code, name: y.name, denier: dec(y.linearDensityDen),
});

export async function buildWeaveCardView(itemId: string, now: Date = new Date()): Promise<WeaveCardView> {
  const c = await resolveEffectiveConstruction(prisma, itemId, null);
  const item = await prisma.item.findUniqueOrThrow({ where: { id: itemId }, select: { code: true, name: true } });
  const recipes = await prisma.productRecipe.findMany({
    where: { itemId, isActive: true },
    select: { id: true, name: true, variantCode: true },
    orderBy: [{ variantCode: { sort: "asc", nulls: "last" } }, { code: "asc" }],
  });
  const overrides = await readWeftOverridesForRecipes(prisma, recipes.map((r) => r.id));
  const d = c.weaveDesign;
  const warpSpecs = [
    ...(c.groundWarp ? [{ roleLabel: "", spec: c.groundWarp }] : []),
    ...c.warpLayers.map((l) => ({ roleLabel: LAYER_ROLE_LABEL[l.role] ?? l.role, spec: l.warpSpec })),
  ];
  return {
    designNo: item.code,
    itemName: item.name,
    design: d
      ? {
        code: d.code, name: d.name, kindLabel: KIND_LABEL[d.kind] ?? d.kind, familyLabel: d.familyLabel, frameCount: d.frameCount,
        repeatCm: dec(d.repeatCm), loomFileName: d.loomFileName, lenoSetup: d.lenoSetup,
        drawingInNote: d.drawingInNote,
      }
      : null,
    liftPlan: Array.isArray(d?.liftPlan) ? (d.liftPlan as number[][]) : null,
    lenoFrames: d?.lenoFrames ?? [],
    pickSequence: c.weft?.pickSequence ?? null,
    weft: c.weft
      ? {
        code: c.weft.code, name: c.weft.name, picksPerCm: dec(c.weft.picksPerCm), weftProgramNo: c.weft.weftProgramNo,
        sequenceCode: c.weft.sequenceCode,
        yarns: c.weft.yarns.map((y) => ({ ...yarn(y.yarnItem), no: y.sortOrder + 1, picksInRepeat: y.picksInRepeat })),
      }
      : null,
    warps: warpSpecs.map(({ roleLabel, spec }) => ({
      roleLabel, code: spec.code, name: spec.name,
      lines: warpSpecDenierLines(spec).map((l) => ({ ...yarn(l.yarnItem), denier: dec(l.denier), endsCount: l.endsCount })),
    })),
    widthCm: dec(c.widthCm),
    variants: recipes.map((r) => ({
      variantCode: r.variantCode,
      name: r.name,
      swaps: [...(overrides.get(r.id) ?? new Map()).entries()].sort((a, b) => a[0] - b[0]).map(([sortOrder, y]) => ({ ...yarn(y), no: sortOrder + 1 })),
    })),
    warnings: c.warnings.map((w) => w.message),
    printedAtText: factoryDateTimeTr(now),
  };
}

/** `GET /api/item-construction/:itemId/card-html` — A4 desen kartı HTML'i. */
export async function renderWeaveCard(itemId: string): Promise<string> {
  return renderWeaveDesignCardHtml(await buildWeaveCardView(itemId));
}
