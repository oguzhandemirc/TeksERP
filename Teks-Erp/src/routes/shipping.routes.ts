import { Router } from "express";
import { ShippingController } from "../controllers/shipping.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission } from "../middlewares/rbac.middleware";

const controller = new ShippingController();
const router = Router();

// Okuma: web sevkiyat yetkisi veya mobil paket/sevkiyat ekranları
const READ = requireAnyPermission("shipping:read", "shipping:write", "mobile:tarti-paket", "mobile:sevkiyat");
// Yazma: web sevkiyat yazma veya mobil paket/sevkiyat ekranları
const WRITE = requireAnyPermission("shipping:write", "mobile:tarti-paket", "mobile:sevkiyat");
// Muhasebe okuma: sevk fişi + Excel export (satış raporu izni de erişebilir).
const ACCOUNTING_READ = requireAnyPermission("shipping:read", "shipping:write", "report:sales");
// Fatura işareti: muhasebeciye `shipping:write` VERİLMEZ (o izin sevkiyat iptalini de
// açardı) → ayrı, dar kapsamlı izin. `shipping:write` de kabul edilir: sevkiyatçının
// mevcut yetkisi daralmasın.
const INVOICE_WRITE = requireAnyPermission("shipping:invoice", "shipping:write");

// ===========================================================================
// SİPARİŞ SEÇİM — açık siparişler + depo karşılaması (paketleme rehberi)
// ===========================================================================
/**
 * @openapi
 * /api/shipping/open-orders:
 *   get:
 *     tags: [Shipping]
 *     summary: Açık siparişler + depo karşılaması (paketleme rehberi)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Açık siparişler + satır bazlı karşılama } }
 */
router.get("/open-orders", verifyToken, READ, controller.openOrders);

// ===========================================================================
// ÇUVAL DEPO HAVUZU — çuval aç / okut / tart (sevkiyattan bağımsız)
// ===========================================================================
/**
 * @openapi
 * /api/shipping/pool:
 *   get:
 *     tags: [Shipping]
 *     summary: Çuval depo havuzu board'u (müşteri-gruplu)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Müşteri bazlı havuz özeti } }
 */
router.get("/pool", verifyToken, READ, controller.listPool);
router.get("/pool/sacks", verifyToken, READ, controller.listCustomerPoolSacks);

/**
 * @openapi
 * /api/shipping/sacks:
 *   post:
 *     tags: [Shipping]
 *     summary: Müşteriye havuz çuvalı aç
 *     security: [{ bearerAuth: [] }]
 *     responses: { 201: { description: Çuval açıldı } }
 */
router.post("/sacks", verifyToken, WRITE, controller.openSack);

// Çuval içeriği: barkod okut, kartela ekle, tart, sil
router.post("/sacks/:id/scan", verifyToken, WRITE, controller.scanIntoSack);
router.post("/sacks/:id/add-kartela", verifyToken, WRITE, controller.addKartelaToSack);
router.post("/sacks/:id/weigh", verifyToken, WRITE, controller.weighSack);
router.post("/sacks/:id/customer", verifyToken, WRITE, controller.reassignSackCustomer);
router.post("/sacks/:id/remove", verifyToken, WRITE, controller.removeSack);

/**
 * @openapi
 * /api/shipping/sacks/{id}/notes:
 *   get:
 *     tags: [Shipping]
 *     summary: Çuval notunu oku (iç serbest not)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses: { 200: { description: Yorum }, 404: { description: Çuval bulunamadı } }
 *   post:
 *     tags: [Shipping]
 *     summary: Çuval notunu yaz/temizle
 *     description: >
 *       İç serbest not ("kendimiz için"). Çuvalın durumu FARK ETMEZ — sevkiyata atanmış
 *       veya sevk edilmiş çuvala da yazılabilir (annotation; dispatchNote ile aynı).
 *       Boş/whitespace veya null → not temizlenir. Gösterimi etiket/irsaliyede
 *       opsiyonel ve varsayılan kapalıdır.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes: { type: string, maxLength: 500, nullable: true }
 *     responses: { 200: { description: Kaydedildi }, 404: { description: Çuval bulunamadı } }
 */
