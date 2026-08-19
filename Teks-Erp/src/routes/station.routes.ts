// =============================================================================
// TeksERP - Station & Machine Routes
// =============================================================================

import { Router } from "express";
import { BaseController } from "../controllers/base.controller";
import { BaseService } from "../services/base.service";
import { StationService } from "../services/station.service";
import { stationHardRemove, machineHardRemove, machineDeletePreview } from "../services/helpers/guarded-hard-remove";
import { WorkSessionService, MOBILE_SESSION_PERMS } from "../services/work-session.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";

// --- Station ---
export const stationService = new StationService({
  modelName: "station",
  tableName: "STATION",
  searchFields: ["name"],
  codeSearchFields: ["code"],
  defaultInclude: {
    machines: true,
    defaultCategory: { select: { id: true, code: true, name: true } },
  },
  uniqueField: "code",
  duplicateNameField: "name",
  entityLabel: "istasyon",
  // Kod backend-authoritative: `IST+GGAAYY+NNNN` günlük sıralı (istemci kodu yok sayılır).
  autoCode: { prefix: "IST" },
});

const stationController = new BaseController(stationService);

// --- Machine ---
export const machineService = new BaseService({
  modelName: "machine",
  tableName: "MACHINE",
  searchFields: ["name"],
  codeSearchFields: ["code"],
  defaultInclude: { station: true },
  uniqueField: "code",
  // Makine adı yalnız AYNI istasyon içinde tekil — "Makine 1" farklı
  // istasyonlarda tekrar edebilir.
  duplicateNameField: "name",
  duplicateNameScopeField: "stationId",
  entityLabel: "makine",
  // Kod backend-authoritative: `MAK+GGAAYY+NNNN` günlük sıralı (istemci kodu yok sayılır).
  autoCode: { prefix: "MAK" },
});

const machineController = new BaseController(machineService);

// NOT: MachineHardware emekliye ayrıldı — saha donanımı (yazıcı + RS232 metre/kantar)
// artık tek normalize tabloda: PeripheralDevice (/api/peripherals).

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
 *         schema: { type: string, enum: [RAW_QC, PROCESS_QC, TAMBUR, SUBCONTRACTOR, SHIPPING, OTHER] }
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
 *                 enum: [RAW_QC, PROCESS_QC, TAMBUR, SUBCONTRACTOR, SHIPPING, OTHER]
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
 *                 enum: [RAW_QC, PROCESS_QC, TAMBUR, SUBCONTRACTOR, SHIPPING, OTHER]
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

// IMPORTANT: /resolve, /:id'den ÖNCE olmalı (Express "resolve"u id sanmasın).
/**
 * @openapi
 * /api/machines/resolve:
 *   get:
 *     tags: [Machines]
 *     summary: Makine kodundan çözüm (QR → makine; çalışma oturumu yer seçimi)
 *     description: Makine QR etiketi ham machine.code taşır — tam eşleşme ile aranır. İstasyon (kind dahil) birlikte döner.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Makine + istasyon }
 *       404: { description: Makine bulunamadı }
 */
machineRouter.get(
  "/resolve",
  verifyToken,
  requireAnyPermission("station:read", ...MOBILE_SESSION_PERMS),
  async (req, res, next) => {
    try {
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const result = await WorkSessionService.resolveMachineByCode(code);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  },
);

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
 * /api/machines/{id}/delete-preview:
 *   get:
 *     tags: [Machines]
 *     summary: Makine kalıcı silme önizlemesi (silinebilir mi + temizlenecek oturum sayısı)
 *     description: |
 *       `deletable` = üretim izi (işlem/hareket/top girişi) ve eşleşme (cihaz/donanım)
 *       yoksa true. `workSessionCount` = silmede tx içinde temizlenecek oturum satırı
 *       sayısı (denetim izi SystemLog'da kalır). `blockers` = engel varsa somut sebepler.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Önizleme }
 *       404: { description: Makine bulunamadı }
 */
machineRouter.get("/:id/delete-preview", verifyToken, requirePermission("station:write"), machineDeletePreview);

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
 *     summary: Makineyi kalıcı olarak sil (yalnız hiç kullanılmamışsa)
 *     description: |
 *       Veriyi veritabanından tamamen kaldırır (geri alınamaz). Üretim izi
 *       (oturum/işlem/hareket/top girişi) veya eşleşme (cihaz/donanım) varsa 409
 *       + somut Türkçe mesaj döner — bu durumda makine pasife alınmalıdır.
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
machineRouter.delete("/:id/permanent", verifyToken, requirePermission("station:write"), machineHardRemove);

export { machineRouter };
export default router;
