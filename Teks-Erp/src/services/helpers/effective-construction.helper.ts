// =============================================================================
// ETKİN YAPI — `resolveEffectiveConstruction(db, itemId, recipeId?)` (Seyitoğlu SY-A2, tasarım K3)
// =============================================================================
// "Bu ürün/varyant hangi çözgü katmanları, atkı satırları, armür ve sıklıkla dokunur?" sorusunun
// TEK cevabı. Varyant (`ProductRecipe`) atkı kartının KOPYASINI taşımaz; yalnız "şu sıradaki
// ipliğin yerine bu iplik" der (`ProductRecipeWeftYarn`) — pay/sıklık kartta kalır. Ek çözgü
// katmanları (`ItemWarpLayer`) ve varyant iplik değişimleri YALNIZ bu dosyada okunur
// (`test_etkin_yapi_tek_kaynak` AST bekçisi). Uyarılar kaydı reddetmez.
// =============================================================================
import { sequentialTx } from "./tx-sequential-relations.helper";
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { CONSTRUCTION_WARNING, LIFT_PLAN_MAX_PICKS, REPEAT_PICKS_TOLERANCE_PCT } from "../../constants/weave-design";
import { expandWeftSequence, weftLetter } from "./weft-sequence.helper";
import { WARP_SPEC_YARN_DENIER_SELECT, warpSpecYarnLines } from "./warp-spec-yarn.helper";
import { expandWarpSequence, type WarpEndsSequence } from "./warp-sequence.helper";
import { pctText, qtyText } from "./qty-text.helper";
import { widthOrderWarnings } from "./fabric-width.helper";
import { mechanismUsesLiftPlan, resolveWeaveClass, type WeaveClass } from "../../constants/weave-classification";

type Db = Prisma.TransactionClient | typeof prisma;

const YARN_SELECT = { id: true, code: true, name: true, linearDensityDen: true } satisfies Prisma.ItemSelect;
const WARP_SELECT = {
  // Fason devere D2: iplik + denye kart satırlarından (`yarns`); `yarnItem` = ana iplik.
  id: true, code: true, name: true, takeUpPct: true, wastePct: true, ...WARP_SPEC_YARN_DENIER_SELECT,
  // Kart görseli (tel düzeni şeridi + tarak planı) — gösterim alanları.
  sequenceNote: true, endsPerDent: true, reedNo: true, selvedgeEnds: true, reedWidthCm: true,
} satisfies Prisma.WarpSpecSelect;
const DESIGN_SELECT = {
  id: true, code: true, name: true, kind: true, shedMechanism: true, weaveStructure: true, hookCount: true, repeatWidthCm: true,
  familyLabel: true, frameCount: true, repeatCm: true,
  liftPlan: true, loomFileName: true, lenoSetup: true, lenoFrames: true, selvedgeFrames: true, drawingInNote: true, isActive: true,
} satisfies Prisma.WeaveDesignSelect;
type RawDesign = Prisma.WeaveDesignGetPayload<{ select: typeof DESIGN_SELECT }>;
export type EffectiveWeaveDesign = Omit<RawDesign, "shedMechanism" | "weaveStructure"> & WeaveClass;

/**
 * Desenin okuyucu görünümü — TEK nokta: sınıflama çözülür, Armür dışı mekanizmada saklı armür ızgarası
 * GÖRÜNMEZ (drawdown, basım, tablet, panel yapı görseli hepsi buradan okur); kenar çerçeveleri de (ızgaranın
 * parçası); Jakar dışında kanca sayısı gizli.
 */
export function effectiveWeaveDesign(d: RawDesign | null): EffectiveWeaveDesign | null {
  if (!d) return null;
  const cls = resolveWeaveClass(d);
  return {
    ...d, ...cls,
    liftPlan: mechanismUsesLiftPlan(cls.shedMechanism) ? d.liftPlan : null,
    selvedgeFrames: mechanismUsesLiftPlan(cls.shedMechanism) ? d.selvedgeFrames : [],
    hookCount: cls.shedMechanism === "JACQUARD" ? d.hookCount : null,
  };
}
const WEFT_SELECT = {
  id: true, code: true, name: true, picksPerCm: true, sequenceCode: true, weftProgramNo: true,
  yarns: { orderBy: { sortOrder: "asc" }, select: { sortOrder: true, picksInRepeat: true, colorChannel: true, yarnItem: { select: YARN_SELECT } } },
} satisfies Prisma.WeftSpecSelect;

