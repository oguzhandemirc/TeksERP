// =============================================================================
// TeksERP - Kurşun + QC2 Routes
// =============================================================================

import { Router } from "express";
import { KursunQcController } from "../controllers/kursun-qc.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const controller = new KursunQcController();
const router = Router();

/**
 * @openapi
 * /api/kursun-qc/by-card/{barcode}:
 *   get:
 *     tags: [KursunQc]
 *     summary: Refakat kartı barkodu ile PROCESS_QC adımını ve açık topları getir
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: barcode
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Adım özeti ve top listesi }
 *       400: { description: Kart aktif değil veya adım bulunamadı }
 *       404: { description: Refakat kartı bulunamadı }
 *       500: { description: Sunucu hatası }
 */
router.get(
  "/by-card/:barcode",
  verifyToken,
  requirePermission("quality:read"),
  controller.getByCardBarcode
);

/**
 * @openapi
 * /api/kursun-qc/step/{stepId}:
 *   get:
 *     tags: [KursunQc]
 *     summary: PROCESS_QC adım özeti (test/admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: stepId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Adım özeti }
 *       400: { description: Adım PROCESS_QC tipinde değil }
 *       404: { description: Adım bulunamadı }
 *       500: { description: Sunucu hatası }
 */
router.get(
  "/step/:stepId",
  verifyToken,
  requirePermission("quality:read"),
  controller.getStep
);

/**
 * @openapi
 * /api/kursun-qc/apply-kursun:
 *   post:
 *     tags: [KursunQc]
 *     summary: Bir topa "Kurşun geçildi" işareti koy (idempotent)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollId, stepId]
 *             properties:
 *               rollId: { type: string, format: uuid }
 *               stepId: { type: string, format: uuid }
 *               notes:  { type: string }
 *     responses:
 *       201: { description: İşlem kaydedildi }
 *       400: { description: Top bu adımda değil veya adım PROCESS_QC değil }
 *       401: { description: Yetkisiz }
 *       500: { description: Sunucu hatası }
 */
router.post(
  "/apply-kursun",
  verifyToken,
  requirePermission("quality:write"),
  controller.applyKursun
);

/**
 * @openapi
 * /api/kursun-qc/undo-kursun:
 *   post:
 *     tags: [KursunQc]
 *     summary: Yanlış konulmuş Kurşun işaretini geri al
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollId, stepId]
 *             properties:
 *               rollId: { type: string, format: uuid }
 *               stepId: { type: string, format: uuid }
 *     responses:
 *       200: { description: İşaret kaldırıldı veya zaten yoktu }
 *       400: { description: QC2 tamamlandıysa geri alınamaz }
 *       401: { description: Yetkisiz }
 *       500: { description: Sunucu hatası }
 */
router.post(
  "/undo-kursun",
  verifyToken,
  requirePermission("quality:write"),
  controller.undoKursun
);

/**
 * @openapi
 * /api/kursun-qc/complete-qc2:
 *   post:
 *     tags: [KursunQc]
 *     summary: Bir topun QC2'sini tamamlandı olarak işaretle
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollId, stepId]
 *             properties:
 *               rollId: { type: string, format: uuid }
 *               stepId: { type: string, format: uuid }
 *               notes:  { type: string }
 *     responses:
 *       201: { description: İşlem kaydedildi }
 *       400: { description: Top bu adımda değil }
 *       401: { description: Yetkisiz }
 *       500: { description: Sunucu hatası }
 */
router.post(
  "/complete-qc2",
  verifyToken,
  requirePermission("quality:write"),
  controller.completeQc2
);

/**
 * @openapi
 * /api/kursun-qc/report-error:
 *   post:
 *     tags: [KursunQc]
 *     summary: Topta hata tespiti — Tambur'da karara bağlanır
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollId, stepId, startMeter, endMeter]
 *             properties:
 *               rollId:     { type: string, format: uuid }
 *               stepId:     { type: string, format: uuid }
 *               startMeter: { type: number, example: 120 }
 *               endMeter:   { type: number, example: 125 }
 *               errorType:  { type: string, example: "LEKE" }
 *     responses:
 *       201: { description: Hata kaydı oluşturuldu }
 *       400: { description: Metraj aralığı geçersiz }
 *       401: { description: Yetkisiz }
 *       404: { description: Top bulunamadı }
 *       500: { description: Sunucu hatası }
 */
router.post(
  "/report-error",
  verifyToken,
  requirePermission("quality:write"),
  controller.reportError
);

/**
 * @openapi
 * /api/kursun-qc/error:
 *   delete:
 *     tags: [KursunQc]
 *     summary: Tambur karar vermeden önce hata kaydını sil
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [errorId]
 *             properties:
 *               errorId: { type: string, format: uuid }
 *     responses:
 *       200: { description: Silindi }
 *       400: { description: Tambur kararı verilmiş kayıt silinemez }
 *       401: { description: Yetkisiz }
 *       404: { description: Kayıt bulunamadı }
 *       500: { description: Sunucu hatası }
 */
router.delete(
  "/error",
  verifyToken,
  requirePermission("quality:write"),
  controller.deleteError
);

/**
 * @openapi
 * /api/kursun-qc/finish-step:
 *   post:
 *     tags: [KursunQc]
 *     summary: PROCESS_QC adımını kapat ve açık rolleri sonraki adıma taşı
 *     description: |
 *       Tüm açık rollerin QC2_COMPLETED işareti olmalı. Aksi halde 400 döner.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stepId]
 *             properties:
 *               stepId: { type: string, format: uuid }
 *     responses:
 *       200: { description: Adım kapatıldı }
 *       400: { description: QC2 tamamlanmamış toplar var }
 *       401: { description: Yetkisiz }
 *       404: { description: Adım bulunamadı }
 *       500: { description: Sunucu hatası }
 */
router.post(
  "/finish-step",
  verifyToken,
  requirePermission("quality:write"),
  controller.finishStep
);

export default router;
