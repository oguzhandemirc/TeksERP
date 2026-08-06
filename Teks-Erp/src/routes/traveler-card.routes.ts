// =============================================================================
// TeksERP - TravelerCard (Refakat Kartı) Routes
// =============================================================================
// İki kök altında servis verir:
//   /api/work-orders/:id/traveler-cards         — WO bazlı print/reprint/history
//   /api/traveler-cards                          — kart bazlı scan/void/lookup
// =============================================================================

import { Router } from "express";
import { TravelerCardController } from "../controllers/traveler-card.controller";
import { DOCUMENT_DESIGN_READ } from "../constants/document-design";
import { verifyToken } from "../middlewares/auth.middleware";
import {
  requirePermission,
  requireAnyPermission,
} from "../middlewares/rbac.middleware";

const controller = new TravelerCardController();

/** WO-scoped router — /api/work-orders/:id/traveler-cards altında mount edilir */
export const workOrderTravelerRouter = Router({ mergeParams: true });

/**
 * @openapi
 * /api/work-orders/{id}/traveler-cards:
 *   post:
 *     tags: [TravelerCards]
 *     summary: Refakat kartı bas (ilk basım)
 *     description: İş emri için yeni bir ACTIVE refakat kartı üretir.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201: { description: Kart basıldı }
 *       409: { description: Zaten aktif kart var }
 */
workOrderTravelerRouter.post(
  "/",
  verifyToken,
  requirePermission("workorder:write"),
  controller.print
);

/**
 * @openapi
 * /api/work-orders/{id}/traveler-cards/reprint:
 *   post:
 *     tags: [TravelerCards]
 *     summary: Refakat kartı yeniden basım
 *     description: Mevcut ACTIVE kart REPRINTED'a çekilir, yeni bir ACTIVE kart üretilir.
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
 *             required: [reason]
 *             properties:
 *               reason: { type: string, example: "Kart yırtıldı" }
 *     responses:
 *       201: { description: Yeniden basıldı }
 */
workOrderTravelerRouter.post(
  "/reprint",
  verifyToken,
  requirePermission("workorder:write"),
  controller.reprint
);

/**
 * @openapi
 * /api/work-orders/{id}/traveler-cards/history:
 *   get:
 *     tags: [TravelerCards]
 *     summary: İş emrinin tüm kart + tarama geçmişi
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Kart ve scan geçmişi }
 */
workOrderTravelerRouter.get(
  "/history",
  verifyToken,
  requirePermission("workorder:read"),
  controller.getHistory
);

/** Kart bazlı router — /api/traveler-cards altında mount edilir */
const travelerCardRouter = Router();

/**
 * @openapi
 * /api/traveler-cards/sample-html:
 *   post:
 *     tags: [TravelerCards]
 *     summary: Refakat Kartı Ayarları canlı önizlemesi (örnek veri + taslak config)
 *     description: |
 *       "Refakat Kartı Ayarları" panelinde admin içerik ayarını düzenlerken gördüğü
 *       önizleme. Gerçek renderTravelerCardHtml örnek veriyle + gönderilen taslak
 *       config ile çağrılır (TASLAK filigranlı) → önizleme baskıyla birebir aynı.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: text/html önizleme çıktısı }
 */
// :id'den ÖNCE — "sample-html" segmenti :id param'ına yakalanmasın.
// İZİN: ekranı AÇAN izinle aynı küme olmalı. Refakat Kartı ekranı 2026-08-05'te
// `document-template:read`e taşındı ama bu uç `admin:settings`te kaldı → o izinle
// giren tasarımcı ekranı açıyor, sol tarafta ayar yapıyor ve sağdaki önizleme
// sessizce 403 alıyordu ("liste izni ile baskı izni hizalı olmalı" kuralının
// önizleme ikizi). `DOCUMENT_DESIGN_READ` `admin:settings`i zaten OR ile kapsar.
travelerCardRouter.post(
  "/sample-html",
  verifyToken,
  requireAnyPermission(...DOCUMENT_DESIGN_READ),
  controller.getSampleHtml
);

/**
 * @openapi
 * /api/traveler-cards:
 *   get:
 *     tags: [TravelerCards]
 *     summary: Refakat kartlarını listele (mobil picker'lar için)
 *     description: |
 *       Aktif refakat kartlarını WO + targetItem (+color) bilgisiyle döner.
 *       Default `filter[status]=ACTIVE`; `ALL` ile tüm statüler çekilir.
 *       `search` cardNumber/barcode/batchNumber üzerinde insensitive contains uygular.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: filter[status]
 *         schema: { type: string, enum: [ACTIVE, COMPLETED, REPRINTED, VOIDED, ALL] }
 *     responses:
 *       200: { description: Sayfalı kart listesi }
 */