const ITEM_CONSTRUCTION_SELECT = {
  id: true, code: true, name: true, itemType: true, widthCm: true, rawWidthCm: true,
  warpSpec: { select: WARP_SELECT },
  warpLayers: { orderBy: { sortOrder: "asc" }, select: { role: true, beamMode: true, sortOrder: true, warpSpec: { select: WARP_SELECT } } },
  weftSpec: { select: WEFT_SELECT },
  weaveDesign: { select: DESIGN_SELECT },
} satisfies Prisma.ItemSelect;

/** İş emrinin doğuşta TAŞIDIĞI kartlar; null = iş emrinde seçim yok → ürünün güncel kartı (eski iş emri emsali, loom-load ile aynı). */
export interface ConstructionPin {
  weftSpecId: string | null;
  weaveDesignId: string | null;
}

type YarnRef = Prisma.ItemGetPayload<{ select: typeof YARN_SELECT }>;
type WarpRow = Prisma.WarpSpecGetPayload<{ select: typeof WARP_SELECT }>;
/** Çözgü kartı + dizilim açılımı (`endsSequence`; not yok/okunamaz → null). İstemci açılımı yeniden hesaplamaz. */
export type WarpRef = WarpRow & { endsSequence: WarpEndsSequence | null };

function withEndsSequence(spec: WarpRow): WarpRef {
  return { ...spec, endsSequence: expandWarpSequence(spec.sequenceNote, warpSpecYarnLines(spec).map((l) => l.endsCount)) };
}

export interface EffectiveWeftYarn {
  sortOrder: number;
  letter: string;
  picksInRepeat: number;
  /** K6: renk seçici kanalı (kartın satırına aittir; varyant iplik değişimi kanalı değiştirmez); null = belirtilmemiş. */
  colorChannel: number | null;
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
    /** Atkı seçici sütunu: atkı başına 1-tabanlı iplik satırı no (`sequenceCode` açılımı); kod yoksa/geçersizse null. */
    pickSequence: number[] | null;
  } | null;
  weaveDesign: EffectiveWeaveDesign | null;
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
        message: `Rapordaki atkı (${total}) ÷ rapor boyu (${qtyText(d.repeatCm)} cm) = ${pctText(implied)} atkı/cm; kartın sıklığı ${declared} — fark %${pctText(REPEAT_PICKS_TOLERANCE_PCT)}'ten büyük.`,
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

/** "Bu varyantta şu sıradaki atkı ipliği ne?" — değişim yoksa null (kart ipliği geçerli). Etkin yapı + maliyet derleyicisi TEK cevap. */
export function weftOverrideFor<T>(overrides: ReadonlyMap<number, T> | undefined, sortOrder: number): T | null {
  return overrides?.get(sortOrder) ?? null;
}

/** Maliyet derleyicisi (F2): N varyantın atkı değişimleri TEK sorguda — varyant → (sıra → iplik). */
export async function readWeftOverridesForRecipes(db: Db, recipeIds: string[]): Promise<Map<string, Map<number, YarnRef>>> {
  const out = new Map<string, Map<number, YarnRef>>();
  if (!recipeIds.length) return out;
  const rows = await db.productRecipeWeftYarn.findMany({
    where: { recipeId: { in: recipeIds } }, select: { recipeId: true, weftSortOrder: true, yarnItem: { select: YARN_SELECT } },
  });
  for (const r of rows) out.set(r.recipeId, (out.get(r.recipeId) ?? new Map<number, YarnRef>()).set(r.weftSortOrder, r.yarnItem));
  return out;
}

