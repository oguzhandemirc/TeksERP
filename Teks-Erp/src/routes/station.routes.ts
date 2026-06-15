// =============================================================================
// TeksERP - Station & Machine Routes
// =============================================================================

import { Router } from "express";
import { BaseController } from "../controllers/base.controller";
import { BaseService } from "../services/base.service";
import { stationHardRemove } from "../services/helpers/guarded-hard-remove";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

// --- Station ---
const stationService = new BaseService({
  modelName: "station",
  tableName: "STATION",
  searchFields: ["code", "name"],
  defaultInclude: {
    machines: true,
    defaultCategory: { select: { id: true, code: true, name: true } },
  },
  uniqueField: "code",
});

const stationController = new BaseController(stationService);

// --- Machine ---
const machineService = new BaseService({
  modelName: "machine",
  tableName: "MACHINE",
  searchFields: ["code", "name"],
  defaultInclude: { station: true },
  uniqueField: "code",
});

const machineController = new BaseController(machineService);

// --- Machine Hardware (saha donanım config: yazıcı + RS232 ara cihaz desenleri) ---
const machineHardwareService = new BaseService({
  modelName: "machineHardware",
  tableName: "MACHINE_HARDWARE",
  searchFields: ["printerIp", "printerMac", "kqMac", "mtMac"],
  defaultInclude: {
    machine: { select: { id: true, code: true, name: true, stationId: true } },
    printerModel: { select: { id: true, code: true, name: true } },
    formatProfile: { select: { id: true, code: true, name: true } },
  },
  uniqueField: "machineId",
});
const machineHardwareController = new BaseController(machineHardwareService);

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
 *         name: filter[kind]
 *         schema: { type: string, enum: [RAW_QC, PROCESS_QC, TAMBUR, SUBCONTRACTOR, OTHER] }
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
 *             required: [code, name, type, kind]
 *             properties:
 *               code: { type: string, example: "SARDON_1" }
 *               name: { type: string, example: "Şardon Makinesi" }
 *               type: { type: string, enum: [INTERNAL, EXTERNAL] }
 *               kind:
 *                 type: string
 *                 enum: [RAW_QC, PROCESS_QC, TAMBUR, SUBCONTRACTOR, OTHER]
 *                 description: Domain rolü — API davranış dispatch'i için kullanılır (ör. PROCESS_QC → Kurşun+QC2 akışı, TAMBUR → kesim/karar akışı). Varsayılan OTHER.
 *                 example: OTHER
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
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               code: { type: string }
 *               name: { type: string }
 *               type: { type: string, enum: [INTERNAL, EXTERNAL] }
 *               kind:
 *                 type: string
 *                 enum: [RAW_QC, PROCESS_QC, TAMBUR, SUBCONTRACTOR, OTHER]
 *               department: { type: string }
 *               isActive: { type: boolean }
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

// Station hard-delete — guard'lı kalıcı silme; iskelet + guard listesi
// services/helpers/guarded-hard-remove.ts'te (üç /permanent ucunun tek kaynağı).
router.delete("/:id/permanent", verifyToken, requirePermission("station:write"), stationHardRemove);

// =============================================================================
// MACHINE ENDPOINTS (separate router for /api/machines)
// =============================================================================
const machineRouter = Router();

/**
 * @openapi
 * /api/machines:
 *   get:
 *     tags: [Machines]
 *     summary: Makine listesi (offset veya cursor)
 *     description: |
 *       Standart BaseService akışı — `?cursor=...&limit=...` cursor moduna geçer,
 *       aksi halde offset (`page`/`pageSize`) döner. `filter[stationId]`,
 *       `filter[isActive]`, `search` destekli.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Makine listesi
 */
machineRouter.get("/", verifyToken, requirePermission("station:read"), machineController.findAll);

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

// =============================================================================
// MACHINE HARDWARE ENDPOINTS (/api/machine-hardware) — saha donanım config
// =============================================================================
const machineHardwareRouter = Router();

/**
 * @openapi
 * /api/machine-hardware:
 *   get:
 *     tags: [Machines]
 *     summary: Makine donanım config listesi (yazıcı + RS232 ara cihaz desenleri)
 *     description: Sahadaki yazıcı/MAC + regex parse desenleri — dokümantasyon + cihaz/kodlama seçimi.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Donanım config listesi }
 *   post:
 *     tags: [Machines]
 *     summary: Yeni makine donanım config kaydı
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Oluşturuldu }
 */
machineHardwareRouter.get("/", verifyToken, requirePermission("station:read"), machineHardwareController.findAll);
machineHardwareRouter.get("/:id", verifyToken, requirePermission("station:read"), machineHardwareController.findById);
machineHardwareRouter.post("/", verifyToken, requirePermission("station:write"), machineHardwareController.create);
machineHardwareRouter.patch("/:id", verifyToken, requirePermission("station:write"), machineHardwareController.update);
machineHardwareRouter.delete("/:id", verifyToken, requirePermission("station:write"), machineHardwareController.remove);
machineHardwareRouter.delete("/:id/permanent", verifyToken, requirePermission("station:write"), machineHardwareController.hardRemove);

export { machineRouter, machineHardwareRouter };
export default router;
