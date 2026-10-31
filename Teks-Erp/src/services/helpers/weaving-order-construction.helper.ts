// =============================================================================
// DOKUMA İŞ EMRİ — etkin yapı seçimi (atkı kartı · desen kartı · varyant) (Seyitoğlu SY-A4)
// =============================================================================
// İş emri doğuşta seçimini TAŞIR (tasarım §2.4): gövde vermezse atkı/desen kartı ürünün ETKİN
// YAPISINDAN dolar — `resolveEffectiveConstruction` (K3 tek kaynak); ürün kartı burada doğrudan
// okunmaz (`test_etkin_yapi_tek_kaynak` §2). Sonradan kart değişirse iş emri DEĞİŞMEZ.
// Yapısız üründe üç alan null kalır → DTO/audit anahtarları hiç çizilmez (bayt-aynı yanıt).
// =============================================================================
import type { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { resolveEffectiveConstruction } from "./effective-construction.helper";

type Db = Prisma.TransactionClient | typeof prisma;

export interface WeavingConstructionInput {
  weftSpecId?: string | null;
  weaveDesignId?: string | null;
  recipeId?: string | null;
}

export interface WeavingConstructionChoice {
  weftSpecId: string | null;
  weaveDesignId: string | null;
  recipeId: string | null;
}

/** Yalnız GÖNDERİLEN alanlar (`undefined` = dokunma; `""` = null). */
export function normalizeConstructionInput(input: WeavingConstructionInput): WeavingConstructionInput {
  const out: WeavingConstructionInput = {};
  if (input.weftSpecId !== undefined) out.weftSpecId = input.weftSpecId || null;
  if (input.weaveDesignId !== undefined) out.weaveDesignId = input.weaveDesignId || null;
  if (input.recipeId !== undefined) out.recipeId = input.recipeId || null;
  return out;
}

/** Açıkça seçilen kartların varlığı/aktifliği + varyantın bu ürüne aitliği — FK 500'ü yerine 400. */
export async function assertConstructionRefs(db: Db, itemId: string, c: WeavingConstructionInput): Promise<void> {
  if (c.weftSpecId && (await db.weftSpec.count({ where: { id: c.weftSpecId, isActive: true } })) === 0) {
    throw AppError.badRequest("Atkı kartı bulunamadı ya da pasif", { code: "WEFT_SPEC_NOT_USABLE" });
  }
  if (c.weaveDesignId && (await db.weaveDesign.count({ where: { id: c.weaveDesignId, isActive: true } })) === 0) {
    throw AppError.badRequest("Desen kartı bulunamadı ya da pasif", { code: "WEAVE_DESIGN_NOT_USABLE" });
  }
  if (c.recipeId) {
    const r = await db.productRecipe.findUnique({ where: { id: c.recipeId }, select: { itemId: true, isActive: true } });
    if (!r || !r.isActive) throw AppError.badRequest("Varyant (ürün şablonu) bulunamadı ya da pasif", { code: "RECIPE_NOT_USABLE" });
    if (r.itemId !== itemId) throw AppError.badRequest("Varyant bu ürüne ait değil.", { code: "RECIPE_ITEM_MISMATCH" });
  }
}

/** Düzenleme: gönderilen kartlar + varyant; ürün değişip varyant gövdede yoksa KALAN varyant da yeni ürüne ölçülür. */
export async function assertConstructionPatch(db: Db, itemId: string, patch: WeavingConstructionInput, keptRecipeId: string | null): Promise<void> {
  await assertConstructionRefs(db, itemId, { ...patch, recipeId: patch.recipeId !== undefined ? patch.recipeId : keptRecipeId });
}

/**
 * Doğuş seçimi: gönderilen alan aynen (null = açıkça "kartsız"); gönderilmeyen atkı/desen kartı etkin
 * yapıdan ÖNERİ olarak dolar. Varyant hiçbir zaman türetilmez (seçim kullanıcının).
 */
export async function resolveWeavingConstructionChoice(db: Db, itemId: string, raw: WeavingConstructionInput): Promise<WeavingConstructionChoice> {
  const c = normalizeConstructionInput(raw);
  await assertConstructionRefs(db, itemId, c);
  const recipeId = c.recipeId ?? null;
  if (c.weftSpecId !== undefined && c.weaveDesignId !== undefined) {
    return { weftSpecId: c.weftSpecId, weaveDesignId: c.weaveDesignId, recipeId };
  }
  const eff = await resolveEffectiveConstruction(db, itemId, recipeId);
  return {
    weftSpecId: c.weftSpecId !== undefined ? c.weftSpecId : eff.weft?.weftSpecId ?? null,
    weaveDesignId: c.weaveDesignId !== undefined ? c.weaveDesignId : eff.weaveDesign?.id ?? null,
    recipeId,
  };
}
