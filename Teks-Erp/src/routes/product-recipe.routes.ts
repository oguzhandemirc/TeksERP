// =============================================================================
// TeksERP - ProductRecipe (Üretim Reçetesi) Routes
// =============================================================================
// Ürün + renk + özellik + en + rota'yı tek isim/kod altında paketler. İş emri
// açılışında seçilince hedef alanlar + rota otomatik dolar. Rotanın ÜSTÜNDE
// ayrı katman; rota tekrar-kullanılabilir kalır.

import { Router } from "express";
import { Request, Response, NextFunction } from "express";
import { BaseController } from "../controllers/base.controller";
import { ProductRecipeService } from "../services/product-recipe.service";
import prisma from "../lib/prisma";
import { AuditService } from "../services/audit.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";

const service = new ProductRecipeService({
  modelName: "productRecipe",
  tableName: "PRODUCT_RECIPE",
  searchFields: ["code", "name"],
  nestedCreateFields: ["properties"],
  defaultInclude: {
    item: { select: { id: true, code: true, name: true } },
    color: { select: { id: true, code: true, name: true, hex: true } },
    route: { select: { id: true, code: true, name: true } },
    properties: {
      include: { property: { select: { id: true, code: true, name: true } } },
    },
  },
  uniqueField: "code",
});

const controller = new BaseController(service);
const router = Router();

/**
 * @openapi
 * /api/product-recipes:
 *   get:
 *     tags: [ProductRecipes]
 *     summary: Üretim reçetesi listesi
 *     description: Ürün + renk + özellik + rota reçetelerini ilişkileriyle listeler.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: filter[isActive]
 *         schema: { type: string, enum: [true, false] }
 *     responses:
 *       200:
 *         description: Reçete listesi
 */
router.get("/", verifyToken, requireAnyPermission("station:read", "mobile:hizli-is-emri"), controller.findAll);

/**
 * @openapi
 * /api/product-recipes/{id}:
 *   get:
 *     tags: [ProductRecipes]
 *     summary: Reçete detayı
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Reçete detayı (ürün/renk/özellik/rota dahil)
 *       404:
 *         description: Kayıt bulunamadı
 */
router.get("/:id", verifyToken, requireAnyPermission("station:read", "mobile:hizli-is-emri"), controller.findById);

/**
 * @openapi
 * /api/product-recipes:
 *   post:
 *     tags: [ProductRecipes]
 *     summary: Yeni reçete oluştur
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, name, itemId]
 *             properties:
 *               code: { type: string, example: "PATOS-GRI-038" }
 *               name: { type: string, example: "Patos Gri 038" }
 *               itemId: { type: string, format: uuid }
 *               colorId: { type: string, format: uuid, nullable: true }
 *               routeId: { type: string, format: uuid, nullable: true }
 *               width: { type: number, nullable: true }
 *               foldType: { type: string, nullable: true }
 *               properties:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     propertyId: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Reçete oluşturuldu
 */
router.post("/", verifyToken, requirePermission("station:write"), controller.create);

/**
 * @openapi
 * /api/product-recipes/{id}:
 *   patch:
 *     tags: [ProductRecipes]
 *     summary: Reçete güncelle
 *     description: properties dizisi gönderilirse özellik M:N tamamen yeniden yazılır.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Güncellendi
 */
router.patch("/:id", verifyToken, requirePermission("station:write"), controller.update);

/**
 * @openapi
 * /api/product-recipes/{id}:
 *   delete:
 *     tags: [ProductRecipes]
 *     summary: Reçeteyi pasife al
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Pasife alındı
 */
router.delete("/:id", verifyToken, requirePermission("station:write"), controller.remove);

/**
 * ProductRecipe hard-delete — önce bağlı properties pivot'unu transaction içinde
 * siler (onDelete: Cascade'e ek güvence), ardından reçeteyi kalıcı kaldırır.
 */
async function recipeHardRemove(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = String(req.params.id);

    const recipe = await prisma.productRecipe.findUnique({ where: { id } });
    if (!recipe) {
      res.status(404).json({ success: false, data: null, message: "Reçete bulunamadı" });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.productRecipeProperty.deleteMany({ where: { recipeId: id } });
      await tx.productRecipe.delete({ where: { id } });
    });

    await AuditService.log({
      userId: req.user?.userId,
      action: "DELETE",
      tableName: "PRODUCT_RECIPE",
      recordId: id,
      oldData: recipe as Record<string, unknown>,
      newData: null,
    });

    res.status(200).json({
      success: true,
      data: recipe,
      message: "Reçete kalıcı olarak silindi",
    });
  } catch (error) {
    next(error);
  }
}

/**
 * @openapi
 * /api/product-recipes/{id}/permanent:
 *   delete:
 *     tags: [ProductRecipes]
 *     summary: Reçeteyi kalıcı olarak sil
 *     description: Reçete ve özellik bağları veritabanından tamamen kaldırılır. Geri alınamaz.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Kalıcı olarak silindi
 *       404:
 *         description: Kayıt bulunamadı
 */
router.delete("/:id/permanent", verifyToken, requirePermission("station:write"), recipeHardRemove);

export default router;
