// =============================================================================
// TeksERP - Allocation Routes
// =============================================================================
// Allocation Center akışı (Planlama Şefi). Mevcut tambur.allocate ile aynı
// permission kullanır (allocation:write) ama daha geniş status seti kabul eder.
// =============================================================================

import { Router } from "express";
import { AllocationController } from "../controllers/allocation.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const controller = new AllocationController();
const router = Router();

/**
 * @openapi
 * /api/allocations/pending-orders:
 *   get:
 *     tags: [Allocations]
 *     summary: Tahsis bekleyen siparişler (sayfalı; kalan ihtiyaç > 0)
 *     description: |
 *       Sayfalama: limit (1-100, default 20), offset (default 0).
 *       q: orderNumber/customer/item.name üzerinde ILIKE arama.
 *       customerId: opsiyonel müşteri filtresi (sevkiyat planlama için).
 *       Sıra: deadline ASC NULLS LAST → createdAt DESC.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, minimum: 0, default: 0 }
 *       - in: query
 *         name: customerId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Sipariş listesi + pagination }
 */
router.get(
  "/pending-orders",
  verifyToken,
  requirePermission("allocation:write"),
  controller.getPendingOrders
);

/**
 * @openapi
 * /api/allocations/matching-stock/{orderLineId}:
 *   get:
 *     tags: [Allocations]
 *     summary: Bir sipariş satırına uyan stok rolleri
 *     description: |
 *       itemId / variantId eşleşen, PRODUCED/READY_FOR_SHIP/A1_STOCK durumundaki,
 *       ownerCustomerId çakışmayan, kalan kapasitesi olan roller.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: orderLineId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Uyumlu stok rolleri }
 *       404: { description: Sipariş satırı bulunamadı }
 */
router.get(
  "/matching-stock/:orderLineId",
  verifyToken,
  requirePermission("allocation:write"),
  controller.getMatchingStock
);

/**
 * @openapi
 * /api/allocations:
 *   post:
 *     tags: [Allocations]
 *     summary: Stoktan bir rolü sipariş satırına tahsis et
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollId, orderLineId, allocatedQty]
 *             properties:
 *               rollId: { type: string, format: uuid }
 *               orderLineId: { type: string, format: uuid }
 *               allocatedQty: { type: number, minimum: 0.01 }
 *     responses:
 *       201: { description: Tahsis oluşturuldu }
 *       400: { description: Validation hatası }
 *       404: { description: Top / sipariş satırı bulunamadı }
 *       409: { description: Aynı çift zaten tahsis edilmiş }
 */
router.post(
  "/",
  verifyToken,
  requirePermission("allocation:write"),
  controller.allocate
);

/**
 * @openapi
 * /api/allocations/reassign:
 *   post:
 *     tags: [Allocations]
 *     summary: Mevcut bir allocation'ı başka sipariş satırına taşı (Phase 2)
 *     description: |
 *       Acil sipariş senaryosu: başka siparişe bağlı bir top o acil siparişe
 *       yönlendirilir. Kaynak sipariş için ReproductionBacklog kaydı oluşur.
 *       SHIPPED rolün allocation'ı taşınamaz.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [allocationId, newOrderLineId, reason]
 *             properties:
 *               allocationId:   { type: string, format: uuid }
 *               newOrderLineId: { type: string, format: uuid }
 *               reason:         { type: string, minLength: 1, maxLength: 500 }
 *     responses:
 *       200: { description: Allocation taşındı + backlog oluştu }
 *       400: { description: Validation veya iş kuralı hatası }
 *       404: { description: Allocation veya hedef satır bulunamadı }
 */
router.post(
  "/reassign",
  verifyToken,
  requirePermission("allocation:write"),
  controller.reassign
);

/**
 * @openapi
 * /api/allocations/suggestions:
 *   get:
 *     tags: [Allocations]
 *     summary: Bir hedef sipariş satırı için yeniden tahsis adayları (Phase 2)
 *     description: |
 *       Aynı item/variant'taki, sevk edilmemiş, kapalı sipariş'e ait olmayan
 *       allocation'ları listeler. Önceliklendirme: kaynak sipariş termini ASC
 *       (en uzak terminden öneri başlar — onu çalmak daha güvenli).
 *       Otomatik taşıma yok; planlamacı seçim yapar.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: orderLineId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Aday listesi (deadlineSlackDays sinyali dahil) }
 *       404: { description: Hedef sipariş satırı bulunamadı }
 */
router.get(
  "/suggestions",
  verifyToken,
  requirePermission("allocation:write"),
  controller.getSuggestions
);

export default router;
