// =============================================================================
// TeksERP - Production Routes
// =============================================================================

import { Router } from "express";
import { ProductionController } from "../controllers/production.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const controller = new ProductionController();
const router = Router();

/**
 * @openapi
 * /api/production/active-steps:
 *   get:
 *     tags: [Production]
 *     summary: Aktif üretim adımları (Dashboard)
 *     description: Şu anda aktif olarak işlenen tüm üretim adımlarını listeler.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Aktif adımlar listesi (istasyon, iş emri bilgileri dahil)
 */
router.get("/active-steps", verifyToken, requirePermission("workorder:read"), controller.getActiveSteps);

/**
 * @openapi
 * /api/production/step-info:
 *   get:
 *     tags: [Production]
 *     summary: Tablet önizleme — top + mevcut step + sonraki step
 *     description: |
 *       Operatör el terminalinde barkod okuduğunda gösterilecek özet.
 *       stationId verilirse istasyon eşleşmesi yapılır (stationMatches true/false).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: barcode
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: stationId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Adım bilgisi }
 */
router.get("/step-info", verifyToken, requirePermission("workorder:read"), controller.getStepInfo);

/**
 * @openapi
 * /api/production/step-action:
 *   post:
 *     tags: [Production]
 *     summary: İstasyon işlemi (Başlat / Tamamla)
 *     description: |
 *       Tablet üzerinden barkod okutarak istasyon işlemi başlatır veya tamamlar.
 *       - START: Adımı aktif yapar, başlangıç zamanını kaydeder.
 *       - FINISH: Adımı tamamlar, topu sonraki adıma taşır.
 *       - Fason (EXTERNAL) tamamlamada yeni metraj/kilo zorunludur (fire hesabı).
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [barcode, stationId, action]
 *             properties:
 *               barcode:
 *                 type: string
 *                 description: Top barkodu
 *                 example: "TEKS-20260415-A1B2C3D4"
 *               stationId:
 *                 type: string
 *                 format: uuid
 *                 description: İşlem yapılan istasyon ID
 *               action:
 *                 type: string
 *                 enum: [START, FINISH]
 *               newQty:
 *                 type: number
 *                 description: Fason dönüşünde yeni metraj (fire sonrası)
 *               newWeight:
 *                 type: number
 *                 description: Fason dönüşünde yeni kilo
 *     responses:
 *       200:
 *         description: İstasyon işlemi gerçekleştirildi
 *       400:
 *         description: Validasyon hatası veya iş kuralı ihlali
 *       404:
 *         description: Barkod veya adım bulunamadı
 */
router.post("/step-action", verifyToken, requirePermission("roll:write"), controller.stepAction);

/**
 * @openapi
 * /api/production/report-error:
 *   post:
 *     tags: [Production]
 *     summary: Hata raporla (Kurşun / QC2)
 *     description: |
 *       Kurşun istasyonunda tespit edilen hataları raporlar.
 *       Bu hata kayıtları Tambur istasyonunda karar verme için kullanılır.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollId, startMeter, endMeter]
 *             properties:
 *               rollId:
 *                 type: string
 *                 format: uuid
 *               startMeter:
 *                 type: number
 *                 description: Hata başlangıç metresi
 *                 example: 45.5
 *               endMeter:
 *                 type: number
 *                 description: Hata bitiş metresi
 *                 example: 46.2
 *               errorType:
 *                 type: string
 *                 description: Hata türü (Leke, Yırtık, vb.)
 *                 example: "LEKE"
 *     responses:
 *       201:
 *         description: Hata kaydı oluşturuldu
 *       400:
 *         description: Validasyon hatası
 *       404:
 *         description: Top bulunamadı
 */
router.post("/report-error", verifyToken, requirePermission("quality:write"), controller.reportError);

export default router;