router.get("/sacks/:id/notes", verifyToken, READ, controller.getSackNotes);
router.post("/sacks/:id/notes", verifyToken, WRITE, controller.setSackNotes);
// Çuval içeriği düzeltme (rol/kartela çıkar/taşı)
router.post("/rolls/:rollId/remove-from-sack", verifyToken, WRITE, controller.removeRollFromSack);
router.post("/rolls/:rollId/move-sack", verifyToken, WRITE, controller.moveRollToSack);
router.post("/swatches/:swatchId/remove-from-sack", verifyToken, WRITE, controller.removeSwatchFromSack);
// Toplu: çuvalı dağıt (seçili/tüm içerik → depo) + seçili topları başka çuvala taşı
router.post("/sacks/:id/distribute", verifyToken, WRITE, controller.distributeSack);
router.post("/sacks/:id/move-rolls", verifyToken, WRITE, controller.moveRollsToSack);

/**
 * @openapi
 * /api/shipping/sacks/{id}/split:
 *   post:
 *     tags: [Shipping]
 *     summary: Çuvalı böl — seçili topları YENİ çuvala ayır (atomik)
 *     description: >
 *       Tek transaction: yeni çuval açılır (kaynağın müşteri/şubesini devralır),
 *       seçili toplar atomik claim ile taşınır, İKİ çuvalın brüt tartısı sıfırlanır
 *       (bayat kg irsaliyeye gitmesin). Kaynakta en az bir top KALMALI — hepsi
 *       seçilirse 400. Kaynak sevkiyatta ise 409. Hiç top claim edilemezse yeni
 *       çuval da YARATILMAZ (tx geri alınır).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollIds]
 *             properties:
 *               rollIds: { type: array, items: { type: string, format: uuid } }
 *     responses:
 *       201: { description: Yeni çuval oluştu (sackId/sackNo/moved) }
 *       400: { description: Seçim geçersiz / kaynak boş kalır }
 *       409: { description: Çuval sevkiyatta veya toplar bu sırada taşınmış }
 */
router.post("/sacks/:id/split", verifyToken, WRITE, controller.splitSack);

// ===========================================================================
// ÇUVAL/TOP ARAMA + salt-okunur raporlar
// ===========================================================================
router.get("/sack-search", verifyToken, READ, controller.searchSacks);
router.post("/sack-search/pick-list", verifyToken, READ, controller.getPickList);
/**
 * @openapi
 * /api/shipping/sack-search/content-dump:
 *   post:
 *     tags: [Shipping]
 *     summary: İçerik dökümü — seçili çuvalların TOP BAZLI dökümü
 *     description: >
 *       Çeki listesinden (`/sack-search/pick-list`) farkı: orası ürün·renk·en bazında
 *       GRUPLU özet döner (sahada çuval ararken doğru olan), bu uç her topu ayrı satır
 *       olarak verir (barkod dahil) — Excel/PDF/yazdır içerik dökümünün kaynağı.
 *       Salt-okunur; en fazla 200 çuval. Çuval notu TAM metin döner (iç döküm) —
 *       basılıp basılmayacağına istemci karar verir (opt-in).
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sackIds]
 *             properties:
 *               sackIds: { type: array, items: { type: string, format: uuid }, minItems: 1, maxItems: 200 }
 *     responses:
 *       200: { description: "Çuval başına meta + rolls[] + swatches[]" }
 *       400: { description: Seçim boş veya 200 çuvalı aşıyor }
 */
router.post("/sack-search/content-dump", verifyToken, READ, controller.getContentDump);
router.get("/sacks/:id/contents", verifyToken, READ, controller.getSackContents);
router.get("/locate-roll", verifyToken, READ, controller.locateRoll);

// ===========================================================================
// SEVK KAPISI board + muhasebe
// ===========================================================================
router.get("/sack-store/board", verifyToken, READ, controller.listSackStoreBoard);
router.get("/shipments/:id/sack-contents", verifyToken, READ, controller.getShipmentSackContents);
router.get("/shipments/:id/dispatch-report", verifyToken, ACCOUNTING_READ, controller.getDispatchReport);
router.get("/direct-shipments/:id/dispatch-report", verifyToken, ACCOUNTING_READ, controller.getDirectShipmentDispatchReport);
router.get("/accounting-export", verifyToken, ACCOUNTING_READ, controller.getAccountingExport);

/**
 * @openapi
 * /api/shipping/shipments/{id}/invoice:
 *   post:
 *     tags: [Shipping]
 *     summary: Sevkiyatı faturalandı olarak işaretle (muhasebe)
 *     description: >
 *       Dış muhasebe programındaki fatura no + tarihini sevkiyata iliştirir. ERP fatura
 *       KESMEZ, yalnız izini tutar. `invoiceNo` null/boş gönderilirse işaret kaldırılır.
 *       Yalnız DISPATCHED sevkiyat faturalandırılabilir.
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
 *               invoiceNo: { type: string, nullable: true, maxLength: 64 }
 *               invoicedAt: { type: string, format: date-time, nullable: true }
 *     responses:
 *       200: { description: Güncellendi }
 *       400: { description: Sevkiyat henüz sevk edilmedi }
 *       403: { description: Yetki yok }
 *       404: { description: Sevkiyat bulunamadı }
 */
