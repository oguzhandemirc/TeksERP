// =============================================================================
// TeksERP - Station & Machine Routes
// =============================================================================

import { Router } from "express";
import { Request, Response, NextFunction } from "express";
import { BaseController } from "../controllers/base.controller";
import { BaseService } from "../services/base.service";
import prisma from "../lib/prisma";
import { AuditService } from "../services/audit.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

// --- Station ---
const stationService = new BaseService({
  modelName: "station",
  tableName: "STATION",
  searchFields: ["code", "name"],
  defaultInclude: { machines: true },
});

const stationController = new BaseController(stationService);

// --- Machine ---
const machineService = new BaseService({
  modelName: "machine",
  tableName: "MACHINE",
  searchFields: ["code", "name"],
  defaultInclude: { station: true },
});

const machineController = new BaseController(machineService);

const router = Router();

// =============================================================================
// STATION ENDPOINTS
// =============================================================================

/**
 * @openapi
 * /api/stations:
 *   get:
 *     tags: [Stations]
 *     summary: İstasyon listesi
 *     description: Tüm istasyonları makineleri ile birlikte listeler.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: filter[type]
 *         schema: { type: string, enum: [INTERNAL, EXTERNAL] }
 *       - in: query
 *         name: filter[department]
 *         schema: { type: string }
 *       - in: query
 *         name: filter[isActive]
 *         schema: { type: string, enum: [true, false] }
 *     responses:
 *       200:
 *         description: İstasyon listesi (makineler dahil)
 */
router.get("/", verifyToken, requirePermission("station:read"), stationController.findAll);

// IMPORTANT: /machines must come BEFORE /:id to avoid Express treating "machines" as an id param
/**
 * @openapi
 * /api/stations/machines:
 *   get:
 *     tags: [Machines]
 *     summary: Tüm makine listesi
 *     description: Tüm makineleri istasyonları ile birlikte listeler.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: filter[stationId]
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Makine listesi
 */
router.get("/machines", verifyToken, requirePermission("station:read"), machineController.findAll);

/**
 * @openapi
 * /api/stations/{id}:
 *   get:
 *     tags: [Stations]
 *     summary: İstasyon detayı
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: İstasyon detayı
 */
router.get("/:id", verifyToken, requirePermission("station:read"), stationController.findById);

/**
 * @openapi
 * /api/stations:
 *   post:
 *     tags: [Stations]
 *     summary: Yeni istasyon oluştur
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, name, type]
 *             properties:
 *               code: { type: string, example: "SARDON_1" }
 *               name: { type: string, example: "Şardon Makinesi" }
 *               type: { type: string, enum: [INTERNAL, EXTERNAL] }
 *               department: { type: string, example: "TERBIYE" }
 *     responses:
 *       201:
 *         description: İstasyon oluşturuldu
 */
router.post("/", verifyToken, requirePermission("station:write"), stationController.create);

/**
 * @openapi
 * /api/stations/{id}:
 *   patch:
 *     tags: [Stations]
 *     summary: İstasyonu güncelle
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
router.patch("/:id", verifyToken, requirePermission("station:write"), stationController.update);

/**
 * @openapi
 * /api/stations/{id}:
 *   delete:
 *     tags: [Stations]
 *     summary: İstasyonu pasife al
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
router.delete("/:id", verifyToken, requirePermission("station:write"), stationController.remove);

/**
 * Station hard-delete — önce bağlı kaynakları (machines + logs, routeSteps, workOrderSteps)
 * transaction içinde siler, ardından istasyonu veritabanından kaldırır.
 */
async function stationHardRemove(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = String(req.params.id);

    const station = await prisma.station.findUnique({ where: { id } });
    if (!station) {
      res.status(404).json({ success: false, data: null, message: "İstasyon bulunamadı" });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // 1. Makine loglarını sil
      const machines = await tx.machine.findMany({ where: { stationId: id } });
      for (const m of machines) {
        await tx.machineLog.deleteMany({ where: { machineId: m.id } });
      }
      // 2. Makineleri sil
      await tx.machine.deleteMany({ where: { stationId: id } });

      // 3. Rota adımlarını sil (RouteStep)
      await tx.routeStep.deleteMany({ where: { stationId: id } });

      // 4. İş emri adımlarını sil (WorkOrderStep) — sadece tamamlanmamış olanlar
      await tx.workOrderStep.deleteMany({ where: { stationId: id } });

      // 5. İstasyonu sil
      await tx.station.delete({ where: { id } });
    });

    await AuditService.log({
      userId: req.user?.userId,
      action: "DELETE",
      tableName: "STATION",
      recordId: id,
      oldData: station as Record<string, unknown>,
      newData: null,
    });

    res.status(200).json({
      success: true,
      data: station,
      message: "İstasyon ve bağlı tüm veriler kalıcı olarak silindi",
    });
  } catch (error) {
    next(error);
  }
}

router.delete("/:id/permanent", verifyToken, requirePermission("station:write"), stationHardRemove);

// =============================================================================
// MACHINE ENDPOINTS (separate router for /api/machines)
// =============================================================================
const machineRouter = Router();

/**
 * @openapi
 * /api/machines/{id}:
 *   get:
 *     tags: [Machines]
 *     summary: Makine detayı
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Makine detayı
 */
machineRouter.get("/:id", verifyToken, requirePermission("station:read"), machineController.findById);

/**
 * @openapi
 * /api/machines:
 *   post:
 *     tags: [Machines]
 *     summary: Yeni makine ekle
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stationId, code, name]
 *             properties:
 *               stationId: { type: string, format: uuid }
 *               code: { type: string, example: "TEZGAH_04" }
 *               name: { type: string, example: "Dokuma Tezgah 4" }
 *               deviceIp: { type: string, example: "192.168.1.104" }
 *     responses:
 *       201:
 *         description: Makine oluşturuldu
 */
machineRouter.post("/", verifyToken, requirePermission("station:write"), machineController.create);

/**
 * @openapi
 * /api/machines/{id}:
 *   patch:
 *     tags: [Machines]
 *     summary: Makine güncelle
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
machineRouter.patch("/:id", verifyToken, requirePermission("station:write"), machineController.update);

/**
 * @openapi
 * /api/machines/{id}:
 *   delete:
 *     tags: [Machines]
 *     summary: Makineyi pasife al
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
machineRouter.delete("/:id", verifyToken, requirePermission("station:write"), machineController.remove);

/**
 * @openapi
 * /api/machines/{id}/permanent:
 *   delete:
 *     tags: [Machines]
 *     summary: Makineyi kalıcı olarak sil
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
machineRouter.delete("/:id/permanent", verifyToken, requirePermission("station:write"), machineController.hardRemove);

export { machineRouter };
export default router;
