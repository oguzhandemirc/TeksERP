// =============================================================================
// TeksERP - Shipping Routes
// =============================================================================

import { Router } from "express";
import { ShippingController } from "../controllers/shipping.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const controller = new ShippingController();
const router = Router();

/**
 * @openapi
 * /api/shipping/ready-orders:
 *   get:
 *     tags: [Shipping]
 *     summary: Sevkiyata hazır siparişler
 *     description: |
 *       Tahsis edilmiş topları PRODUCED veya READY_FOR_SHIP durumunda olan siparişleri listeler.
 *       Sevkiyat departmanı iş emirlerini görmez; sadece sipariş bilgilerini görür.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Sevkiyata hazır sipariş listesi
 */
router.get("/ready-orders", verifyToken, requirePermission("shipment:read"), controller.getReadyOrders);

/**
 * @openapi
 * /api/shipping/ready-fason:
 *   get:
 *     tags: [Shipping]
 *     summary: Sevke hazır fason (müşteri-malı) toplar
 *     description: |
 *       `ownerCustomerId` dolu olan ve PRODUCED/READY_FOR_SHIP/A1_STOCK durumundaki
 *       toplar müşteriye göre gruplanır. Sipariş tahsisi olmadan doğrudan sahibine
 *       sevk edilir.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Müşteriye göre gruplanmış fason top listesi
 */
router.get("/ready-fason", verifyToken, requirePermission("shipment:read"), controller.getReadyFasonRolls);

/**
 * @openapi
 * /api/shipping/prepare-package:
 *   post:
 *     tags: [Shipping]
 *     summary: Paket hazırla (çuvallama / paletleme)
 *     description: |
 *       Topları bir pakete (çuval/palet) atar.
 *       Topların status'u READY_FOR_SHIP'e güncellenir.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollIds, packageId, grossWeightKg]
 *             properties:
 *               rollIds:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *               packageId:
 *                 type: string
 *                 description: Paket/çuval barkodu
 *                 example: "PKT-001"
 *               grossWeightKg:
 *                 type: number
 *                 description: Brüt kilo (tartıdan)
 *                 example: 85.5
 *     responses:
 *       200:
 *         description: Paketleme tamamlandı
 */
router.post("/prepare-package", verifyToken, requirePermission("shipment:write"), controller.preparePackage);

/**
 * @openapi
 * /api/shipping/shipments:
 *   post:
 *     tags: [Shipping]
 *     summary: Yeni sevkiyat (irsaliye) oluştur
 *     description: Yeni bir sevkiyat kaydı oluşturur. İrsaliye numarası otomatik üretilir.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerId]
 *             properties:
 *               customerId:
 *                 type: string
 *                 format: uuid
 *               driverName:
 *                 type: string
 *                 example: "Ahmet Yılmaz"
 *               plateNumber:
 *                 type: string
 *                 example: "34 ABC 123"
 *               carrier:
 *                 type: string
 *                 example: "Hızlı Nakliyat"
 *     responses:
 *       201:
 *         description: Sevkiyat oluşturuldu
 *       404:
 *         description: Müşteri bulunamadı
 */
router.post("/shipments", verifyToken, requirePermission("shipment:write"), controller.createShipment);

/**
 * @openapi
 * /api/shipping/shipments:
 *   get:
 *     tags: [Shipping]
 *     summary: Sevkiyatları listele
 *     description: Tüm sevkiyatları listeler. Opsiyonel `status` (PREPARING/SHIPPED/CANCELLED) ve `customerId` filtreleri.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PREPARING, SHIPPED, CANCELLED] }
 *       - in: query
 *         name: customerId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Sevkiyat listesi
 */
router.get("/shipments", verifyToken, requirePermission("shipment:read"), controller.listShipments);

/**
 * @openapi
 * /api/shipping/shipments/{id}:
 *   get:
 *     tags: [Shipping]
 *     summary: Tek sevkiyat detay
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Sevkiyat detayı (kalemler dahil)
 *       404:
 *         description: Sevkiyat bulunamadı
 */
router.get("/shipments/:id", verifyToken, requirePermission("shipment:read"), controller.getShipmentById);

/**
 * @openapi
 * /api/shipping/shipments/{id}/print:
 *   get:
 *     tags: [Shipping]
 *     summary: İrsaliye yazdırma snapshot'ı (donmuş belge)
 *     description: |
 *       Finalize edilmiş bir sevkiyat için dondurulmuş yazdırma snapshot'ı döner.
 *       Ürün, müşteri alias'ı, iş emri gibi alanlar sonradan değişse/silinse bile
 *       belge aynı kalır. PREPARING sevkiyatlarda canlı hesaplanır ve
 *       `frozen: false` döner.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Snapshot verisi }
 *       404: { description: Sevkiyat bulunamadı }
 */
router.get("/shipments/:id/print", verifyToken, requirePermission("shipment:read"), controller.getPrintSnapshot);

/**
 * @openapi
 * /api/shipping/shipments/{id}/add-items:
 *   patch:
 *     tags: [Shipping]
 *     summary: Sevkiyata ürün ekle
 *     description: |
 *       Topları sevkiyata ekler.
 *       **ESNEK YENİDEN ATAMA:** Başka müşterinin siparişine tahsis edilmiş toplar
 *       otomatik olarak eski tahsisten ayrılıp bu sevkiyatın müşterisine atanır.
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
 *         description: Ürünler eklendi (eklenen/yeniden atanan sayıları ile)
 */
router.patch("/shipments/:id/add-items", verifyToken, requirePermission("shipment:write"), controller.addItems);

/**
 * @openapi
 * /api/shipping/shipments/{id}/finalize:
 *   post:
 *     tags: [Shipping]
 *     summary: Sevkiyat onayla (finalize)
 *     description: |
 *       Sevkiyatı onaylar. Tüm toplar SHIPPED durumuna geçer.
 *       
 *       **OTOMATİK SİPARİŞ TAMAMLAMA:**
 *       Etkilenen her sipariş için toplam sevk miktarı kontrol edilir.
 *       Sevk edilen >= talep edilen ise sipariş COMPLETED yapılır.
 *       Aksi halde PARTIAL_SHIPPED olarak güncellenir.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Sevkiyat onaylandı (tamamlanan/kısmi siparişler belirtilir)
 *       400:
 *         description: Sevkiyat boş veya zaten finalize edilmiş
 *       404:
 *         description: Sevkiyat bulunamadı
 */
router.post("/shipments/:id/finalize", verifyToken, requirePermission("shipment:write"), controller.finalize);

export default router;
