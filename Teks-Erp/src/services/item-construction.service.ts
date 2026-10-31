// =============================================================================
// ÜRÜN YAPISI YAZICILARI — ek çözgü katmanları + varyant atkı ipliği değişimi (Seyitoğlu SY-A2)
// =============================================================================
// İkisi de ③b SAF YAPILANDIRMA PİVOTU: küme REPLACE edilir, audit'e eski/yeni küme yazılır;
// okuma yalnız `helpers/effective-construction.helper.ts`ten (K3). Varyant değişimi atkı kartı
// satırının SIRASINA bağlıdır; kart satırı kalkarsa sahipsiz kalır — iki yazar da kart satırını
// `FOR UPDATE` ile kilitleyip karşı koşulu tx içinde ölçer (`WEFT_OVERRIDE_ORPHAN`).
// =============================================================================
import { ItemType, WarpBeamMode, WarpLayerRole } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { assertItemUsable } from "./helpers/item-usage.helper";
import {
  readItemWarpLayers,
  readRecipeWeftOverrides,
  resolveEffectiveConstruction,
  type EffectiveConstruction,
} from "./helpers/effective-construction.helper";
import { weftLetter } from "./helpers/weft-sequence.helper";

export interface WarpLayerInput {
  warpSpecId: string;
  role: WarpLayerRole;
  beamMode?: WarpBeamMode;
}

export interface WeftOverrideInput {
  weftSortOrder: number;
  yarnItemId: string;
}

export async function getEffectiveConstruction(itemId: string, recipeId?: string): Promise<EffectiveConstruction> {
  return resolveEffectiveConstruction(prisma, itemId, recipeId ?? null);
}

/** Ek çözgü katmanları: zemin dolu olmalı, katman zeminle/birbiriyle aynı kart olamaz, kart aktif. */
export async function replaceItemWarpLayers(itemId: string, layers: WarpLayerInput[], userId?: string): Promise<EffectiveConstruction> {
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { id: true, itemType: true, warpSpecId: true } });
  if (!item) throw AppError.notFound("Ürün bulunamadı.");
  if (item.itemType !== ItemType.FABRIC) throw AppError.badRequest("Çözgü katmanı yalnız KUMAŞ kartına bağlanır.", { code: "ITEM_WARP_SPEC_FABRIC_ONLY" });
  if (layers.length > 0 && !item.warpSpecId) {
    throw AppError.badRequest("Ürünün zemin çözgü kartı seçilmeden ek çözgü katmanı yazılamaz.", { code: "WARP_LAYER_GROUND_MISSING" });
  }
  const ids = layers.map((l) => l.warpSpecId);
  if (ids.includes(item.warpSpecId ?? "")) {
    throw AppError.badRequest("Ek çözgü katmanı zemin çözgü kartıyla aynı olamaz.", { code: "WARP_LAYER_DUPLICATES_GROUND" });
  }
  if (new Set(ids).size !== ids.length) throw AppError.badRequest("Aynı çözgü kartı iki katmana yazılamaz.");
  if (ids.length > 0) {
    const n = await prisma.warpSpec.count({ where: { id: { in: ids }, isActive: true } });
    if (n !== ids.length) throw AppError.badRequest("Çözgü kartlarından biri bulunamadı ya da pasif.", { code: "WARP_SPEC_NOT_FOUND" });
  }
  const before = await readItemWarpLayers(prisma, itemId);
  await prisma.$transaction(async (tx) => {
    await tx.itemWarpLayer.deleteMany({ where: { itemId } });
    if (layers.length > 0) {
      await tx.itemWarpLayer.createMany({
        data: layers.map((l, i) => ({ itemId, warpSpecId: l.warpSpecId, role: l.role, beamMode: l.beamMode ?? WarpBeamMode.SEPARATE_BEAM, sortOrder: i })),
      });
    }
  });
  const after = await readItemWarpLayers(prisma, itemId);
  await AuditService.log({ userId, action: "UPDATE", tableName: "ITEM", recordId: itemId, oldData: { warpLayers: before }, newData: { warpLayers: after } });
  return resolveEffectiveConstruction(prisma, itemId, null);
}

