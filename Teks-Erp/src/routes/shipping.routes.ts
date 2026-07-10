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
// Muhasebe okuma (saha #2): sevk edilenler listesi + sevk fişi raporu — muhasebeci
// yalnız satış raporu izniyle de erişebilsin (sevkiyat yazma izni gerekmez).
const ACCOUNTING_READ = requireAnyPermission("shipping:read", "shipping:write", "report:sales");

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
 *         schema: { type: string, enum: [PREPARING, READY, AT_DOOR, DISPATCHED, CANCELLED] }
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
 * /api/shipping/sack-store/board:
 *   get:
 *     tags: [Shipping]
 *     summary: Çuval Depo board'u (Electron + mobil — HAFİF, sayfalı, aramalı)
 *     description: >
 *       Rulo ÇEKMEZ — sadece kart sayaçları (çuval/top adedi, kg, metraj).
 *       Çuval+rulo dökümü için /shipments/{id}/sack-contents (karta tıklayınca lazy).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [READY, AT_DOOR] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 30, maximum: 100 }
 *     responses:
 *       200: { description: Çuval depo board listesi (cursor sayfalı) }
 */
router.get("/sack-store/board", verifyToken, READ, controller.listSackStoreBoard);

// ===========================================================================
// ÇUVAL/TOP ARAMA (saha #1+#23) — salt-okunur sorgu ekranı
// ===========================================================================

/**
 * @openapi
 * /api/shipping/sack-search:
 *   get:
 *     tags: [Shipping]
 *     summary: Çuval arama — içerik (ürün/renk/en) ve kimlik (kod/sevkiyat/müşteri) filtreli
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: itemId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: colorId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: width
 *         schema: { type: number }
 *       - in: query
 *         name: customerId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: shipmentNo
 *         schema: { type: string }
 *       - in: query
 *         name: sackCode
 *         schema: { type: string }
 *       - in: query
 *         name: includeDispatched
 *         schema: { type: string, enum: ["true", "false"] }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 30, maximum: 100 }
 *     responses:
 *       200: { description: Çuval listesi (cursor sayfalı; içerik filtresinde eşleşen adet/metre dahil) }
 */
router.get("/sack-search", verifyToken, READ, controller.searchSacks);

/**
 * @openapi
 * /api/shipping/sack-search/pick-list:
 *   post:
 *     tags: [Shipping]
 *     summary: Çeki listesi — seçilen çuvalların içerik özetli dökümü (salt-okunur; body taşıyan okuma)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sackIds]
 *             properties:
 *               sackIds:
 *                 type: array
 *                 maxItems: 200
 *                 items: { type: string, format: uuid }
 *     responses:
 *       200: { description: Çuval dökümü — ürün·renk·en özetli, sevkiyat+müşteri bilgili }
 *       400: { description: Boş/aşırı seçim }
 */
router.post("/sack-search/pick-list", verifyToken, READ, controller.getPickList);

/**
 * @openapi
 * /api/shipping/sacks/{id}/contents:
 *   get:
 *     tags: [Shipping]
 *     summary: Tek çuvalın dökümü (arama satırı genişletilince lazy)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Çuval + toplar + kartelalar }
 *       404: { description: Çuval bulunamadı }
 */
router.get("/sacks/:id/contents", verifyToken, READ, controller.getSackContents);

/**
 * @openapi
 * /api/shipping/locate-roll:
 *   get:
 *     tags: [Shipping]
 *     summary: Top yerini bul — barkod tam eşleşme (çuval + sevkiyat + statü)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: barcode
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Top + bulunduğu çuval/sevkiyat }
 *       404: { description: Top bulunamadı }
 */
router.get("/locate-roll", verifyToken, READ, controller.locateRoll);

/**
 * @openapi
 * /api/shipping/shipments/{id}/sack-contents:
 *   get:
 *     tags: [Shipping]
 *     summary: Bir sevkiyatın tam çuval+rulo dökümü (board kartı slide-over içeriği)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Sevkiyat çuvalları + içlerindeki toplar }
 *       404: { description: Sevkiyat bulunamadı }
 */
router.get("/shipments/:id/sack-contents", verifyToken, READ, controller.getShipmentSackContents);

/**
 * @openapi
 * /api/shipping/shipments/{id}/dispatch-report:
 *   get:
 *     tags: [Shipping]
 *     summary: Muhasebe sevk fişi — ürün/çuval/çeki listesi (saha #2, ornek-fis formatı)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: 3 bölümlü sevk fişi verisi (header + products + sacks + cekiRows + totals) }
 *       404: { description: Sevkiyat bulunamadı }
 */
