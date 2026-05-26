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

import { Router, Request, Response, NextFunction } from "express";
import bwipjs from "bwip-js";
import { LabelController } from "../controllers/label.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";

const MOBILE_LABEL_PRINTERS = ["mobile:kk1", "mobile:tambur", "mobile:tarti-paket"] as const;
const ALLOWED_BARCODE_FORMATS = new Set([
  "code128",
  "code39",
  "ean13",
  "ean8",
  "upca",
  "qrcode",
]);

const controller = new LabelController();
const router = Router();

/**
 * @openapi
 * /api/labels/rolls/{id}:
 *   get:
 *     tags: [Labels]
 *     summary: Rulonun etiket payload'unu döner
 *     description: |
 *       Allocation modülü kaldırıldı — customerName/orderNumber/orderLineId
 *       şu an sabit NULL. Sevkiyat modülü yeniden yazıldığında order context
 *       parametre olarak alınacak.
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
  requireAnyPermission("label:read", ...MOBILE_LABEL_PRINTERS),
  controller.getRollLabel,
);

/**
 * @openapi
 * /api/labels/rolls/{id}/html:
 *   get:
 *     tags: [Labels]
 *     summary: Rolün tam etiket HTML'i — tek render kaynağı
 *     description: |
 *       Hem mobil print (expo-print) hem Electron LabelPreview iframe bu
 *       endpoint'i tüketir. Tek doğru HTML → "iki yer farklı görünüyor"
 *       sorunu yapısal olarak çözülür. Barcode (Code128) + QR SVG inline
 *       gömülür, admin Electron'da yaptığı şablon değişikliği anlık yansır.
 *
 *       Kind otomatik tespit edilir; `?kind=ROLL_RAW|ROLL_FINISHED` ile zorla.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: kind
 *         schema: { type: string, enum: [ROLL_RAW, ROLL_FINISHED] }
 *     responses:
 *       200:
 *         description: HTML
 *         content: { text/html: { schema: { type: string } } }
 *       404: { description: Top bulunamadı }
 */
router.get(
  "/rolls/:id/html",
  verifyToken,
  requireAnyPermission("label:read", ...MOBILE_LABEL_PRINTERS),
  controller.getRollLabelHtml,
);

/**
 * @openapi
 * /api/labels/preview/html:
 *   post:
 *     tags: [Labels]
 *     summary: Şablon önizleme HTML'i (kaydedilmemiş değişiklikler için)
 *     description: |
 *       Electron LabelPreview iframe srcDoc kaynağı. Body: { kind, fields[] }.
 *       Mock payload + verilen field listesi ile HTML üretir — admin'in editör'de
 *       henüz kaydetmediği değişiklikleri görsel olarak doğrulamasını sağlar.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [kind, fields]
 *             properties:
 *               kind: { type: string, enum: [ROLL_RAW, ROLL_FINISHED] }
 *               fields:
 *                 type: array
 *                 items: { type: object }
 *     responses:
 *       200: { description: HTML, content: { text/html: { schema: { type: string } } } }
 */
router.post(
  "/preview/html",
  verifyToken,
  requirePermission("label-template:read"),
  controller.getPreviewHtml,
);

/**
 * @openapi
 * /api/labels/swatches/{id}:
 *   get:
 *     tags: [Labels]
  *     summary: Kartela etiket payload'u
 *     description: |
 *       Allocation modülü kaldırıldı — customer/order alanları şu an null.
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
  requireAnyPermission("label:read", "mobile:tambur", "mobile:tarti-paket"),
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
  requireAnyPermission("label:print", ...MOBILE_LABEL_PRINTERS),
  controller.recordPrintEvent,
);

/**
 * @openapi
 * /api/labels/barcode:
 *   get:
 *     tags: [Labels]
 *     summary: Barkod SVG'si (Code128 varsayılan)
 *     description: |
 *       Verilen string için 1D/2D barkod görseli döner — mobil etiket HTML'inde
 *       `<img>` ile gömülür, scanner okuyabilir. Hem KK1 hem Tambur etiketleri,
 *       hem Electron preview'u tek doğru kaynak olarak buradan tüketir.
 *
 *       Cache-Control: deterministik (aynı value+format aynı SVG) — uzun süre
 *       cache'lenebilir, network maliyeti tek seferlik.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: value
 *         required: true
 *         schema: { type: string, maxLength: 128 }
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [code128, code39, ean13, ean8, upca, qrcode], default: code128 }
 *     responses:
 *       200: { description: SVG, content: { image/svg+xml: { schema: { type: string } } } }
 *       400: { description: value eksik veya format geçersiz }
 */
router.get(
  "/barcode",
  verifyToken,
  requireAnyPermission("label:read", ...MOBILE_LABEL_PRINTERS),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const value = typeof req.query.value === "string" ? req.query.value.trim() : "";
      if (!value) {
        res.status(400).json({ success: false, message: "value zorunlu" });
        return;
      }
      if (value.length > 128) {
        res.status(400).json({ success: false, message: "value en fazla 128 karakter" });
        return;
      }
      const format =
        typeof req.query.format === "string" && req.query.format.length > 0
          ? req.query.format
          : "code128";
      if (!ALLOWED_BARCODE_FORMATS.has(format)) {
        res.status(400).json({
          success: false,
          message: `Geçersiz format. İzinli: ${[...ALLOWED_BARCODE_FORMATS].join(", ")}`,
        });
        return;
      }

      const svg = bwipjs.toSVG({
        bcid: format,
        text: value,
        scale: 3,
        height: 10,
        includetext: false,
        backgroundcolor: "FFFFFF",
      });

      res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      res.status(200).send(svg);
    } catch (error) {
      // bwip-js geçersiz değer için throw eder — kullanıcıya 400 dön.
      const msg = error instanceof Error ? error.message : "Barkod üretilemedi";
      res.status(400).json({ success: false, message: msg });
      next();
    }
  },
);

export default router;
