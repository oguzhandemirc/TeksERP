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
// ÇUVAL (SACK)
// ===========================================================================

/**
 * @openapi
 * /api/shipping/sacks:
 *   post:
 *     tags: [Shipping]
 *     summary: Yeni çuval aç (tek müşteri + tek şube)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerId]
 *             properties:
 *               customerId: { type: string, format: uuid }
 *               branchId:   { type: string, format: uuid }
 *               sackNo:     { type: string, description: "Offline client barkodu (opsiyonel)" }
 *     responses:
 *       201: { description: Çuval açıldı }
 *   get:
 *     tags: [Shipping]
 *     summary: Çuval listesi (customerId / status / unassignedOnly filtreleri)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [OPEN, CLOSED, SHIPPED] }
 *       - in: query
 *         name: customerId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: unassignedOnly
 *         schema: { type: boolean }
 *     responses:
 *       200: { description: Çuval listesi }
 */
router.post("/sacks", verifyToken, WRITE, controller.createSack);
router.get("/sacks", verifyToken, READ, controller.listSacks);

/**
 * @openapi
 * /api/shipping/sacks/assign-roll:
 *   post:
 *     tags: [Shipping]
 *     summary: Topu çuvala ekle (Roll.sackId + targetOrderLineId)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollId, sackId]
 *             properties:
 *               rollId:            { type: string, format: uuid }
 *               sackId:            { type: string, format: uuid }
 *               targetOrderLineId: { type: string, format: uuid }
 *     responses:
 *       200: { description: Top çuvala eklendi }
 */
router.post("/sacks/assign-roll", verifyToken, WRITE, controller.assignRoll);
router.post("/sacks/remove-roll", verifyToken, WRITE, controller.removeRoll);
router.post("/sacks/assign-swatch", verifyToken, WRITE, controller.assignSwatch);
router.post("/sacks/remove-swatch", verifyToken, WRITE, controller.removeSwatch);

/**
 * @openapi
 * /api/shipping/sacks/{id}/weigh:
 *   post:
 *     tags: [Shipping]
 *     summary: Çuvalı tart + kapat (SEVK EDİLDİ anı — toplar SHIPPED, sipariş güncellenir)
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
 *     responses:
 *       200: { description: Çuval kapatıldı }
 */
router.post("/sacks/:id/weigh", verifyToken, WRITE, controller.weighSack);

/**
 * @openapi
 * /api/shipping/sacks/{id}:
 *   get:
 *     tags: [Shipping]
 *     summary: Çuval detayı (toplar + kartelalar)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Çuval detayı }
 */
router.get("/sacks/:id", verifyToken, READ, controller.getSack);

// ===========================================================================
// İRSALİYE (SHIPMENT)
// ===========================================================================

/**
 * @openapi
 * /api/shipping/shipments:
 *   post:
 *     tags: [Shipping]
 *     summary: Yeni irsaliye (bir müşteri + şube)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerId]
 *             properties:
 *               customerId:  { type: string, format: uuid }
 *               branchId:    { type: string, format: uuid }
 *               plateNumber: { type: string }
 *               driverName:  { type: string }
 *               carrier:     { type: string }
 *     responses:
 *       201: { description: İrsaliye oluşturuldu }
 *   get:
 *     tags: [Shipping]
 *     summary: İrsaliye listesi (status / customerId)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PREPARING, DISPATCHED, CANCELLED] }
 *       - in: query
 *         name: customerId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: İrsaliye listesi }
 */
router.post("/shipments", verifyToken, WRITE, controller.createShipment);
router.get("/shipments", verifyToken, READ, controller.listShipments);

/**
 * @openapi
 * /api/shipping/shipments/{id}:
 *   get:
 *     tags: [Shipping]
 *     summary: İrsaliye detayı (çuvallar)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: İrsaliye detayı }
 */
router.get("/shipments/:id", verifyToken, READ, controller.getShipment);

/**
 * @openapi
 * /api/shipping/shipments/{id}/add-sack:
 *   post:
 *     tags: [Shipping]
 *     summary: Kapalı çuvalı irsaliyeye bağla
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
 *             required: [sackId]
 *             properties:
 *               sackId: { type: string, format: uuid }
 *     responses:
 *       200: { description: Çuval eklendi }
 */
