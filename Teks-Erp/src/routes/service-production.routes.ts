// =============================================================================
// TeksERP - Fason Üretim Kabul (Service Production) Routes
// =============================================================================

import { Router } from "express";
import { ServiceProductionController } from "../controllers/service-production.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const controller = new ServiceProductionController();
const router = Router();

/**
 * @openapi
 * /api/service-production/intake:
 *   post:
 *     tags: [ServiceProduction]
 *     summary: Fason üretim kabul — müşteri malı topları kaydet
 *     description: |
 *       Müşterinin getirdiği (boyalı/yarı mamul) kumaşı bizim fabrikamızda işlemek üzere kabul eder.
 *       Toplar `ownerCustomerId` ile ilgili müşteriye kilitlenir; başka müşteriye sevk edilemez.
 *       Otomatik bir SERVICE_PRODUCTION tipi WorkOrder açılır, seçilen rota adımları oluşturulur
 *       ve toplar ilk adıma (IN_PRODUCTION) bağlanır.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerId, itemId, servicePricePerMeter, routeStationKinds, rolls]
 *             properties:
 *               customerId:
 *                 type: string
 *                 format: uuid
 *               itemId:
 *                 type: string
 *                 format: uuid
 *               colorId:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *               servicePricePerMeter:
 *                 type: number
 *                 example: 2.50
 *                 description: Metre başı hizmet bedeli (₺/m)
 *               routeStationKinds:
 *                 type: array
 *                 description: Müşteri talebine göre seçilen istasyon kind'ları. PACKAGING her zaman zorunludur, verilmese de server ekler.
 *                 items:
 *                   type: string
 *                   enum: [RAW_QC, PROCESS_QC, SUBCONTRACTOR, TAMBUR, PACKAGING, SHIPPING, OTHER]
 *               batchNumber:
 *                 type: string
 *                 nullable: true
 *               notes:
 *                 type: string
 *                 nullable: true
 *               rolls:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [initialQty]
 *                   properties:
 *                     initialQty: { type: number, example: 125.5 }
 *                     weightKg: { type: number, nullable: true }
 *                     qualityGrade: { type: string, nullable: true }
 *                     width: { type: number, nullable: true }
 *                     customerDescription:
 *                       type: string
 *                       nullable: true
 *                       description: Müşterinin kendi desen adı/kodu (serbest metin, etikette görünür)
 *     responses:
 *       201:
 *         description: Fason kabul tamamlandı, toplar ve WO oluşturuldu.
 *       400:
 *         description: Validasyon hatası
 *       404:
 *         description: Müşteri/ürün/varyant bulunamadı
 */
router.post(
  "/intake",
  verifyToken,
  requirePermission("roll:write"),
  controller.createIntake
);

export default router;