/**
 * Ürünün (varyant verilirse varyant değişimi uygulanmış) etkin yapısı. Varyant başka ürüne aitse 400;
 * ürün/varyant yoksa 404. Maliyet derleyicisi, Dokuma İş Emri ön dolgusu, üretim önerisi ve tablet
 * iş kartı yapıyı YALNIZ buradan okur.
 */
export async function resolveEffectiveConstruction(
  db: Db, itemId: string, recipeId?: string | null, pin?: ConstructionPin,
): Promise<EffectiveConstruction> {
  const item = await db.item.findUnique({ where: { id: itemId }, select: ITEM_CONSTRUCTION_SELECT });
  if (!item) throw AppError.notFound("Ürün bulunamadı.");
  // İş emri kendi kartını taşır (kart sonradan değişse/ürün başka karta geçse de); kart İÇERİĞİ canlıdır.
  if (pin?.weftSpecId && pin.weftSpecId !== item.weftSpec?.id) {
    item.weftSpec = await db.weftSpec.findUnique({ where: { id: pin.weftSpecId }, select: WEFT_SELECT });
  }
  if (pin?.weaveDesignId && pin.weaveDesignId !== item.weaveDesign?.id) {
    item.weaveDesign = await db.weaveDesign.findUnique({ where: { id: pin.weaveDesignId }, select: DESIGN_SELECT });
  }
  let variantCode: string | null = null;
  const overrides = new Map<number, YarnRef>();
  if (recipeId) {
    const recipe = await db.productRecipe.findUnique({
      where: { id: recipeId },
      select: { itemId: true, variantCode: true, weftYarnOverrides: { select: { weftSortOrder: true, yarnItem: { select: YARN_SELECT } } } },
    });
    if (!recipe) throw AppError.notFound("Varyant (ürün şablonu) bulunamadı.");
    if (recipe.itemId !== itemId) throw AppError.badRequest("Varyant bu ürüne ait değil.", { code: "RECIPE_ITEM_MISMATCH" });
    variantCode = recipe.variantCode;
    for (const o of recipe.weftYarnOverrides) overrides.set(o.weftSortOrder, o.yarnItem);
  }
  const ws = item.weftSpec;
  const yarns: EffectiveWeftYarn[] = (ws?.yarns ?? []).map((y) => {
    const swap = weftOverrideFor(overrides, y.sortOrder);
    return {
      sortOrder: y.sortOrder,
      letter: weftLetter(y.sortOrder),
      picksInRepeat: y.picksInRepeat,
      colorChannel: y.colorChannel,
      yarnItem: swap ?? y.yarnItem,
      cardYarnItem: swap ? y.yarnItem : null,
    };
  });
  const base: Omit<EffectiveConstruction, "warnings"> = {
    itemId: item.id,
    recipeId: recipeId ?? null,
    variantCode,
    widthCm: item.widthCm,
    groundWarp: item.warpSpec ? withEndsSequence(item.warpSpec) : null,
    warpLayers: item.warpLayers.map((l) => ({ role: l.role, beamMode: l.beamMode, sortOrder: l.sortOrder, warpSpec: withEndsSequence(l.warpSpec) })),
    weft: ws
      ? {
        weftSpecId: ws.id, code: ws.code, name: ws.name, picksPerCm: ws.picksPerCm, sequenceCode: ws.sequenceCode,
        weftProgramNo: ws.weftProgramNo, picksInRepeatTotal: yarns.reduce((s, y) => s + y.picksInRepeat, 0), yarns,
        pickSequence: expandWeftSequence(ws.sequenceCode, yarns.length, LIFT_PLAN_MAX_PICKS),
      }
      : null,
    weaveDesign: effectiveWeaveDesign(item.weaveDesign),
  };
  // En sırası (mamul ≤ ham ≤ tarak) uyarısı ürün penceresiyle AYNI helper'dan.
  const widthWarnings = widthOrderWarnings({ finishedWidthCm: item.widthCm, rawWidthCm: item.rawWidthCm, reedWidthCm: item.warpSpec?.reedWidthCm });
  return { ...base, warnings: [...constructionWarnings(base), ...widthWarnings] };
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

const COST_LAYER_SELECT = {
  itemId: true, role: true, beamMode: true,
  warpSpec: { select: { id: true, takeUpPct: true, wastePct: true, ...WARP_SPEC_YARN_DENIER_SELECT } },
} satisfies Prisma.ItemWarpLayerSelect;
export type CostWarpLayerRow = Prisma.ItemWarpLayerGetPayload<{ select: typeof COST_LAYER_SELECT }>;

/** SY-B1: maliyet derleyicisinin ek çözgü katmanları — N ürün için TEK sorgu, ürün başına sıralı. */
export async function readWarpLayersForItems(db: Db, itemIds: string[]): Promise<Map<string, CostWarpLayerRow[]>> {
  const out = new Map<string, CostWarpLayerRow[]>();
  if (!itemIds.length) return out;
  const rows = await db.itemWarpLayer.findMany({ where: { itemId: { in: itemIds } }, select: COST_LAYER_SELECT, orderBy: [{ itemId: "asc" }, { sortOrder: "asc" }] });
  for (const r of rows) out.set(r.itemId, [...(out.get(r.itemId) ?? []), r]);
  return out;
}

/**
 * SY-B1 SHARED_BEAM: topun ürününde zemin leventine sarılı tel grupları (zemin kartı + grupların
 * take-up'ı). Ortak grup yoksa null — levent tüketimi bugünkü gibi (bayt-aynı).
 */
export async function readSharedBeamGroupsForRoll(db: Db, rollId: string): Promise<{ groundWarpSpecId: string; layers: Array<{ beamMode: string; takeUpPct: Prisma.Decimal | null }> } | null> {
  const rows = await sequentialTx(db).itemWarpLayer.findMany({
    where: { beamMode: "SHARED_BEAM", item: { rolls: { some: { id: rollId } }, warpSpecId: { not: null } } },
    select: { beamMode: true, warpSpec: { select: { takeUpPct: true } }, item: { select: { warpSpecId: true } } },
    orderBy: { sortOrder: "asc" },
  });
  const ground = rows[0]?.item.warpSpecId;
  return ground ? { groundWarpSpecId: ground, layers: rows.map((r) => ({ beamMode: r.beamMode, takeUpPct: r.warpSpec.takeUpPct })) } : null;
}

/** Devere D4a: ana kartı zemin kullanan kumaşlarda AYNI LEVENT (SHARED_BEAM) katmanı olan aktif kartlar (ek tel grubu önerisi). */
export async function readSharedBeamSpecsForGround(db: Pick<Db, "itemWarpLayer">, warpSpecId: string): Promise<Array<{ id: string; code: string; name: string }>> {
  const rows = await db.itemWarpLayer.findMany({
    where: { item: { warpSpecId }, beamMode: "SHARED_BEAM", warpSpecId: { not: warpSpecId }, warpSpec: { isActive: true } },
    select: { warpSpec: { select: { id: true, code: true, name: true } } },
    orderBy: [{ warpSpec: { code: "asc" } }],
  });
  return rows.map((r) => r.warpSpec);
}

/** Devere D4a: verilen kartların, ana kartı zemin kullanan kumaşlardaki katman kipleri (ek tel grubu kapısı). */
export async function readLayerModesOnGround(db: Pick<Db, "itemWarpLayer">, warpSpecId: string, specIds: string[]): Promise<Array<{ beamMode: string; specId: string; specCode: string; itemCode: string }>> {
  if (specIds.length === 0) return [];
  const rows = await db.itemWarpLayer.findMany({
    where: { item: { warpSpecId }, warpSpecId: { in: specIds } },
    select: { beamMode: true, warpSpecId: true, warpSpec: { select: { code: true } }, item: { select: { code: true } } },
    orderBy: [{ warpSpecId: "asc" }, { itemId: "asc" }],
  });
  return rows.map((r) => ({ beamMode: r.beamMode, specId: r.warpSpecId, specCode: r.warpSpec.code, itemCode: r.item.code }));
}