router.post("/shipments/:id/add-sack", verifyToken, WRITE, controller.addSack);
router.post("/shipments/:id/remove-sack", verifyToken, WRITE, controller.removeSack);

/**
 * @openapi
 * /api/shipping/shipments/{id}/dispatch:
 *   post:
 *     tags: [Shipping]
 *     summary: İrsaliyeyi sevk et (kamyona yükle → DISPATCHED, çuvallar SHIPPED)
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
 *               plateNumber: { type: string }
 *               driverName:  { type: string }
 *               carrier:     { type: string }
 *     responses:
 *       200: { description: İrsaliye sevk edildi }
 */
router.post("/shipments/:id/dispatch", verifyToken, WRITE, controller.dispatchShipment);

// ===========================================================================
// SEVKE HAZIR + DEĞİŞEBİLİR ETİKET
// ===========================================================================

/**
 * @openapi
 * /api/shipping/ready:
 *   get:
 *     tags: [Shipping]
 *     summary: Sevke hazır siparişler (depoda etiketli + çuvalda olmayan topu olanlar, termine göre)
 *     description: Mod A "Sevke Hazır" listesini besler. Her satırda istenen/sevk/açık metraj + hazır top sayısı/metrajı.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Sevke hazır sipariş listesi }
 */
router.get("/ready", verifyToken, READ, controller.getReady);

/**
 * @openapi
 * /api/shipping/relabel:
 *   post:
 *     tags: [Shipping]
 *     summary: Değişebilir etiket / yönlendir (topun sipariş atıfını değiştir — stok hareketi değil)
 *     description: >
 *       Topun targetOrderLineId atıfını değiştirir. SHIPPED/iptal/scrap/tüketilmiş top
 *       yeniden etiketlenemez. STOCK top bir siparişe yönlendirilirse WAREHOUSE'a alınır.
 *       Spec uyumsuzluğu blok değil (specMismatch bayrağı). Eski+yeni sipariş yeniden hesaplanır.
 *       targetOrderLineId null = etiketi kaldır (stoğa al). Fiziksel etiket sonradan basılır.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollId, targetOrderLineId]
 *             properties:
 *               rollId:            { type: string, format: uuid }
 *               targetOrderLineId: { type: string, format: uuid, nullable: true }
 *     responses:
 *       200: { description: "Etiket güncellendi (data: { rollId, customerName, specMismatch, reprintRequired })" }
 */
router.post("/relabel", verifyToken, WRITE, controller.relabel);

/**
 * @openapi
 * /api/shipping/sacks/auto-assign:
 *   post:
 *     tags: [Shipping]
 *     summary: Hızlı Okut (Mod C) — barkodla top okut, topun müşterisinin açık çuvalına otomatik ekle (yoksa aç)
 *     description: >
 *       Müşteri seçtirmez. Top WAREHOUSE + sipariş etiketli (targetOrderLineId) olmalı.
 *       Stok etiketli top reddedilir (önce yönlendir). Topun siparişinin müşterisinin
 *       açık çuvalı varsa ona ekler, yoksa yeni çuval açıp ekler.
 *     security: [{ bearerAuth: [] }]
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
 *       200: { description: "Top çuvala eklendi (data: { sackId, sackNo, customerId, customerName, createdSack })" }
 */
router.post("/sacks/auto-assign", verifyToken, WRITE, controller.autoAssign);

/**
 * @openapi
 * /api/shipping/reprint-queue:
 *   get:
 *     tags: [Shipping]
 *     summary: Yeniden basılacak etiketler (relabel sonrası — tek yazıcı/tambur listesi)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Yeniden basılacak toplar (barkod + müşteri/sipariş + spec) }
 */
router.get("/reprint-queue", verifyToken, READ, controller.reprintQueue);

/**
 * @openapi
 * /api/shipping/reprint-queue/done:
 *   post:
 *     tags: [Shipping]
 *     summary: Etiket basıldı → topu print-queue'dan düşür
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollId]
 *             properties:
 *               rollId: { type: string, format: uuid }
 *     responses:
 *       200: { description: Kuyruktan düşürüldü }
 */
router.post("/reprint-queue/done", verifyToken, WRITE, controller.markReprinted);

export default router;
