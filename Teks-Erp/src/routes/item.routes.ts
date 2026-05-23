// =============================================================================
// TeksERP - Item (Stok Kartı) Routes
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { BaseController } from "../controllers/base.controller";
import { ItemService } from "../services/item.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import "../types/express-augment";

const service = new ItemService({
  modelName: "item",
  tableName: "ITEM",
  searchFields: ["code", "name"],
  defaultInclude: {
    allowedColors: { include: { color: true } },
    allowedProperties: { include: { property: true } },
  },
});

const controller = new BaseController(service);
const router = Router();

const addAllowedColorBody = z.object({
  colorId: z.string().uuid("Geçersiz renk ID"),
});
const addAllowedPropertyBody = z.object({
  propertyId: z.string().uuid("Geçersiz özellik ID"),
});

/**
 * @openapi
 * /api/items:
 *   get:
 *     tags: [Items]
 *     summary: Stok kartı listesi
 *     description: Tüm ürünleri filtre, sıralama ve sayfalama ile listeler.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, default: createdAt }
 *       - in: query
 *         name: sortOrder
 *         schema: { type: string, enum: [asc, desc], default: desc }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Kod veya isimde arama
 *       - in: query
 *         name: filter[itemType]
 *         schema: { type: string, enum: [YARN, WARP, FABRIC, CONSUMABLE] }
 *       - in: query
 *         name: filter[isActive]
 *         schema: { type: string, enum: [true, false] }
 *     responses:
 *       200:
 *         description: Sayfalanmış ürün listesi
 *       401:
 *         description: Yetkisiz erişim
 */
router.get("/", verifyToken, requirePermission("item:read"), controller.findAll);

/**
 * @openapi
 * /api/items/{id}:
 *   get:
 *     tags: [Items]
 *     summary: Stok kartı detayı
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Ürün detayı
 *       404:
 *         description: Kayıt bulunamadı
 */
router.get("/:id", verifyToken, requirePermission("item:read"), controller.findById);

/**
 * @openapi
 * /api/items:
 *   post:
 *     tags: [Items]
 *     summary: Yeni stok kartı oluştur
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, name, itemType]
 *             properties:
 *               code: { type: string, example: "MAM-010" }
 *               name: { type: string, example: "Boyalı Saten Kumaş" }
 *               itemType: { type: string, enum: [YARN, WARP, RAW_FABRIC, DYED_FABRIC, CONSUMABLE] }
 *               unit: { type: string, default: "MT" }
 *     responses:
 *       201:
 *         description: Ürün oluşturuldu
 *       409:
 *         description: Kod zaten mevcut
 */
router.post("/", verifyToken, requirePermission("item:write"), controller.create);

/**
 * @openapi
 * /api/items/{id}:
 *   patch:
 *     tags: [Items]
 *     summary: Stok kartını güncelle
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               unit: { type: string }
 *     responses:
 *       200:
 *         description: Güncellendi
 */
router.patch("/:id", verifyToken, requirePermission("item:write"), controller.update);

/**
 * @openapi
 * /api/items/{id}:
 *   delete:
 *     tags: [Items]
 *     summary: Stok kartını pasife al
 *     description: Fiziksel silme yapılmaz, isActive=false yapılır.
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
router.delete("/:id", verifyToken, requirePermission("item:write"), controller.remove);

/**
 * @openapi
 * /api/items/{id}/permanent:
 *   delete:
 *     tags: [Items]
 *     summary: Stok kartını kalıcı olarak sil
 *     description: Veriyi veritabanından tamamen kaldırır. Bu işlem geri alınamaz.
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
router.delete("/:id/permanent", verifyToken, requirePermission("item:write"), controller.hardRemove);

/**
 * @openapi
 * /api/items/{id}/allowed-colors:
 *   post:
 *     tags: [Items]
 *     summary: Ürüne tek bir izinli renk ekle
 *     description: Mevcut ise idempotent — yeni satır oluşturulmaz, başarı döner.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [colorId]
 *             properties:
 *               colorId: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Eklendi veya zaten dahil
 */
router.post(
  "/:id/allowed-colors",
  verifyToken,
  requirePermission("item:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { colorId } = addAllowedColorBody.parse(req.body);
      const result = await service.addAllowedColor(
        String(req.params.id),
        colorId,
        req.user?.userId,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/items/{id}/allowed-properties:
 *   post:
 *     tags: [Items]
 *     summary: Ürüne tek bir izinli özellik ekle
 *     description: Mevcut ise idempotent.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [propertyId]
 *             properties:
 *               propertyId: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Eklendi veya zaten dahil
 */
router.post(
  "/:id/allowed-properties",
  verifyToken,
  requirePermission("item:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { propertyId } = addAllowedPropertyBody.parse(req.body);
      const result = await service.addAllowedProperty(
        String(req.params.id),
        propertyId,
        req.user?.userId,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
