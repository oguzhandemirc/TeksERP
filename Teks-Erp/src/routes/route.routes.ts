// =============================================================================
// TeksERP - Route (Üretim Rotası) Routes
// =============================================================================

import { Router } from "express";
import { BaseController } from "../controllers/base.controller";
import { RouteService } from "../services/route.service";
import { routeHardRemove } from "../services/helpers/guarded-hard-remove";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";

// RouteService: bare BaseService yerine — nested step ref'lerinin isActive + sequence
// soft-delete giriş guard'ı için (assertRouteRefsActive'in master-data CRUD karşılığı).
const service = new RouteService({
  modelName: "route",
  tableName: "ROUTE",
  searchFields: ["name"],
  nestedCreateFields: ["steps"],
  defaultInclude: {
    steps: {
      include: {
        station: {
          include: {
            defaultCategory: {
              select: {
                id: true,
                code: true,
                name: true,
                // Hızlı İş Emri "Gelişmiş" renk/özellik uygulaması, rotanın bu adımı
                // gerçekten uygulayıp uygulayamayacağını bu bayraklardan ölçer
                // (sadece kategori atanmış olması yetmez — appliesColor/Property gerekir).
                appliesColor: true,
                appliesProperty: true,
              },
            },
          },
        },
        // Saha #14: rota şablonunda saklı fason firması — istemci kayıtlı firmanın
        // adını ayrı sorgu olmadan gösterebilsin. (Scalar plannedSubcontractorId
        // zaten include ile dönüyor; bu yalnız adı ekler.)
        plannedSubcontractor: { select: { id: true, name: true } },
      },
      orderBy: { sequence: "asc" },
    },
  },
  uniqueField: "code",
});

const controller = new BaseController(service);
const router = Router();

/**
 * @openapi
 * /api/routes:
 *   get:
 *     tags: [Routes]
 *     summary: Üretim rotası listesi
 *     description: Tüm rotaları adımları ve istasyonları ile birlikte listeler.
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
 *         description: Rota listesi (adımlar dahil)
 */
router.get("/", verifyToken, requireAnyPermission("station:read", "mobile:hizli-is-emri"), controller.findAll);

/**
 * @openapi
 * /api/routes/{id}:
 *   get:
 *     tags: [Routes]
 *     summary: Rota detayı
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Rota detayı (adımlar dahil)
 *       404:
 *         description: Kayıt bulunamadı
 */
router.get("/:id", verifyToken, requirePermission("station:read"), controller.findById);

/**
 * @openapi
 * /api/routes:
 *   post:
 *     tags: [Routes]
 *     summary: Yeni rota oluştur
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, example: "Yeni Baskı Rotası" }
 *               steps:
 *                 type: object
 *                 description: Prisma nested create format
 *                 properties:
 *                   create:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         stationId: { type: string, format: uuid }
 *                         sequence: { type: integer }
 *     responses:
 *       201:
 *         description: Rota oluşturuldu
 */
router.post("/", verifyToken, requirePermission("station:write"), controller.create);

/**
 * @openapi
 * /api/routes/{id}:
 *   patch:
 *     tags: [Routes]
 *     summary: Rota güncelle
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
 * /api/routes/{id}:
 *   delete:
 *     tags: [Routes]
 *     summary: Rotayı pasife al
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

// Route hard-delete — guard'lı kalıcı silme; iskelet + guard listesi
// services/helpers/guarded-hard-remove.ts'te (üç /permanent ucunun tek kaynağı).

/**
 * @openapi
 * /api/routes/{id}/permanent:
 *   delete:
 *     tags: [Routes]
 *     summary: Rotayı kalıcı olarak sil
 *     description: Rota adımları dahil veriyi veritabanından tamamen kaldırır. Bu işlem geri alınamaz.
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
router.delete("/:id/permanent", verifyToken, requirePermission("station:write"), routeHardRemove);

export default router;