router.get("/shipments/:id/dispatch-report", verifyToken, ACCOUNTING_READ, controller.getDispatchReport);

/**
 * @openapi
 * /api/shipping/accounting-export:
 *   get:
 *     tags: [Shipping]
 *     summary: Muhasebe Excel dökümü — DISPATCHED sevk listesi/detay/icmal/iade (tarih + müşteri filtresi)
 *     description: >
 *       Ekran filtresini (filter[customerId], dateField/dateFrom/dateTo, search) listShipments ile
 *       aynı whitelist üzerinden uygular; status zorla DISPATCHED. Frontend exceljs ile .xlsx üretir.
 *       Sevkiyat sayısı üst sınırı aşarsa 400 (aralığı daraltın).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: dateField, schema: { type: string, enum: [dispatchedAt, createdAt] } }
 *       - { in: query, name: dateFrom, schema: { type: string, format: date-time } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date-time } }
 *       - { in: query, name: "filter[customerId]", schema: { type: string, format: uuid } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       200: { description: Muhasebe veri seti (shipments + detail + byCustomer + byProduct + returns + totals) }
 *       400: { description: Sevkiyat sayısı üst sınırı aştı — aralığı daraltın }
 */
router.get("/accounting-export", verifyToken, ACCOUNTING_READ, controller.getAccountingExport);

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
/**
 * @openapi
 * /api/shipping/shipments/{id}/orders:
 *   post:
 *     tags: [Shipping]
 *     summary: Sevkiyata sipariş(ler) ekle (kapsam hedefi)
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
 *             required: [orderIds]
 *             properties:
 *               orderIds: { type: array, items: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Siparişler eklendi }
 *       409: { description: Sevkiyat PREPARING değil }
 */
router.post("/shipments/:id/orders", verifyToken, WRITE, controller.addOrders);

/**
 * @openapi
 * /api/shipping/shipments/{id}/destination:
 *   post:
 *     tags: [Shipping]
 *     summary: Yurtiçi/yurtdışı kapsamı değiştir (saha #19 — sevk edilmemiş her durumda)
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
 *             required: [destination]
 *             properties:
 *               destination: { type: string, enum: [DOMESTIC, EXPORT] }
 *     responses:
 *       200: { description: Kapsam güncellendi }
 *       409: { description: Sevkiyat sevk/iptal edilmiş }
 */
router.post("/shipments/:id/destination", verifyToken, WRITE, controller.setDestination);

/**
 * @openapi
 * /api/shipping/shipments/{id}/procedure-code:
 *   post:
 *     tags: [Shipping]
 *     summary: Sevkiyata özel prosedür/ihracat kodu güncelle (saha #21; boş = temizle)
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
 *             properties:
 *               procedureCode: { type: string, nullable: true, maxLength: 64 }
 *     responses:
 *       200: { description: Prosedür kodu güncellendi }
 *       409: { description: Sevkiyat sevk/iptal edilmiş }
 */
router.post("/shipments/:id/procedure-code", verifyToken, WRITE, controller.setProcedureCode);
/**
 * @openapi
 * /api/shipping/shipments/{id}/remove-order:
 *   post:
 *     tags: [Shipping]
 *     summary: Sevkiyattan sipariş çıkar (kapsam hedefinden)
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
 *             required: [orderId]
 *             properties:
 *               orderId: { type: string, format: uuid }
 *     responses:
 *       200: { description: Sipariş çıkarıldı }
 *       409: { description: Sevkiyat PREPARING değil }
 */
router.post("/shipments/:id/remove-order", verifyToken, WRITE, controller.removeOrder);

/**
 * @openapi
 * /api/shipping/shipments/{id}/retarget-orders:
 *   post:
 *     tags: [Shipping]
 *     summary: Sevkiyatı yeniden hedefle (saha #7 — bağlı sipariş kümesini değiştir)
 *     description: |
 *       Sevkiyatın karşılanma spec-set'ini (bağlı siparişleri) TAMAMEN değiştirir.
 *       READY/AT_DOOR'da commit geri sarılıp yeni kümeyle yeniden yazılır. DISPATCHED hariç.
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
 *             required: [orderIds]
 *             properties:
 *               orderIds: { type: array, items: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Yeniden hedeflendi }
 *       409: { description: Sevk edilmiş/iptal sevkiyat }
 */
router.post("/shipments/:id/retarget-orders", verifyToken, WRITE, controller.retargetOrders);