travelerCardRouter.get(
  "/",
  verifyToken,
  // Hızlı İş Emri akışı da kartı okur (kart çıktısındaki QR barkodu için).
  requireAnyPermission("workorder:read", "mobile:kk1", "mobile:fason-sevk", "mobile:hizli-is-emri"),
  controller.list
);

/**
 * @openapi
 * /api/traveler-cards/scan:
 *   post:
 *     tags: [TravelerCards]
 *     summary: İstasyon taraması
 *     description: El terminalinden gelen barkod + istasyon + scanType ile tarama kaydı oluşturur.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [barcode, stationId, scanType]
 *             properties:
 *               barcode:   { type: string, example: "RK1207260001" }
 *               stationId: { type: string, format: uuid }
 *               scanType:  { type: string, enum: [ARRIVAL, DEPARTURE, INFO] }
 *               notes:     { type: string }
 *               deviceId:  { type: string }
 *     responses:
 *       201: { description: Tarama kaydedildi }
 *       400: { description: Barkod geçersiz }
 *       404: { description: Kart bulunamadı }
 */
travelerCardRouter.post(
  "/scan",
  verifyToken,
  requirePermission("workorder:write"),
  controller.scan
);

/**
 * @openapi
 * /api/traveler-cards/by-barcode/{barcode}:
 *   get:
 *     tags: [TravelerCards]
 *     summary: Barkoddan kart detayı
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: barcode
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Kart detayı }
 *       404: { description: Kart bulunamadı }
 */
travelerCardRouter.get(
  "/by-barcode/:barcode",
  verifyToken,
  requireAnyPermission("workorder:read", "mobile:fason-kabul", "mobile:fason-sevk"),
  controller.findByBarcode
);

/**
 * @openapi
 * /api/traveler-cards/{id}/html:
 *   get:
 *     tags: [TravelerCards]
 *     summary: Refakat kartı resmi HTML çıktısı (tek-kaynak)
 *     description: |
 *       Kartın donmuş snapshot'ından üretilen baskıya hazır HTML (text/html).
 *       Electron printHtmlString/iframe ve mobil expo-print aynı çıktıyı basar.
 *       Partiler snapshot'ta değil, baskı anında CANLI çözülür (kart iş emri
 *       açılışında donar, parti sonra doğar).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: pageSize
 *         required: false
 *         description: |
 *           Tek seferlik sayfa boyutu ezmesi. Kalıcı ayarı ve kartın donmuş
 *           config'ini EZER, hiçbir yere YAZILMAZ, yeni versiyon doğurmaz.
 *           Geçersiz değer yok sayılır.
 *         schema: { type: string, enum: [A4, A5] }
 *     responses:
 *       200: { description: HTML belge, content: { text/html: {} } }
 *       404: { description: Kart bulunamadı }
 */
travelerCardRouter.get(
  "/:id/html",
  verifyToken,
  // Saha (Hızlı İş Emri / istasyon) + masaüstü kartı basabilmeli.
  requireAnyPermission(
    "workorder:read",
    "workorder:write",
    "mobile:kk1",
    "mobile:fason-sevk",
    "mobile:hizli-is-emri",
  ),
  controller.getCardHtml
);

/**
 * @openapi
 * /api/traveler-cards/{id}/print-event:
 *   post:
 *     tags: [TravelerCards]
 *     summary: Baskı olayı — "kart fiziksel olarak basıldı" (bayat işaretini temizler)
 *     description: >
 *       İstemci baskı BAŞARIYLA tamamlandıktan sonra çağırır. `contentDirty`
 *       temizlenir, `printedAt` tazelenir. Yeni versiyon doğurmaz, snapshot'a
 *       dokunmaz. GET /html bunu YAPMAZ — o uç önizleme tarafından da çağrılır.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Baskı kaydedildi }
 *       404: { description: Kart bulunamadı }
 */
travelerCardRouter.post(
  "/:id/print-event",
  verifyToken,
  // Kartı BASABİLEN herkes baskı olayını da bildirebilmeli — izin kümesi
  // /:id/html ile BİREBİR aynı; ayrışırsa saha kartı basar ama rozet kalıcı olur.
  requireAnyPermission(
    "workorder:read",
    "workorder:write",
    "mobile:kk1",
    "mobile:fason-sevk",
    "mobile:hizli-is-emri",
  ),
  controller.recordPrintEvent
);

/**
 * @openapi
 * /api/traveler-cards/{id}/void:
 *   post:
 *     tags: [TravelerCards]
 *     summary: Kartı iptal et (VOIDED)
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
 *             required: [reason]
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200: { description: Kart iptal edildi }
 */
travelerCardRouter.post(
  "/:id/void",
  verifyToken,
  requirePermission("workorder:write"),
  controller.voidCard
);

export default travelerCardRouter;