async function assertOverrideYarns(rows: WeftOverrideInput[]): Promise<void> {
  for (const r of rows) {
    const yarn = await prisma.item.findUnique({ where: { id: r.yarnItemId }, select: { id: true, name: true, itemType: true, linearDensityDen: true } });
    if (!yarn) throw AppError.badRequest("Değişim ipliği bulunamadı.");
    if (yarn.itemType !== ItemType.YARN) throw AppError.badRequest(`"${yarn.name}" bir İPLİK kalemi değil.`);
    if (yarn.linearDensityDen === null) throw AppError.badRequest(`"${yarn.name}" kaleminin denye değeri boş — kalem kartından girin.`);
    await assertItemUsable(prisma, yarn.id, "DEFINITION");
  }
}

/** Varyantın atkı ipliği değişimleri (REPLACE). Pay/sıklık değişmez; sıra kartta var olmalı. */
export async function replaceRecipeWeftOverrides(recipeId: string, rows: WeftOverrideInput[], userId?: string): Promise<EffectiveConstruction> {
  const recipe = await prisma.productRecipe.findUnique({ where: { id: recipeId }, select: { id: true, itemId: true, item: { select: { weftSpecId: true } } } });
  if (!recipe) throw AppError.notFound("Varyant (ürün şablonu) bulunamadı.");
  const weftSpecId = recipe.item.weftSpecId;
  if (rows.length > 0 && !weftSpecId) throw AppError.badRequest("Ürünün atkı kartı bağlı değil — atkı ipliği değişimi yazılamaz.", { code: "RECIPE_ITEM_NO_WEFT_SPEC" });
  if (new Set(rows.map((r) => r.weftSortOrder)).size !== rows.length) throw AppError.badRequest("Aynı atkı sırası iki kez değiştirilemez.");
  await assertOverrideYarns(rows);
  const before = await readRecipeWeftOverrides(prisma, recipeId);
  await prisma.$transaction(async (tx) => {
    if (weftSpecId) {
      // Kart satır kümesini kilitle: eşzamanlı kart replace'i ile sıra ölçümü yarışmasın.
      await tx.$queryRaw`SELECT id FROM weft_specs WHERE id = ${weftSpecId}::uuid FOR UPDATE`;
      const card = await tx.weftSpecYarn.findMany({ where: { weftSpecId }, select: { sortOrder: true, yarnItemId: true } });
      const bySort = new Map(card.map((c) => [c.sortOrder, c.yarnItemId]));
      for (const r of rows) {
        const cardYarn = bySort.get(r.weftSortOrder);
        if (cardYarn === undefined) {
          throw AppError.badRequest(`Atkı kartında ${weftLetter(r.weftSortOrder)} sırası yok.`, { code: "WEFT_OVERRIDE_SORT_UNKNOWN" });
        }
        if (cardYarn === r.yarnItemId) throw AppError.badRequest(`${weftLetter(r.weftSortOrder)} sırasının ipliği zaten bu — değişim gerekmez.`);
      }
    }
    await tx.productRecipeWeftYarn.deleteMany({ where: { recipeId } });
    if (rows.length > 0) {
      await tx.productRecipeWeftYarn.createMany({ data: rows.map((r) => ({ recipeId, weftSortOrder: r.weftSortOrder, yarnItemId: r.yarnItemId })) });
    }
  });
  const after = await readRecipeWeftOverrides(prisma, recipeId);
  await AuditService.log({ userId, action: "UPDATE", tableName: "PRODUCT_RECIPE", recordId: recipeId, oldData: { weftYarnOverrides: before }, newData: { weftYarnOverrides: after } });
  return resolveEffectiveConstruction(prisma, recipe.itemId, recipeId);
}