/**
 * @openapi
 * /api/shipping/shipments/{id}/retarget-preview:
 *   post:
 *     tags: [Shipping]
 *     summary: Yeniden hedefleme önizlemesi (saha #7 — SALT-OKUNUR projeksiyon)
 *     description: |
 *       Aday sipariş kümesi için karşılanma projeksiyonunu COMMIT ETMEDEN döner.
 *       DB'ye hiçbir şey yazmaz. Sonuç gerçek retarget commit'iyle birebir aynıdır.
 *       Her sipariş için planlanan/karşılanmış/projeksiyon/kapsama%; toplamda
 *       mal/tahsis/artan (leftover). Geçersiz adaylar `ignored`'da listelenir.
 *       DISPATCHED/CANCELLED'da `editable:false` döner (hata atmaz).
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
 *             required: [orderIds]
 *             properties:
 *               orderIds: { type: array, items: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: Projeksiyon
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     editable: { type: boolean }
 *                     orders:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           orderId: { type: string }
 *                           orderNumber: { type: string }
 *                           planned: { type: number }
 *                           alreadyShipped: { type: number }
 *                           projected: { type: number }
 *                           coveragePct: { type: number }
 *                     totals:
 *                       type: object
 *                       properties:
 *                         goods: { type: number }
 *                         projectedTotal: { type: number }
 *                         leftover: { type: number }
 *                     ignored:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           orderNumber: { type: string }
 *                           reason: { type: string }
 *       404: { description: Sevkiyat bulunamadı }
 */
router.post("/shipments/:id/retarget-preview", verifyToken, READ, controller.retargetPreview);

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
 *               sackId:  { type: string, format: uuid, description: "Aktif çuval — verilirse içerik bu çuvala yazılır" }
 *     responses:
 *       200: { description: Eklendi }
 */
router.post("/shipments/:id/scan", verifyToken, WRITE, controller.scan);

/**
 * @openapi
 * /api/shipping/shipments/{id}/remove-roll:
 *   post:
 *     tags: [Shipping]
 *     summary: Sevkiyattan top çıkar (çuvaldan da sökülür)
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
 *             required: [rollId]
 *             properties:
 *               rollId: { type: string, format: uuid }
 *     responses:
 *       200: { description: Top çıkarıldı }
 *       409: { description: Sevkiyat düzenlenebilir durumda değil }
 */
router.post("/shipments/:id/remove-roll", verifyToken, WRITE, controller.removeRoll);

/**
 * @openapi
 * /api/shipping/shipments/{id}/remove-swatch:
 *   post:
 *     tags: [Shipping]
 *     summary: Sevkiyattan kartela çıkar
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
 *             required: [swatchId]
 *             properties:
 *               swatchId: { type: string, format: uuid }
 *     responses:
 *       200: { description: Kartela çıkarıldı }
 *       409: { description: Sevkiyat düzenlenebilir durumda değil }
 */
router.post("/shipments/:id/remove-swatch", verifyToken, WRITE, controller.removeSwatch);

/**
 * @openapi
 * /api/shipping/shipments/{id}/add-kartela:
 *   post:
 *     tags: [Shipping]
 *     summary: Seçerek kartela ekle — ürün+renk stok grubundan N adet (barkod okutmadan)
 *     description: >
 *       Kartelaların fiziksel etiketi yoktur; barkod okutmak yerine ürün+renk
 *       stok grubu (bkz. GET /api/kartela/stock) ve adet seçilir. O gruptan N
 *       müsait kartela atomik claim ile bu sevkiyata (verilirse aktif çuvala)
 *       bağlanır ve stoktan düşer. Yalnız PREPARING sevkiyatta çalışır.
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
 *             required: [itemId, count]
 *             properties:
 *               itemId:  { type: string, format: uuid }
 *               colorId: { type: string, format: uuid, nullable: true, description: "null → renksiz grubu" }
 *               count:   { type: integer, minimum: 1, maximum: 10000 }
 *               sackId:  { type: string, format: uuid, nullable: true, description: "Aktif çuval — verilirse içerik bu çuvala yazılır" }
 *     responses:
 *       200: { description: "Eklendi (added + swatchIds + sackId döner)" }
 *       404: { description: Sevkiyat bulunamadı }
 *       409: { description: "Yeterli kartela stoğu yok / sevkiyat PREPARING değil / kısmi claim çakışması" }
 */
router.post("/shipments/:id/add-kartela", verifyToken, WRITE, controller.addKartela);

/**
 * @openapi
 * /api/shipping/rolls/{rollId}/move-sack:
 *   post:
 *     tags: [Shipping]
 *     summary: Topu çuvaldan çuvala taşı (aynı sevkiyat içi)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: rollId
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
 *       200: { description: Taşındı }
 */
router.post("/rolls/:rollId/move-sack", verifyToken, WRITE, controller.moveRollToSack);

