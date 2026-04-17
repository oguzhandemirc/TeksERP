// =============================================================================
// TeksERP - WorkOrder (Parti) Routes
// =============================================================================

import { Router } from "express";
import { WorkOrderController } from "../controllers/workorder.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { workOrderTravelerRouter } from "./traveler-card.routes";

const controller = new WorkOrderController();
const router = Router();

// /api/work-orders/:id/traveler-cards altında refakat kartı endpoint'leri
router.use("/:id/traveler-cards", workOrderTravelerRouter);

/**
 * @openapi
 * /api/work-orders:
 *   get:
 *     tags: [WorkOrders]
 *     summary: İş emri (parti) listesi
 *     description: Tüm iş emirlerini rota adımları ve bağlı siparişler ile listeler.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Parti numarası ile arama
 *       - in: query
 *         name: filter[status]
 *         schema: { type: string, enum: [PLANNED, IN_PROGRESS, PAUSED, COMPLETED, CANCELLED] }
 *       - in: query
 *         name: filter[type]
 *         schema: { type: string, enum: [ORDER_PRODUCTION, STOCK_PRODUCTION, SAMPLE_PRODUCTION, REPAIR_REWORK] }
 *     responses:
 *       200:
 *         description: Sayfalanmış iş emri listesi
 */
router.get("/", verifyToken, requirePermission("workorder:read"), controller.findAll);

/**
 * @openapi
 * /api/work-orders/available-for-attach:
 *   get:
 *     tags: [WorkOrders]
 *     summary: Bağlama için bekleyen iş emirleri
 *     description: Planlama tarafından oluşturulmuş ancak topları henüz bağlanmamış PLANNED durumundaki iş emirlerini listeler.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Bekleyen iş emri listesi
 */
router.get("/available-for-attach", verifyToken, requirePermission("workorder:write"), controller.findAvailableForAttach);

/**
 * @openapi
 * /api/work-orders/{id}:
 *   get:
 *     tags: [WorkOrders]
 *     summary: İş emri detayı
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: İş emri detayı (rota adımları ve siparişler dahil)
 *       404:
 *         description: İş emri bulunamadı
 */
router.get("/:id", verifyToken, requirePermission("workorder:read"), controller.findById);

/**
 * @openapi
 * /api/work-orders/{id}/travel-card:
 *   get:
 *     tags: [WorkOrders]
 *     summary: Refakat Kartı (Traveler Card) verisi
 *     description: İş emrinin barkod ve rota bilgilerini içeren refakat kartı verisini döner.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Refakat kartı verisi
 *       404:
 *         description: İş emri bulunamadı
 */
router.get("/:id/travel-card", verifyToken, requirePermission("workorder:read"), controller.getTravelCard);

/**
 * @openapi
 * /api/work-orders/{id}/manifest:
 *   get:
 *     tags: [WorkOrders]
 *     summary: Çeki Listesi (Manifest) verisi
 *     description: İş emrine bağlı topların metraj ve kilo özet listesini döner.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Çeki listesi verisi
 *       404:
 *         description: İş emri bulunamadı
 */
router.get("/:id/manifest", verifyToken, requirePermission("workorder:read"), controller.getManifest);

/**
 * @openapi
 * /api/work-orders/{id}/manifest:
 *   post:
 *     tags: [WorkOrders]
 *     summary: Çeki Listesi belgesi oluştur (kalıcı)
 *     description: İş emrinin anlık manifest snapshot'ını Manifest tablosuna kaydeder. Aynı WO için birden fazla basım alınabilir.
 *     security: [{ bearerAuth: [] }]
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
 *               notes: { type: string }
 *     responses:
 *       201: { description: Manifest oluşturuldu }
 */
router.post("/:id/manifest", verifyToken, requirePermission("workorder:write"), controller.createManifest);

/**
 * @openapi
 * /api/work-orders/{id}/manifests:
 *   get:
 *     tags: [WorkOrders]
 *     summary: İş emrinin tüm manifest (çeki listesi) geçmişi
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Manifest listesi }
 */
router.get("/:id/manifests", verifyToken, requirePermission("workorder:read"), controller.listManifests);