router.post("/shipments/:id/invoice", verifyToken, INVOICE_WRITE, controller.setShipmentInvoice);

/**
 * @openapi
 * /api/shipping/direct-shipments/{id}/invoice:
 *   post:
 *     tags: [Shipping]
 *     summary: Fasondan doğrudan sevki faturalandı olarak işaretle (muhasebe)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Güncellendi }
 *       403: { description: Yetki yok }
 *       404: { description: Kayıt bulunamadı }
 */
router.post("/direct-shipments/:id/invoice", verifyToken, INVOICE_WRITE, controller.setDirectShipmentInvoice);

// ===========================================================================
// SEVKİYAT — havuzdan çuval seçerek kur + yaşam döngüsü
// ===========================================================================
/**
 * @openapi
 * /api/shipping/shipments:
 *   post:
 *     tags: [Shipping]
 *     summary: Depodan seçilen çuvallarla sevkiyat kur (varsayılan doğrudan sevk)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 201: { description: Sevkiyat kuruldu } }
 *   get:
 *     tags: [Shipping]
 *     summary: Sevkiyat listesi (içerik/iade/hedef filtresi + sıralama + eşleşme rozeti + cursor)
 *     description: >
 *       Shipment + fasondan doğrudan sevk (DirectShipment) birleşik liste. İçerik filtresi
 *       filter[itemId]/filter[colorId] (csv) TEK TOP eşleşmesi kurar (aynı topun itemId VE
 *       colorId koşulu). filter[hasReturns]=true iptalsiz iade taşıyan sevkleri süzer;
 *       filter[destination]=DOMESTIC|EXPORT hedefe göre süzer (ikisi de doğrudan sevkleri
 *       union'dan düşürür). sortBy=createdAt|shipmentNo + sortOrder=asc|desc. İçerik filtresi
 *       aktifken her satırda matchRollCount (eşleşen top sayısı) döner.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: mode, schema: { type: string, enum: [cursor] }, description: cursor sayfalama }
 *       - { in: query, name: cursor, schema: { type: string } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 200, default: 50 } }
 *       - { in: query, name: withTotal, schema: { type: boolean } }
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: sortBy, schema: { type: string, enum: [createdAt, shipmentNo] } }
 *       - { in: query, name: sortOrder, schema: { type: string, enum: [asc, desc] } }
 *       - { in: query, name: "filter[status]", schema: { type: string } }
 *       - { in: query, name: "filter[customerId]", schema: { type: string } }
 *       - { in: query, name: "filter[destination]", schema: { type: string, enum: [DOMESTIC, EXPORT] } }
 *       - { in: query, name: "filter[hasReturns]", schema: { type: string, enum: ["true"] } }
 *       - { in: query, name: "filter[itemId]", schema: { type: string }, description: CSV çoklu ürün ID }
 *       - { in: query, name: "filter[colorId]", schema: { type: string }, description: CSV çoklu renk ID }
 *     responses: { 200: { description: Sevkiyatlar } }
 */
router.post("/shipments", verifyToken, WRITE, controller.createShipment);
router.get("/shipments", verifyToken, READ, controller.listShipments);
router.post("/shipments/preview", verifyToken, READ, controller.previewCreateShipment);

router.get("/direct-shipments/:id", verifyToken, READ, controller.getDirectShipment);
router.get("/shipments/:id", verifyToken, READ, controller.getShipment);
router.post("/shipments/:id/add-sacks", verifyToken, WRITE, controller.addSacksToShipment);
router.post("/shipments/:id/remove-sack", verifyToken, WRITE, controller.removeSackFromShipment);
router.post("/shipments/:id/destination", verifyToken, WRITE, controller.setDestination);
router.post("/shipments/:id/procedure-code", verifyToken, WRITE, controller.setProcedureCode);
router.get("/shipments/:id/dispatch-note", verifyToken, READ, controller.getDispatchNote);
router.post("/shipments/:id/dispatch-note", verifyToken, WRITE, controller.setDispatchNote);
router.post("/shipments/:id/dispatch", verifyToken, WRITE, controller.dispatchShipment);
router.get("/shipments/:id/cancel-preview", verifyToken, READ, controller.cancelPreview);
router.post("/shipments/:id/cancel", verifyToken, WRITE, controller.cancelShipment);

export default router;
