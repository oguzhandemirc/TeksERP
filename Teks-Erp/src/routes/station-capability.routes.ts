// =============================================================================
// TeksERP - Station Capability Routes
// =============================================================================
// Bir istasyonun renk + özellik yetkinliklerini yönetir.
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { StationCapabilityService } from "../services/station-capability.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";
import { getStampContext } from "../services/helpers/work-session.helper";
import { MOBILE_SESSION_PERMS } from "../services/work-session.service";

const service = new StationCapabilityService();
const router = Router();

const setCapabilitiesSchema = z.object({
  // colorIds OPSİYONEL — gönderilmezse renk satırlarına dokunulmaz. `.default([])`
  // OLMAZ: renk artık kısıt olmadığı için panel bu alanı hiç göndermiyor, default
  // devreye girseydi her kayıtta istasyonun tüm renk atamaları sessizce silinirdi.
  colorIds: z.array(z.string().uuid()).optional(),
  // 2026-08-10: her özellik artık bir MOD taşır (AUTO/OPTIONAL/REQUIRED).
  // `propertyIds` eski sözleşme olarak KABUL EDİLMEYE DEVAM EDER — panel
  // güncellenene kadar 400 yağmuru olmasın diye; mod verilmeyen satır mevcut
  // modunu KORUR (yeni satır şema varsayılanı OPTIONAL alır).
  propertyIds: z.array(z.string().uuid()).optional(),
  properties: z
    .array(
      z.object({
        propertyId: z.string().uuid(),
        mode: z.enum(["AUTO", "OPTIONAL", "REQUIRED"]).optional(),
      }),
    )
    .optional(),
});

/**
 * @openapi
 * /api/station-capabilities:
 *   get:
 *     tags: [StationCapabilities]
 *     summary: Tüm istasyonların yetkinlik özeti
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: İstasyon başına renk/özellik sayıları }
 */
router.get(
  "/",
  verifyToken,
  requirePermission("station:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // ?detailed=true → her istasyonun renk + özellik listesini döner
      if (req.query.detailed === "true") {
        res.status(200).json(await service.listAllDetailed());
        return;
      }
      res.status(200).json(await service.listAll());
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/station-capabilities/for-session:
 *   get:
 *     tags: [StationCapabilities]
 *     summary: Aktif çalışma oturumunun İSTASYONUNUN yetkinlikleri (tablet)
 *     description: |
 *       İstasyon, cihazın aktif WorkSession'ından çözülür (x-device-id → oturum) —
 *       `peripherals/for-session` ile aynı desen. Tablet kendi istasyon id'sini
 *       bilmek zorunda kalmaz.
 *
 *       ⚠️ HENÜZ İSTEMCİSİ YOK: Kurşun/QC2 özellik tuşları open-cards
 *       payload'ındaki `stepSummary.properties`'ten, Tambur kat tuşları katalog
 *       kod aramasından çizilir (oturumsuz planlama yüzeyleri de aynı listeyi
 *       kullanır). Bu uç istasyon-bağlı yeni bir ekran için hazır altyapıdır.
 *
 *       Oturum yoksa 400 — boş liste döndürmek "kat seçeneği tanımlı değil" ile
 *       "oturum açık değil"i aynı ekrana çıkarırdı.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ colors, properties[] }" }
 *       400: { description: Aktif oturum yok }
 */
router.get(
  "/for-session",
  verifyToken,
  // Saha tabletleri `station:read` taşımaz — mobil ekran izinleri de kabul
  // edilir (proje kuralı: "Mobil ekranın dokunacağı endpoint → requireAnyPermission").
  requireAnyPermission("station:read", ...MOBILE_SESSION_PERMS),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stamp = await getStampContext(req);
      res.status(200).json(await service.getForSession(stamp?.stationId));
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/station-capabilities/{stationId}:
 *   get:
 *     tags: [StationCapabilities]
 *     summary: Bir istasyonun renk + özellik yetkinlikleri
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: stationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: "{ colors, properties }" }
 *       404: { description: İstasyon bulunamadı }
 */
router.get(
  "/:stationId",
  verifyToken,
  requirePermission("station:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stationId = req.params.stationId as string;
      res.status(200).json(await service.findByStation(stationId));
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/station-capabilities/{stationId}:
 *   put:
 *     tags: [StationCapabilities]
 *     summary: İstasyonun renk + özellik yetkinliklerini topluca değiştir
 *     description: |
 *       Replace semantics — eski liste silinip yeni liste yazılır; mevcut satırın
 *       MODU korunur (2026-08-10). `colorIds` gönderilmezse renk satırlarına
 *       dokunulmaz. `properties` mod taşıyan yeni sözleşmedir; `propertyIds`
 *       (modsuz) eski sözleşme olarak kabul edilmeye devam eder.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: stationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               colorIds:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *               propertyIds:
 *                 type: array
 *                 description: Eski sözleşme — mod verilmeden satır listesi (yeni satır OPTIONAL doğar).
 *                 items: { type: string, format: uuid }
 *               properties:
 *                 type: array
 *                 description: Yeni sözleşme — satır başına davranış modu.
 *                 items:
 *                   type: object
 *                   required: [propertyId]
 *                   properties:
 *                     propertyId: { type: string, format: uuid }
 *                     mode:
 *                       type: string
 *                       enum: [AUTO, OPTIONAL, REQUIRED]
 *                       description: Verilmezse mevcut satırın modu korunur; yeni satırda OPTIONAL.
 *     responses:
 *       200: { description: Güncel yetkinlikler döner }
 */
router.put(
  "/:stationId",
  verifyToken,
  requirePermission("station:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stationId = req.params.stationId as string;
      const body = setCapabilitiesSchema.parse(req.body);
      const result = await service.setCapabilities(
        stationId,
        body,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  },
);

export default router;