/**
 * @openapi
 * /api/work-orders:
 *   post:
 *     tags: [WorkOrders]
 *     summary: Yeni iş emri (parti) oluştur
 *     description: |
 *       Rota adımları ile birlikte yeni iş emri oluşturur.
 *       orderLineIds opsiyoneldir — boş bırakılırsa stok için üretim yapılır.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [batchNumber, steps]
 *             properties:
 *               batchNumber:
 *                 type: string
 *                 example: "PARTI-2026-001"
 *               type:
 *                 type: string
 *                 enum: [WEAVING, WARPING, FABRIC_DYEING, RE_PROCESS]
 *                 default: FABRIC_DYEING
 *               width:
 *                 type: number
 *                 description: Kumaş eni (cm)
 *                 example: 150
 *               recipeNo:
 *                 type: string
 *                 description: Boyahane/baskı reçete kodu
 *                 example: "R-2026-045"
 *               parameters:
 *                 type: object
 *                 description: Dinamik parametreler (ek bilgiler)
 *               steps:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [stationId]
 *                   properties:
 *                     stationId: { type: string, format: uuid }
 *               orderLineIds:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: İş emri oluşturuldu
 *       400:
 *         description: Validasyon hatası
 */
router.post("/", verifyToken, requirePermission("workorder:write"), controller.create);

/**
 * @openapi
 * /api/work-orders/{id}/attach-rolls:
 *   patch:
 *     tags: [WorkOrders]
 *     summary: İş emrine top bağla
 *     description: |
 *       El terminali ile okunan barkodları iş emrine bağlar.
 *       Topların STOCK durumunda olması gerekir; status IN_PRODUCTION'a çevrilir.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [barcodes]
 *             properties:
 *               barcodes:
 *                 type: array
 *                 items: { type: string }
 *                 example: ["TEKS-20260415-A1B2C3D4", "TEKS-20260415-E5F6G7H8"]
 *     responses:
 *       200:
 *         description: Toplar bağlandı (başarılı/hatalı sayıları ile)
 *       404:
 *         description: İş emri bulunamadı
 */
router.patch("/:id/attach-rolls", verifyToken, requirePermission("workorder:write"), controller.attachRolls);

/**
 * @openapi
 * /api/work-orders/{id}/detach-rolls:
 *   patch:
 *     tags: [WorkOrders]
 *     summary: İş emrinden (sepetten) top çıkar
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollIds]
 *             properties:
 *               rollIds:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Toplar sepetten çıkarıldı
 */
router.patch("/:id/detach-rolls", verifyToken, requirePermission("workorder:write"), controller.detachRolls);

/**
 * @openapi
 * /api/work-orders/{id}/lock:
 *   patch:
 *     tags: [WorkOrders]
 *     summary: İş emrini kilitle (üretime al)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: İş emri kilitlendi
 */
router.patch("/:id/lock", verifyToken, requirePermission("workorder:write"), controller.lockWorkOrder);

/**
 * @openapi
 * /api/work-orders/{id}/rolls:
 *   get:
 *     tags: [WorkOrders]
 *     summary: Sepetteki (bağlanmış) topları getir
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Bağlanmış topların listesi
 */
router.get("/:id/rolls", verifyToken, requirePermission("workorder:read"), controller.getAttachedRolls);

/**
 * @openapi
 * /api/work-orders/{id}:
 *   delete:
 *     tags: [WorkOrders]
 *     summary: İş emrini iptal et (soft delete)
 *     description: |
 *       İş emrinin durumunu CANCELLED olarak günceller.
 *       Fiziksel silme yapılmaz; audit kaydı oluşturulur.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: İş emri iptal edildi
 *       404:
 *         description: İş emri bulunamadı
 */
router.delete("/:id", verifyToken, requirePermission("workorder:write"), controller.softDelete);

/**
 * @openapi
 * /api/work-orders/{id}/permanent:
 *   delete:
 *     tags: [WorkOrders]
 *     summary: İş emrini kalıcı olarak sil (hard delete)
 *     description: |
 *       İş emrini ve tüm bağlı adımları (WorkOrderStep, WorkOrderToOrderLine)
 *       veritabanından fiziksel olarak siler. Bu işlem geri alınamaz.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: İş emri kalıcı olarak silindi
 *       404:
 *         description: İş emri bulunamadı
 */
router.delete("/:id/permanent", verifyToken, requirePermission("workorder:write"), controller.hardDelete);

export default router;
