// =============================================================================
// TeksERP - Label Routes
// =============================================================================
// Mount: /api/labels
//
// Endpoint'ler:
//   GET    /api/labels/rolls/:id           → effective payload (label:read)
//   PATCH  /api/labels/order-lines/:id     → müşteri-isim override (label:edit)
//   POST   /api/labels/rolls/:id/print     → audit-only baskı eventi (label:print)
//
// Tasarım notu: 3 yetki ayrı tutulur. Operatöre print verirken edit'i alıkoyup
// (yanlış yazım garantisi), bir başkasına edit verip print'i kapatmak mümkün.
// =============================================================================

import { Router } from "express";
import { LabelController } from "../controllers/label.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const controller = new LabelController();
const router = Router();

/**
 * @openapi
 * /api/labels/rolls/{id}:
 *   get:
 *     tags: [Labels]
 *     summary: Rulonun etiket payload'unu effective name cascade ile döner
 *     description: |
 *       Cascade: OrderLine.customerItemName (varsa) → CustomerItemAlias master
 *       (varsa) → Item.name (default). Aynısı color için. Allocation YOKSA
 *       customerName/orderNumber/orderLineId NULL → frontend müşteri bloğunu
 *       render etmez (boş satır göstermez, blok komple gizlenir).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: LabelPayload }
 *       404: { description: Top bulunamadı }
 */
router.get(
  "/rolls/:id",
  verifyToken,
  requirePermission("label:read"),
  controller.getRollLabel,
);

/**
 * @openapi
 * /api/labels/swatches/{id}:
 *   get:
 *     tags: [Labels]
 *     summary: Kartela etiket payload'u (parentRoll allocation üzerinden cascade)
 *     description: |
 *       Kartelanın müşteri çözümü dolaylı: parentRoll → allocation → orderLine →
 *       order → customer. Bağ yoksa müşteri alanları null. Cascade aynı:
 *       OrderLine override > master alias > default.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: SwatchLabelPayload }
 *       404: { description: Kartela bulunamadı }
 */
router.get(
  "/swatches/:id",
  verifyToken,
  requirePermission("label:read"),
  controller.getSwatchLabel,
);

/**
 * @openapi
 * /api/labels/order-lines/{id}:
 *   patch:
 *     tags: [Labels]
 *     summary: Sipariş satırı bazlı müşteri-isim override
 *     description: |
 *       OrderLine.customerItemName / customerColorName yazar. Bu değer master
 *       alias'ı EZER (1-shot). Boş string / null gönderilirse override silinir
 *       → master/default'a düşer. Master kayıtları hiç değiştirilmez.
 *
 *       Önemli: Sipariş satırına bağlı TÜM rulları etkiler (sipariş seviyesi).
 *       Tek rulda farklı isim için frontend operatöre uyarı vermeli.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid, description: "OrderLine ID" }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               customerItemName:  { type: string, nullable: true, maxLength: 200 }
 *               customerColorName: { type: string, nullable: true, maxLength: 200 }
 *     responses:
 *       200: { description: Güncel override değerleri }
 *       400: { description: En az bir alan gerekli }
 *       404: { description: Sipariş satırı bulunamadı }
 */
router.patch(
  "/order-lines/:id",
  verifyToken,
  requirePermission("label:edit"),
  controller.updateOrderLineCustomerNames,
);

/**
 * @openapi
 * /api/labels/rolls/{id}/print:
 *   post:
 *     tags: [Labels]
 *     summary: Etiket basıldı eventi (audit-only)
 *     description: |
 *       Asıl baskı tarayıcı/yazıcıda gerçekleşir. Bu endpoint sadece SystemLog'a
 *       "kim, ne zaman, hangi rulonun etiketini bastı" izini düşer.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Event kaydedildi }
 *       404: { description: Top bulunamadı }
 */
router.post(
  "/rolls/:id/print",
  verifyToken,
  requirePermission("label:print"),
  controller.recordPrintEvent,
);

export default router;