/**
 * @openapi
 * /api/shipping/rolls/swap-sacks:
 *   post:
 *     tags: [Shipping]
 *     summary: İki topun çuvalını takas et (saha #3 — aynı sevkiyat, PREPARING/READY/AT_DOOR)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollAId, rollBId]
 *             properties:
 *               rollAId: { type: string, format: uuid }
 *               rollBId: { type: string, format: uuid }
 *     responses:
 *       200: { description: Takas yapıldı (iki çuvalın tartısı sıfırlanır) }
 *       409: { description: Sevkiyat sevk edilmiş / durum değişti }
 */
router.post("/rolls/swap-sacks", verifyToken, WRITE, controller.swapRollSacks);

/**
 * @openapi
 * /api/shipping/shipments/{id}/sacks:
 *   post:
 *     tags: [Shipping]
 *     summary: Çuval aç (boş açılabilir; brüt tartı sonra, içine top/kartela okutulur)
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
 *             properties:
 *               weightKg: { type: number, description: "Brüt kg (opsiyonel — sonra tartılır)" }
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
 *     summary: Sevke Hazır — paketlendi, ara depoda/kapıda bekler (stok/karşılanma çıkışta/DISPATCH'te düşer)
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
/**
 * @openapi
 * /api/shipping/shipments/{id}/unready:
 *   post:
 *     tags: [Shipping]
 *     summary: Sevke hazırı geri al (READY → PREPARING) — çıkış öncesi düzenleme için (top ekle/çıkar)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Hazırlığa geri alındı }
 */
router.post("/shipments/:id/unready", verifyToken, WRITE, controller.unmarkReady);
/**
 * @openapi
 * /api/shipping/shipments/{id}/move-to-door:
 *   post:
 *     tags: [Shipping]
 *     summary: Kapı Önüne Koy (PREPARING/READY → AT_DOOR) — kamyon bekleme durağı; "Alındı" ile sevk olur
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Kapı önüne kondu }
 */
router.post("/shipments/:id/move-to-door", verifyToken, WRITE, controller.moveToDoor);
/**
 * @openapi
 * /api/shipping/shipments/{id}/pull-back:
 *   post:
 *     tags: [Shipping]
 *     summary: Kapı önünden çuval depoya geri çek (AT_DOOR → READY)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Çuval depoya geri çekildi }
 */
router.post("/shipments/:id/pull-back", verifyToken, WRITE, controller.pullBackFromDoor);

/**
 * @openapi
 * /api/shipping/shipments/{id}/dispatch:
 *   post:
 *     tags: [Shipping]
 *     summary: Sevk et (AT_DOOR → DISPATCHED) — "Alındı"; stok burada SHIPPED düşer
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Sevk edildi, irsaliye dondu }
 *       409: { description: Sevkiyat AT_DOOR değil }
 */
router.post("/shipments/:id/dispatch", verifyToken, WRITE, controller.dispatchShipment);

/**
 * @openapi
 * /api/shipping/shipments/{id}/cancel-preview:
 *   get:
 *     tags: [Shipping]
 *     summary: Sevkiyat iptal önizlemesi (etkilenen top/çuval/sipariş)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: İptal önizleme bilgisi }
 *       404: { description: Sevkiyat bulunamadı }
 */
router.get("/shipments/:id/cancel-preview", verifyToken, READ, controller.cancelPreview);

/**
 * @openapi
 * /api/shipping/shipments/{id}/cancel:
 *   post:
 *     tags: [Shipping]
 *     summary: Sevkiyatı iptal et (top/çuval serbest; DISPATCHED iptal edilemez)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200: { description: İptal edildi }
 *       409: { description: DISPATCHED sevkiyat iptal edilemez }
 */
router.post("/shipments/:id/cancel", verifyToken, WRITE, controller.cancelShipment);

// ===========================================================================
// ÇUVAL (tartı) — güncelle / sil
// ===========================================================================
/**
 * @openapi
 * /api/shipping/sacks/{id}/weigh:
 *   post:
 *     tags: [Shipping]
 *     summary: Çuvalı tart (toplam kg + metraj gir)
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
 *             properties:
 *               totalKg:     { type: number }
 *               totalMeters: { type: number }
 *     responses:
 *       200: { description: Tartıldı }
 *       404: { description: Çuval bulunamadı }
 */
router.post("/sacks/:id/weigh", verifyToken, WRITE, controller.weighSack);

/**
 * @openapi
 * /api/shipping/sacks/{id}/remove:
 *   post:
 *     tags: [Shipping]
 *     summary: Boş çuvalı sil
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Çuval silindi }
 *       409: { description: Çuval boş değil }
 */
router.post("/sacks/:id/remove", verifyToken, WRITE, controller.removeSack);

export default router;
