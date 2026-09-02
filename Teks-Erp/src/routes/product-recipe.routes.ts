// =============================================================================
// TeksERP - ProductRecipe (Üretim Reçetesi) Routes
// =============================================================================
// Ürün + renk + özellik + en + rota'yı tek isim/kod altında paketler. İş emri
// açılışında seçilince hedef alanlar + rota otomatik dolar. Rotanın ÜSTÜNDE
// ayrı katman; rota tekrar-kullanılabilir kalır.

import { Router } from "express";
import { BaseController } from "../controllers/base.controller";
import { ProductRecipeService } from "../services/product-recipe.service";
import { recipeHardRemove } from "../services/helpers/guarded-hard-remove";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireProductionEnabled } from "../middlewares/module.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";

export const productRecipeService = new ProductRecipeService({
  modelName: "productRecipe",
  tableName: "PRODUCT_RECIPE",
  searchFields: ["name"],
  codeSearchFields: ["code"],
  nestedCreateFields: ["properties"],
  duplicateNameField: "name",
  entityLabel: "iş emri şablonu",
  defaultInclude: {
    item: { select: { id: true, code: true, name: true } },
    color: { select: { id: true, code: true, name: true, hex: true } },
    route: { select: { id: true, code: true, name: true } },
    properties: {
      include: { property: { select: { id: true, code: true, name: true } } },
    },
  },
  uniqueField: "code",
  // Kod backend-authoritative: `REC+GGAAYY+NNNN` günlük sıralı (istemci kodu yok sayılır).
  autoCode: { prefix: "REC" },
});

const controller = new BaseController(productRecipeService);
const router = Router();

// Modül kapısı — bu router'daki HER uç için (2026-09-02).
// ⚠️ Kapı `verifyToken`dan SONRA: kimliksiz istek 401 almalı, 403 değil
// (403 "kaynak var ama modül kapalı" bilgisini kimliksiz kişiye sızdırırdı).
// ⚠️ `router.use` ile TOPLU: uç uç yazılırsa biri unutulur ve unutulan uç
// sessizce açık kalır. Sıra da load-bearing — bu satırdan ÖNCE tanımlanan bir
// uç kapıyı HİÇ görmez (Express kayıt sırası; hata da log da üretmez).
router.use(verifyToken, requireProductionEnabled);

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
// BENZER KAYITLAR — mükerreri REDDETMEK yerine ÖNLEMEK için (2026-08-19).
// ⚠️ `/:id`den ÖNCE tanımlı olmalı; sonra gelirse Express "similar-names"i id
// sanar ve `uuid-param` middleware'i 400 döndürür.
// ⚠️ İzin WRITE: bu uç var olan adları listeler ve yalnız KAYIT AÇAN kişiye
// lazımdır; okuma iznine bakmak görünürlüğü gereksiz genişletirdi.
router.get("/similar-names", verifyToken, requirePermission("station:write"), controller.similarNames);

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

// ProductRecipe hard-delete — guard'lı kalıcı silme; iskelet + konfig
// services/helpers/guarded-hard-remove.ts'te (üç /permanent ucunun tek kaynağı).

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
