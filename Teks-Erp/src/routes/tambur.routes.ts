// =============================================================================
// TeksERP - Tambur Routes
// =============================================================================

import { Router } from "express";
import { TamburController } from "../controllers/tambur.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const controller = new TamburController();
const router = Router();

/**
 * @openapi
 * /api/tambur/pending-rolls:
 *   get:
 *     tags: [Tambur]
 *     summary: Tambur'da bekleyen toplar
 *     description: İşlenmemiş hataları olan, IN_PRODUCTION durumundaki topları listeler.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Bekleyen toplar ve hata listesi
 */
router.get("/pending-rolls", verifyToken, requirePermission("quality:read"), controller.getPendingRolls);

/**
 * @openapi
 * /api/tambur/rolls/{rollId}:
 *   get:
 *     tags: [Tambur]
 *     summary: Tambur karar ekranı — top detayı
 *     description: Belirtilen topu işlenmemiş hataları ile birlikte getirir.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: rollId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Top detayı ve hata listesi
 *       404:
 *         description: Top bulunamadı
 */
router.get("/rolls/:rollId", verifyToken, requirePermission("quality:read"), controller.getRollForDecision);

/**
 * @openapi
 * /api/tambur/finalize:
 *   post:
 *     tags: [Tambur]
 *     summary: Tambur finalizasyonu (Kes/Kesme kararları)
 *     description: |
 *       Kurşun'dan gelen hata kayıtları için KES/KESME kararı verir.
 *       
 *       **KRİTİK İŞ KURALI (Roll Splitting):**
 *       KES kararı verildiğinde orijinal topun metrajı sadece azaltılmaz.
 *       Kesilen parça için YENİ bir Roll kaydı (yeni barkod) oluşturulur
 *       ve SCRAP veya A1 statüsü verilir.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollId, netCurrentQty, decisions]
 *             properties:
 *               rollId:
 *                 type: string
 *                 format: uuid
 *               netCurrentQty:
 *                 type: number
 *                 description: Kesimler sonrası net metraj
 *                 example: 115.3
 *               decisions:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [errorId, decision]
 *                   properties:
 *                     errorId:
 *                       type: string
 *                       format: uuid
 *                     decision:
 *                       type: string
 *                       enum: [CUT, NO_CUT]
 *                     qualityGrade:
 *                       type: string
 *                       description: "Kesilen parçanın kalitesi (FIRE, A1 vb.)"
 *                       default: "FIRE"
 *     responses:
 *       200:
 *         description: Tambur finalizasyonu tamamlandı (orijinal top + kesim topları)
 *       400:
 *         description: Validasyon hatası
 *       404:
 *         description: Top bulunamadı
 */
router.post("/finalize", verifyToken, requirePermission("quality:write"), controller.finalize);

/**
 * @openapi
 * /api/tambur/allocate:
 *   post:
 *     tags: [Tambur]
 *     summary: Sipariş tahsisi
 *     description: |
 *       PRODUCED durumundaki bir topu sipariş kalemine tahsis eder.
 *       Topun yeterli net metrajı olması gerekir.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollId, orderLineId, allocatedQty]
 *             properties:
 *               rollId:
 *                 type: string
 *                 format: uuid
 *               orderLineId:
 *                 type: string
 *                 format: uuid
 *               allocatedQty:
 *                 type: number
 *                 description: Tahsis edilecek metraj
 *                 example: 100.0
 *     responses:
 *       201:
 *         description: Tahsis oluşturuldu
 *       400:
 *         description: Yetersiz miktar veya uygun olmayan status
 *       404:
 *         description: Top veya sipariş kalemi bulunamadı
 */
router.post("/allocate", verifyToken, requirePermission("allocation:write"), controller.allocate);

/**
 * @openapi
 * /api/tambur/split-allocate:
 *   post:
 *     tags: [Tambur]
 *     summary: Tek çağrıda çoklu sipariş + stok paylaştırması
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/split-allocate",
  verifyToken,
  requirePermission("allocation:write"),
  controller.splitAllocate
);

/**
 * @openapi
 * /api/tambur/swatch:
 *   post:
 *     tags: [Tambur]
 *     summary: Kartela üretimi (adet x uzunluk kaynak rolden düşülür)
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/swatch",
  verifyToken,
  requirePermission("quality:write"),
  controller.createSwatch
);

export default router;

