// =============================================================================
// SATIR VARYANTI KAPISI — sipariş / teklif / fiyat listesi satırının `recipeId`si (SY-K1k, tasarım §12.4)
// =============================================================================
// Varyant (`ProductRecipe`) satırın ÜRÜNÜNE ait olmalı; değilse ya da yoksa 400 `RECIPE_ITEM_MISMATCH`.
// Yeni bağ pasif varyanta kurulamaz (400 `RECIPE_INACTIVE`); değişmeyen eski bağ yeniden sorgulanmaz.
// NULL = desen geneli (bugünkü davranış) — kapı hiç sorgu atmaz. Üç yazıcı da bu tek kapıdan geçer.
// =============================================================================
import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../../utils/app-error";

type Reader = Prisma.TransactionClient | PrismaClient;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Gövde okuyucu: `undefined` = gönderilmedi (dokunma), `null`/"" = desen geneli, aksi UUID ya da 400. */
export function readRecipeId(raw: unknown, label: string): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string" || !UUID_RE.test(raw)) throw AppError.badRequest(`${label} varyantı geçersiz.`);
  return raw;
}

export interface RecipeLinePair {
  itemId: string | null | undefined;
  recipeId: string;
  /** Satır etiketi ("2. kalem") — hata cümlesine girer. */
  label: string;
  /** Yeni kurulan bağ mı (pasif varyant reddedilir); değişmeyen bağda false. */
  isNew: boolean;
}

/** Varyant ↔ ürün tutarlılığı (fail-closed). Tek sorgu; çift yoksa sorgu atılmaz. */
export async function assertRecipesMatchItems(db: Reader, pairs: ReadonlyArray<RecipeLinePair>): Promise<void> {
  if (pairs.length === 0) return;
  const recipes = await db.productRecipe.findMany({
    where: { id: { in: [...new Set(pairs.map((p) => p.recipeId))] } },
    select: { id: true, itemId: true, isActive: true, code: true },
  });
  const byId = new Map(recipes.map((r) => [r.id, r]));
  for (const p of pairs) {
    const r = byId.get(p.recipeId);
    if (!r || !p.itemId || r.itemId !== p.itemId) {
      throw AppError.badRequest(`${p.label}: seçilen varyant bu ürüne ait değil.`, {
        code: "RECIPE_ITEM_MISMATCH",
        recipeId: p.recipeId,
        itemId: p.itemId ?? null,
      });
    }
    if (p.isNew && !r.isActive) {
      throw AppError.badRequest(`${p.label}: '${r.code}' varyantı pasif; yeni satırda seçilemez.`, {
        code: "RECIPE_INACTIVE",
        recipeId: p.recipeId,
      });
    }
  }
}

/** Okuma yüzeyi: satırın varyantı (kimlik + ekranda görünen ad). */
export const LINE_RECIPE_SELECT = { select: { id: true, code: true, name: true, variantCode: true } } as const;

/**
 * Sipariş satırı gövdelerinin varyantı (yerinde normalize + kapı). Gönderilmeyen `recipeId` mevcut satırda
 * KORUNUR ama ürün değiştiyse eski varyant yeni ürünle yine sınanır (sessiz uyumsuzluk yok).
 */
export async function prepareOrderLineRecipes(
  db: Reader,
  lines: unknown,
  current: ReadonlyArray<{ id: string; itemId: string; recipeId: string | null }> = [],
): Promise<void> {
  if (!Array.isArray(lines)) return;
  const currentById = new Map(current.map((l) => [l.id, l]));
  const pairs: RecipeLinePair[] = [];
  for (const [i, raw] of lines.entries()) {
    if (!raw || typeof raw !== "object") continue;
    const line = raw as Record<string, unknown>;
    const label = `${i + 1}. kalem`;
    const sent = readRecipeId(line.recipeId, label);
    if (sent !== undefined) line.recipeId = sent;
    const prev = typeof line.id === "string" ? currentById.get(line.id) : undefined;
    const recipeId = sent !== undefined ? sent : (prev?.recipeId ?? null);
    if (!recipeId) continue;
    const itemId = typeof line.itemId === "string" && line.itemId ? line.itemId : prev?.itemId;
    pairs.push({ itemId, recipeId, label, isNew: recipeId !== prev?.recipeId });
  }
  await assertRecipesMatchItems(db, pairs);
}
