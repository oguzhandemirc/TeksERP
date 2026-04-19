// =============================================================================
// TeksERP - Packaging (Paket/Tartı/Etiket) Routes
// =============================================================================

import { Router } from "express";
import { PackagingController } from "../controllers/packaging.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const controller = new PackagingController();
const router = Router();

/**
 * @openapi
 * /api/packaging/pending-rolls:
 *   get:
 *     tags: [Packaging]
 *     summary: Paketleme adımında bekleyen toplar
 *     description: Tüm açık (exitedAt=null) paketleme hareketlerini döner.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Paketleme adımındaki top listesi }
 *       401: { description: Yetkisiz }
 *       500: { description: Sunucu hatası }
 */
router.get(
  "/pending-rolls",
  verifyToken,
  requirePermission("roll:read"),
  controller.getPendingRolls
);

/**
 * @openapi
 * /api/packaging/by-card/{barcode}:
 *   get:
 *     tags: [Packaging]
 *     summary: Refakat kartı ile paketleme adımındaki topları çöz
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: barcode
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Paketleme adım özeti ve top listesi }
 *       400: { description: Kart aktif değil veya adım yok }
 *       401: { description: Yetkisiz }
 *       404: { description: Refakat kartı bulunamadı }
 *       500: { description: Sunucu hatası }
 */
router.get(
  "/by-card/:barcode",
  verifyToken,
  requirePermission("roll:read"),
  controller.getByCardBarcode
);

/**
 * @openapi
 * /api/packaging/by-roll/{barcode}:
 *   get:
 *     tags: [Packaging]
 *     summary: Top barkodu ile paketleme adımındaki topu çöz
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: barcode
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Top özeti }
 *       400: { description: Top paketleme adımında değil }
 *       401: { description: Yetkisiz }
 *       404: { description: Top bulunamadı }
 *       500: { description: Sunucu hatası }
 */
router.get(
  "/by-roll/:barcode",
  verifyToken,
  requirePermission("roll:read"),
  controller.getByRollBarcode
);

/**
 * @openapi
 * /api/packaging/simulate-weigh/{rollId}:
 *   post:
 *     tags: [Packaging]
 *     summary: Tartı simülasyonu (Faz 1 — COM port yerine rastgele kilo)
 *     description: |
 *       Faz 1'de kantar COM port bağlantısı yok. Bu endpoint mevcut metraja
 *       dayalı gerçekçi bir kilo üretir (0.22-0.35 kg/m arası). Faz 2'de
 *       yerini gerçek cihaz okuma alacak.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: rollId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Simüle edilmiş kilo }
 *       401: { description: Yetkisiz }
 *       404: { description: Top bulunamadı }
 *       500: { description: Sunucu hatası }
 */
router.post(
  "/simulate-weigh/:rollId",
  verifyToken,
  requirePermission("roll:write"),
  controller.simulateWeigh
);

/**
 * @openapi
 * /api/packaging/finalize:
 *   post:
 *     tags: [Packaging]
 *     summary: Paketleme finalizasyonu (kilo + hedef seçimi + etiket)
 *     description: |
 *       Topun paketleme adımını kapatır. Kilo kaydedilir, operatörün seçimine
 *       göre top ya sevkiyata (READY_FOR_SHIP) ya da depoya (WAREHOUSE) alınır.
 *       Bütün top tek hedefe gider — metraj bölüştürme burada yapılmaz.
 *       Etiket payload'u döner (client yazdırır).
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollId, weightKg, destination]
 *             properties:
 *               rollId: { type: string, format: uuid }
 *               weightKg: { type: number, example: 42.5 }
 *               destination:
 *                 type: string
 *                 enum: [SHIP, WAREHOUSE]
 *               orderLineId:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *                 description: SHIP hedefinde hangi sipariş satırına gideceği (iş emri tek siparişe bağlıysa boş bırakılabilir)
 *     responses:
 *       200: { description: Paketleme tamamlandı, etiket verisi döndü }
 *       400: { description: Validasyon hatası / yanlış adım }
 *       401: { description: Yetkisiz }
 *       404: { description: Top bulunamadı }
 *       500: { description: Sunucu hatası }
 */
router.post(
  "/finalize",
  verifyToken,
  requirePermission("roll:write"),
  controller.finalize
);

export default router;
