// =============================================================================
// ETKİN YAPI — `resolveEffectiveConstruction(db, itemId, recipeId?)` (Seyitoğlu SY-A2, tasarım K3)
// =============================================================================
// "Bu ürün/varyant hangi çözgü katmanları, atkı satırları, armür ve sıklıkla dokunur?" sorusunun
// TEK cevabı. Varyant (`ProductRecipe`) atkı kartının KOPYASINI taşımaz; yalnız "şu sıradaki
// ipliğin yerine bu iplik" der (`ProductRecipeWeftYarn`) — pay/sıklık kartta kalır. Ek çözgü
// katmanları (`ItemWarpLayer`) ve varyant iplik değişimleri YALNIZ bu dosyada okunur
// (`test_etkin_yapi_tek_kaynak` AST bekçisi). Uyarılar kaydı reddetmez.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { CONSTRUCTION_WARNING, REPEAT_PICKS_TOLERANCE_PCT } from "../../constants/weave-design";
import { weftLetter } from "./weft-sequence.helper";

type Db = Prisma.TransactionClient | typeof prisma;

const YARN_SELECT = { id: true, code: true, name: true, linearDensityDen: true } satisfies Prisma.ItemSelect;
const WARP_SELECT = {
  id: true, code: true, name: true, endsCount: true, takeUpPct: true, wastePct: true, yarnItem: { select: YARN_SELECT },
} satisfies Prisma.WarpSpecSelect;
const DESIGN_SELECT = {
  id: true, code: true, name: true, kind: true, familyLabel: true, frameCount: true, repeatCm: true,
  liftPlan: true, loomFileName: true, lenoSetup: true, isActive: true,
} satisfies Prisma.WeaveDesignSelect;

const ITEM_CONSTRUCTION_SELECT = {
  id: true, code: true, name: true, itemType: true, widthCm: true,
  warpSpec: { select: WARP_SELECT },
  warpLayers: { orderBy: { sortOrder: "asc" }, select: { role: true, beamMode: true, sortOrder: true, warpSpec: { select: WARP_SELECT } } },
  weftSpec: {
    select: {
      id: true, code: true, name: true, picksPerCm: true, sequenceCode: true, weftProgramNo: true,
      yarns: { orderBy: { sortOrder: "asc" }, select: { sortOrder: true, picksInRepeat: true, yarnItem: { select: YARN_SELECT } } },
    },
  },
  weaveDesign: { select: DESIGN_SELECT },
} satisfies Prisma.ItemSelect;

type YarnRef = Prisma.ItemGetPayload<{ select: typeof YARN_SELECT }>;
type WarpRef = Prisma.WarpSpecGetPayload<{ select: typeof WARP_SELECT }>;

export interface EffectiveWeftYarn {
  sortOrder: number;
  letter: string;
  picksInRepeat: number;
  yarnItem: YarnRef;
  /** Varyant bu satırın ipliğini değiştirdiyse kartın özgün ipliği; değiştirmediyse null. */
  cardYarnItem: YarnRef | null;
}

export interface EffectiveConstruction {
  itemId: string;
  recipeId: string | null;
  variantCode: string | null;
  widthCm: Prisma.Decimal | null;
  groundWarp: WarpRef | null;
  warpLayers: Array<{ role: string; beamMode: string; sortOrder: number; warpSpec: WarpRef }>;
  weft: {
    weftSpecId: string; code: string; name: string; picksPerCm: Prisma.Decimal | null;
    sequenceCode: string | null; weftProgramNo: string | null; picksInRepeatTotal: number; yarns: EffectiveWeftYarn[];
  } | null;
  weaveDesign: Prisma.WeaveDesignGetPayload<{ select: typeof DESIGN_SELECT }> | null;
  warnings: Array<{ code: string; message: string }>;
}

function liftPlanShape(plan: Prisma.JsonValue | null): { picks: number; frames: number } | null {
  if (!Array.isArray(plan)) return null;
  const frames = plan.reduce<number>((m, row) => Math.max(m, Array.isArray(row) ? row.length : 0), 0);
  return { picks: plan.length, frames };
}

