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
// Çuval içeriği düzeltme (rol/kartela çıkar/taşı)
router.post("/rolls/:rollId/remove-from-sack", verifyToken, WRITE, controller.removeRollFromSack);
router.post("/rolls/:rollId/move-sack", verifyToken, WRITE, controller.moveRollToSack);
router.post("/swatches/:swatchId/remove-from-sack", verifyToken, WRITE, controller.removeSwatchFromSack);
// Toplu: çuvalı dağıt (seçili/tüm içerik → depo) + seçili topları başka çuvala taşı
router.post("/sacks/:id/distribute", verifyToken, WRITE, controller.distributeSack);
router.post("/sacks/:id/move-rolls", verifyToken, WRITE, controller.moveRollsToSack);

// ===========================================================================
// ÇUVAL/TOP ARAMA + salt-okunur raporlar
// ===========================================================================
router.get("/sack-search", verifyToken, READ, controller.searchSacks);
router.post("/sack-search/pick-list", verifyToken, READ, controller.getPickList);
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
