// =============================================================================
// TeksERP — Ürün Yapısı (etkin yapı + ek çözgü katmanı + varyant atkı değişimi) · Seyitoğlu SY-A2
// =============================================================================
// ⚠️ ÜÇ KAPI SIRAYLA: `verifyToken` → `requireDokumaEnabled` (TOPLU) → `requirePermission`.
// Okuma `warpspec:read`; katman yazımı `item:write` + `warpspec:write` (tasarım §3.7); varyant
// değişimi mevcut iş emri şablonu izni `station:write` + `warpspec:write`. Yeni izin kodu yok.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireDokumaEnabled } from "../middlewares/module.middleware";
import { WARP_BEAM_MODES, WARP_LAYER_ROLES } from "../constants/weave-design";
import {
  getEffectiveConstruction,
  replaceItemWarpLayers,
  replaceRecipeWeftOverrides,
} from "../services/item-construction.service";

const router = Router();
router.use(verifyToken, requireDokumaEnabled);

type H = (req: Request, res: Response) => Promise<void>;
const wrap = (h: H) => (req: Request, res: Response, next: NextFunction): void => {
  h(req, res).catch(next);
};
const itemParam = z.object({ itemId: z.string().uuid("Geçersiz ürün ID") });
const recipeParam = z.object({ recipeId: z.string().uuid("Geçersiz şablon ID") });
const constructionQuery = z.object({ recipeId: z.string().uuid("Geçersiz şablon ID").optional() }).strict();
const warpLayersBody = z.object({
  layers: z.array(z.object({
    warpSpecId: z.string().uuid("Geçersiz çözgü kartı ID"),
    role: z.enum(WARP_LAYER_ROLES, { message: "Katman rolü LENO/SECONDARY olmalı" }),
    beamMode: z.enum(WARP_BEAM_MODES, { message: "Sarım biçimi SEPARATE_BEAM/SHARED_BEAM/CREEL olmalı" }).optional(),
  }).strict()).max(8, "En çok 8 ek çözgü katmanı"),
}).strict();
const weftOverridesBody = z.object({
  overrides: z.array(z.object({
    weftSortOrder: z.number().int().min(0, "Atkı sırası 0 ya da büyük olmalı").max(25, "Atkı sırası en çok Z (25)"),
    yarnItemId: z.string().uuid("Geçersiz iplik ID"),
  }).strict()).max(26),
}).strict();

/**
 * @openapi
 * /api/item-construction/{itemId}:
 *   get:
 *     tags: [ItemConstruction]
 *     summary: Ürünün (varyant verilirse varyant değişimi uygulanmış) etkin yapısı + tutarlılık uyarıları
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: itemId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: recipeId, required: false, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Etkin yapı }
 *       400: { description: Varyant bu ürüne ait değil (RECIPE_ITEM_MISMATCH) }
 *       404: { description: Ürün ya da varyant yok }
 */
router.get("/:itemId", requirePermission("warpspec:read"), wrap(async (req, res) => {
  const { itemId } = itemParam.parse(req.params);
  const { recipeId } = constructionQuery.parse(req.query);
  res.status(200).json({ success: true, data: await getEffectiveConstruction(itemId, recipeId) });
}));

/**
 * @openapi
 * /api/item-construction/{itemId}/warp-layers:
 *   put:
 *     tags: [ItemConstruction]
 *     summary: Ek çözgü katmanlarını değiştir (küme replace; zemin Item.warpSpecId'de kalır)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: itemId, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Güncel etkin yapı }
 *       400: { description: Zemin yok / zeminle aynı kart (WARP_LAYER_DUPLICATES_GROUND) / pasif kart }
 */
router.put("/:itemId/warp-layers", requirePermission("item:write"), requirePermission("warpspec:write"), wrap(async (req, res) => {
  const { itemId } = itemParam.parse(req.params);
  const { layers } = warpLayersBody.parse(req.body ?? {});
  res.status(200).json({ success: true, data: await replaceItemWarpLayers(itemId, layers, req.user?.userId), message: "Çözgü katmanları güncellendi." });
}));

/**
 * @openapi
 * /api/item-construction/recipes/{recipeId}/weft-yarns:
 *   put:
 *     tags: [ItemConstruction]
 *     summary: Varyantın atkı ipliği değişimlerini değiştir (küme replace; pay/sıklık kartta kalır)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: recipeId, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Varyantın güncel etkin yapısı }
 *       400: { description: Kartta olmayan sıra (WEFT_OVERRIDE_SORT_UNKNOWN) / iplik değil / atkı kartı yok }
 */
router.put("/recipes/:recipeId/weft-yarns", requirePermission("station:write"), requirePermission("warpspec:write"), wrap(async (req, res) => {
  const { recipeId } = recipeParam.parse(req.params);
  const { overrides } = weftOverridesBody.parse(req.body ?? {});
  res.status(200).json({ success: true, data: await replaceRecipeWeftOverrides(recipeId, overrides, req.user?.userId), message: "Varyant atkı değişimleri güncellendi." });
}));

export default router;