function constructionWarnings(c: Omit<EffectiveConstruction, "warnings">): EffectiveConstruction["warnings"] {
  const out: EffectiveConstruction["warnings"] = [];
  const d = c.weaveDesign;
  const total = c.weft?.picksInRepeatTotal ?? 0;
  if (d?.repeatCm && c.weft?.picksPerCm && total > 0) {
    const implied = total / Number(d.repeatCm);
    const declared = Number(c.weft.picksPerCm);
    if (declared > 0 && Math.abs(implied - declared) / declared * 100 > REPEAT_PICKS_TOLERANCE_PCT) {
      out.push({
        code: CONSTRUCTION_WARNING.repeatPicksMismatch,
        message: `Rapordaki atkı (${total}) ÷ desen boyu (${d.repeatCm.toString()} cm) = ${implied.toFixed(2)} atkı/cm; kartın sıklığı ${declared} — fark %${REPEAT_PICKS_TOLERANCE_PCT}'ten büyük.`,
      });
    }
  }
  const shape = liftPlanShape(d?.liftPlan ?? null);
  if (shape && d?.frameCount != null && shape.frames > d.frameCount) {
    out.push({ code: CONSTRUCTION_WARNING.liftPlanFramesExceed, message: `Armür ızgarası ${shape.frames} çerçeve kullanıyor; desen kartında çerçeve sayısı ${d.frameCount}.` });
  }
  if (shape && total > 0 && shape.picks !== total) {
    out.push({ code: CONSTRUCTION_WARNING.liftPlanPicksMismatch, message: `Armür ızgarası ${shape.picks} atkı satırı; atkı kartı raporu ${total} atkı (bilgi).` });
  }
  return out;
}

/**
 * Ürünün (varyant verilirse varyant değişimi uygulanmış) etkin yapısı. Varyant başka ürüne aitse 400;
 * ürün/varyant yoksa 404. Maliyet derleyicisi, dokuma iş emri ön dolgusu, üretim önerisi ve tablet
 * iş kartı yapıyı YALNIZ buradan okur.
 */
export async function resolveEffectiveConstruction(db: Db, itemId: string, recipeId?: string | null): Promise<EffectiveConstruction> {
  const item = await db.item.findUnique({ where: { id: itemId }, select: ITEM_CONSTRUCTION_SELECT });
  if (!item) throw AppError.notFound("Ürün bulunamadı.");
  let variantCode: string | null = null;
  const overrides = new Map<number, YarnRef>();
  if (recipeId) {
    const recipe = await db.productRecipe.findUnique({
      where: { id: recipeId },
      select: { itemId: true, variantCode: true, weftYarnOverrides: { select: { weftSortOrder: true, yarnItem: { select: YARN_SELECT } } } },
    });
    if (!recipe) throw AppError.notFound("Varyant (iş emri şablonu) bulunamadı.");
    if (recipe.itemId !== itemId) throw AppError.badRequest("Varyant bu ürüne ait değil.", { code: "RECIPE_ITEM_MISMATCH" });
    variantCode = recipe.variantCode;
    for (const o of recipe.weftYarnOverrides) overrides.set(o.weftSortOrder, o.yarnItem);
  }
  const ws = item.weftSpec;
  const yarns: EffectiveWeftYarn[] = (ws?.yarns ?? []).map((y) => {
    const swap = overrides.get(y.sortOrder);
    return {
      sortOrder: y.sortOrder,
      letter: weftLetter(y.sortOrder),
      picksInRepeat: y.picksInRepeat,
      yarnItem: swap ?? y.yarnItem,
      cardYarnItem: swap ? y.yarnItem : null,
    };
  });
  const base: Omit<EffectiveConstruction, "warnings"> = {
    itemId: item.id,
    recipeId: recipeId ?? null,
    variantCode,
    widthCm: item.widthCm,
    groundWarp: item.warpSpec,
    warpLayers: item.warpLayers.map((l) => ({ role: l.role, beamMode: l.beamMode, sortOrder: l.sortOrder, warpSpec: l.warpSpec })),
    weft: ws
      ? {
        weftSpecId: ws.id, code: ws.code, name: ws.name, picksPerCm: ws.picksPerCm, sequenceCode: ws.sequenceCode,
        weftProgramNo: ws.weftProgramNo, picksInRepeatTotal: yarns.reduce((s, y) => s + y.picksInRepeat, 0), yarns,
      }
      : null,
    weaveDesign: item.weaveDesign,
  };
  return { ...base, warnings: constructionWarnings(base) };
}

