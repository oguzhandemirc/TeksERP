import { Router } from "express";
import { ShippingController } from "../controllers/shipping.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission } from "../middlewares/rbac.middleware";

const controller = new ShippingController();
const router = Router();

// Okuma: web sevkiyat yetkisi veya mobil paket/sevkiyat ekranları
const READ = requireAnyPermission(
  "shipping:read",
  "shipping:write",
  "mobile:tarti-paket",
  "mobile:sevkiyat"
);
// Yazma: web sevkiyat yazma veya mobil paket/sevkiyat ekranları
const WRITE = requireAnyPermission("shipping:write", "mobile:tarti-paket", "mobile:sevkiyat");

// ===========================================================================
// SİPARİŞ SEÇİM (Mod A) — açık siparişler + depo karşılaması
// ===========================================================================

/**
 * @openapi
 * /api/shipping/open-orders:
 *   get:
 *     tags: [Shipping]
 *     summary: Açık siparişler + depo karşılaması (sipariş-önce paketleme girişi)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: customerId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: branchId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Açık siparişler + satır bazlı karşılama }
 */
router.get("/open-orders", verifyToken, READ, controller.openOrders);

// ===========================================================================
// SEVKİYAT OTURUMU (SHIPMENT)
// ===========================================================================

/**
 * @openapi
 * /api/shipping/shipments:
 *   post:
 *     tags: [Shipping]
 *     summary: Yeni sevkiyat oturumu aç (seçilen siparişlerden müşteri+şube türetilir)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderIds]
 *             properties:
 *               orderIds: { type: array, items: { type: string, format: uuid } }
 *     responses:
 *       201: { description: Sevkiyat açıldı }
 *   get:
 *     tags: [Shipping]
 *     summary: Sevkiyat listesi (status / customerId filtreleri)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PREPARING, READY, DISPATCHED, CANCELLED] }
 *       - in: query
 *         name: customerId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Sevkiyat listesi }
 */
router.post("/shipments", verifyToken, WRITE, controller.createShipment);
router.get("/shipments", verifyToken, READ, controller.listShipments);

/**
 * @openapi
 * /api/shipping/shipments/{id}:
 *   get:
 *     tags: [Shipping]
 *     summary: Sevkiyat detayı (siparişler + karşılama projeksiyonu + toplar + çuvallar)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Sevkiyat detayı }
 */
router.get("/shipments/:id", verifyToken, READ, controller.getShipment);

// Seçilen siparişleri düzenle
router.post("/shipments/:id/orders", verifyToken, WRITE, controller.addOrders);
router.post("/shipments/:id/remove-order", verifyToken, WRITE, controller.removeOrder);

/**
 * @openapi
 * /api/shipping/shipments/{id}/scan:
 *   post:
 *     tags: [Shipping]
 *     summary: Barkod okut → top/kartelayı sevkiyata ekle (depodaki serbest mal)
 *     security: [{ bearerAuth: [] }]
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
 *             required: [barcode]
 *             properties:
 *               barcode: { type: string }
 *     responses:
 *       200: { description: Eklendi }
 */
router.post("/shipments/:id/scan", verifyToken, WRITE, controller.scan);
router.post("/shipments/:id/remove-roll", verifyToken, WRITE, controller.removeRoll);
router.post("/shipments/:id/remove-swatch", verifyToken, WRITE, controller.removeSwatch);

/**
 * @openapi
 * /api/shipping/shipments/{id}/sacks:
 *   post:
 *     tags: [Shipping]
 *     summary: Çuval ekle (tartı — sadece no + kg, içerik tutmaz)
 *     security: [{ bearerAuth: [] }]
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
 *             required: [weightKg]
 *             properties:
 *               weightKg: { type: number }
 *               sackNo:   { type: string, description: "Offline client barkodu (opsiyonel)" }
 *     responses:
 *       201: { description: Çuval eklendi }
 */
router.post("/shipments/:id/sacks", verifyToken, WRITE, controller.addSack);

/**
 * @openapi
 * /api/shipping/shipments/{id}/ready:
 *   post:
 *     tags: [Shipping]
 *     summary: Sevke Hazır — karşılanma düşülür (spec-FIFO), toplar SHIPPED, kapıda
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Sevke hazır }
 */
router.post("/shipments/:id/ready", verifyToken, WRITE, controller.markReady);
router.post("/shipments/:id/dispatch", verifyToken, WRITE, controller.dispatchShipment);
router.get("/shipments/:id/cancel-preview", verifyToken, READ, controller.cancelPreview);
router.post("/shipments/:id/cancel", verifyToken, WRITE, controller.cancelShipment);

// ===========================================================================
// ÇUVAL (tartı) — güncelle / sil
// ===========================================================================
router.post("/sacks/:id/weigh", verifyToken, WRITE, controller.weighSack);
router.post("/sacks/:id/remove", verifyToken, WRITE, controller.removeSack);

export default router;
