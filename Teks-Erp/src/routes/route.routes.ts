// =============================================================================
// TeksERP - Route (Üretim Rotası) Routes
// =============================================================================

import { Router } from "express";
import { Request, Response, NextFunction } from "express";
import { BaseController } from "../controllers/base.controller";
import { BaseService } from "../services/base.service";
import prisma from "../lib/prisma";
import { AuditService } from "../services/audit.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const service = new BaseService({
  modelName: "route",
  tableName: "ROUTE",
  searchFields: ["name"],
  nestedCreateFields: ["steps"],
  defaultInclude: {
    steps: {
      include: {
        station: {
          include: {
            defaultCategory: { select: { id: true, code: true, name: true } },
          },
        },
      },
      orderBy: { sequence: "asc" },
    },
  },
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
router.get("/", verifyToken, requirePermission("station:read"), controller.findAll);

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

/**
 * Route hard-delete — önce bağlı route_steps'leri transaction içinde siler,
 * ardından rotayı veritabanından tamamen kaldırır.
 */
async function routeHardRemove(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = String(req.params.id);

    const route = await prisma.route.findUnique({ where: { id } });
    if (!route) {
      res.status(404).json({ success: false, data: null, message: "Rota bulunamadı" });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // 1. Rota adımlarını sil (route_steps)
      await tx.routeStep.deleteMany({ where: { routeId: id } });
      // 2. Rotayı sil
      await tx.route.delete({ where: { id } });
    });

    await AuditService.log({
      userId:    req.user?.userId,
      action:    "DELETE",
      tableName: "ROUTE",
      recordId:  id,
      oldData:   route as Record<string, unknown>,
      newData:   null,
    });

    res.status(200).json({
      success: true,
      data:    route,
      message: "Rota ve tüm adımları kalıcı olarak silindi",
    });
  } catch (error) {
    next(error);
  }
}

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