export interface WeftOverrideOrphan {
  recipeId: string;
  recipeCode: string;
  recipeName: string;
  variantCode: string | null;
  itemId: string;
  itemCode: string;
  weftSortOrder: number;
}

/**
 * Atkı kartının iplik satır sayısı `yarnCount`a inerse (ya da ürün başka karta geçerse) sırası
 * artık var olmayan varyant değişimleri. Kart yolunda `weftSpecId`, ürün yolunda `itemId` verilir.
 */
export async function findWeftOverrideOrphans(
  db: Db,
  scope: { weftSpecId: string } | { itemId: string },
  yarnCount: number,
): Promise<WeftOverrideOrphan[]> {
  const recipeWhere: Prisma.ProductRecipeWhereInput = "itemId" in scope ? { itemId: scope.itemId } : { item: { weftSpecId: scope.weftSpecId } };
  const rows = await db.productRecipeWeftYarn.findMany({
    where: { weftSortOrder: { gte: yarnCount }, recipe: recipeWhere },
    select: {
      weftSortOrder: true,
      recipe: { select: { id: true, code: true, name: true, variantCode: true, item: { select: { id: true, code: true } } } },
    },
    orderBy: [{ recipe: { code: "asc" } }, { weftSortOrder: "asc" }],
  });
  return rows.map((r) => ({
    recipeId: r.recipe.id,
    recipeCode: r.recipe.code,
    recipeName: r.recipe.name,
    variantCode: r.recipe.variantCode,
    itemId: r.recipe.item.id,
    itemCode: r.recipe.item.code,
    weftSortOrder: r.weftSortOrder,
  }));
}

/**
 * Reçete başka ürüne taşınırsa (PATCH/reactivate `itemId`) sıra numarasıyla tutulan değişimler yeni
 * ürünün atkı kartında anlamını yitirir — taşınan reçetenin TÜM değişimleri sahipsiz sayılır.
 */
export async function findRecipeMoveOrphans(db: Db, recipeId: string, nextItemId: unknown): Promise<WeftOverrideOrphan[]> {
  if (typeof nextItemId !== "string") return [];
  const rows = await db.productRecipeWeftYarn.findMany({
    where: { recipeId, recipe: { itemId: { not: nextItemId } } },
    select: {
      weftSortOrder: true,
      recipe: { select: { id: true, code: true, name: true, variantCode: true, item: { select: { id: true, code: true } } } },
    },
    orderBy: { weftSortOrder: "asc" },
  });
  return rows.map((r) => ({
    recipeId: r.recipe.id,
    recipeCode: r.recipe.code,
    recipeName: r.recipe.name,
    variantCode: r.recipe.variantCode,
    itemId: r.recipe.item.id,
    itemCode: r.recipe.item.code,
    weftSortOrder: r.weftSortOrder,
  }));
}

/** 409 `WEFT_OVERRIDE_ORPHAN` — etkilenen varyant listesiyle (sessiz kayma yok). */
export function throwWeftOverrideOrphan(orphans: WeftOverrideOrphan[]): never {
  const names = [...new Set(orphans.map((o) => o.variantCode ? `${o.itemCode} ${o.variantCode}` : o.recipeCode))];
  throw AppError.conflict(
    `Bu değişiklik ${names.length} varyantın atkı ipliği değişimini sahipsiz bırakır (${names.slice(0, 5).join(", ")}${names.length > 5 ? "…" : ""}) — önce o varyantların atkı değişimini düzeltin.`,
    { code: "WEFT_OVERRIDE_ORPHAN", orphans },
  );
}

/** Varyantın mevcut değişim kümesi (audit eski küme; yazıcı servis kullanır). */
export async function readRecipeWeftOverrides(db: Db, recipeId: string): Promise<Array<{ weftSortOrder: number; yarnItemId: string }>> {
  return db.productRecipeWeftYarn.findMany({ where: { recipeId }, select: { weftSortOrder: true, yarnItemId: true }, orderBy: { weftSortOrder: "asc" } });
}

/** Ürünün mevcut ek çözgü katmanları (audit eski küme; yazıcı servis kullanır). */
export async function readItemWarpLayers(db: Db, itemId: string): Promise<Array<{ warpSpecId: string; role: string; beamMode: string; sortOrder: number }>> {
  return db.itemWarpLayer.findMany({ where: { itemId }, select: { warpSpecId: true, role: true, beamMode: true, sortOrder: true }, orderBy: { sortOrder: "asc" } });
}
