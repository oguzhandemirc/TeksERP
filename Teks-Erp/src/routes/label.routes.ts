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
 * /api/labels/rolls/{id}/ppla:
 *   get:
 *     tags: [Labels]
 *     summary: Rolün Argox PPLA native komut string'i (text/plain)
 *     description: |
 *       `/html`'in native analoğu — Argox OS 214 plus PPLA (Datamax DPL) komutları.
 *       Faz-1: yalnız ÜRETİLİR (saf string; inceleme/önizleme/gelecek native baskı için);
 *       ham-bayt gönderim simüle (donanım I/O Faz-2). Format profili (medya + güvenlik payı)
 *       `/html` ile aynı resolver'dan: `?profileId=` / `?machineId=` veya istasyon (mobil oto).
 *       `?kind=ROLL_RAW|ROLL_FINISHED` ile etiket türü zorlanır (verilmezse top renginden
 *       türetilir — `/html` ile aynı davranış; KK1 ham / Tambur bitmiş paritesi).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: kind
 *         schema: { type: string, enum: [ROLL_RAW, ROLL_FINISHED] }
 *       - in: query
 *         name: profileId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: machineId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: PPLA komut string'i, content: { text/plain: { schema: { type: string } } } }
 *       404: { description: Top bulunamadı }
 */
router.get(
  "/rolls/:id/ppla",
  verifyToken,
  requireAnyPermission("label:read", ...MOBILE_LABEL_PRINTERS),
  controller.getRollLabelPpla,
);

/**
 * @openapi
 * /api/labels/rolls/{id}/native:
 *   get:
 *     tags: [Labels]
 *     summary: Rolün etiketi SEÇİLİ yazıcı dilinde (global ayar / model dili)
 *     description: |
 *       Etkin dil = istasyon yazıcı modelinin dili (varsa) ya da global ayar
 *       cihaz kaydındaki dil (cihazsız → RASTER_HTML). RASTER_HTML → text/html; PPLA/PPLB/ZPL
 *       → text/plain native komut. Dil `X-Label-Language` header'ında. Faz-1: native
 *       komutlar ÜRETİLİR, ham gönderim simüle (Faz-2). Format `?profileId=`/`?machineId=`
 *       veya istasyon (mobil oto) ile çözülür.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Seçili dilde etiket (HTML veya native komut) }
 *       404: { description: Top bulunamadı }
 */
router.get(
  "/rolls/:id/native",
  verifyToken,
  requireAnyPermission("label:read", ...MOBILE_LABEL_PRINTERS),
  controller.getRollLabelNative,
);

/**
 * @openapi
 * /api/labels/rolls/{id}/preview:
 *   get:
 *     tags: [Labels]
 *     summary: WYSIWYG önizleme — gerçek topu AKTİF DİLDE ({ mode, language, content, kind })
 *     description: |
 *       Baskı diyaloglarının önizlemesi. Native dil → komutlar görsele çevrilir
 *       (mode="svg", baskıyla birebir); HTML dili → mode="html"; çizilemeyen → mode="text".
 *       `?kind` / `?customerId` / `?orderLineId` / `?stock` / `?profileId` / `?machineId`
 *       (getRollLabelHtml/native ile aynı opts).
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/rolls/:id/preview",
  verifyToken,
  requireAnyPermission("label:read", ...MOBILE_LABEL_PRINTERS),
  controller.getRollPreview,
);

/**
 * @openapi
 * /api/labels/rolls/{id}/print-native:
 *   post:
 *     tags: [Labels]
 *     summary: FAZ-2 — rolün etiketini istasyon yazıcısına native gönder (RAW TCP 9100)
 *     description: |
 *       `label.nativeSendEnabled` AÇIKKEN gerçek gönderir (backend → printerIp:9100),
 *       kapalıyken SİMÜLE eder (Faz-1, socket yok). Hedef IP istasyon makinesinden
 *       (mobil: req.device.machineId). JSON sonuç: { delivered, simulated, bytes, target, error? }.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Gönderim sonucu }
 *       404: { description: Top bulunamadı }
 */
router.post(
  "/rolls/:id/print-native",
  verifyToken,
  requireAnyPermission("label:print", ...MOBILE_LABEL_PRINTERS),
  controller.printRollNative,
);

/**
 * @openapi
 * /api/labels/format-profiles/{id}/sample-html:
 *   get:
 *     tags: [Labels]
 *     summary: Test Et — profil geometrisinde örnek etiket HTML'i (boyut/pay önizleme)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Örnek etiket HTML, content: { text/html: { schema: { type: string } } } }
 */
router.get(
  "/format-profiles/:id/sample-html",
  verifyToken,
  requireAnyPermission("label:read", "station:read", ...MOBILE_LABEL_PRINTERS),
  controller.getSampleLabelHtml,
);

/**
 * @openapi
 * /api/labels/test-native:
 *   post:
 *     tags: [Labels]
 *     summary: Test Et — örnek etiketi seçili dilde verilen yazıcıya gönder (Faz-2 doğrulama)
 *     description: |
 *       Body { profileId?, printerIp, port?, language? }. nativeSendEnabled açıkken gerçek
 *       gönderir, kapalıyken simüle — admin'in gerçek Argox'u doğrulama aracı.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Gönderim sonucu }
 *       400: { description: Geçersiz girdi }
 */
router.post(
  "/test-native",
  verifyToken,
  requireAnyPermission("label:print", "station:write"),
  controller.testNativeSend,
);

/**
 * @openapi
 * /api/labels/rolls/bulk-html:
 *   post:
 *     tags: [Labels]
 *     summary: Toplu top etiketi HTML'i (saha #7 — çuval/sevkiyat bazlı toplu baskı)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollIds]
 *             properties:
 *               rollIds: { type: array, items: { type: string, format: uuid } }
 *               copies: { type: integer, minimum: 1, maximum: 5 }
 *     responses:
 *       200: { description: Birleşik etiket HTML'i (her top kendi sayfasında) }
 */
router.post(
  "/rolls/bulk-html",
  verifyToken,
  requireAnyPermission("label:read", ...MOBILE_LABEL_PRINTERS),
  controller.getBulkRollLabelsHtml,
);

/**
 * @openapi
 * /api/labels/rolls/bulk-native:
 *   post:
 *     tags: [Labels]
 *     summary: N farklı topun native (PPLA) komutları TEK akışta — diyalogsuz toplu baskı
 *     description: |
 *       `/bulk-html`'in native analoğu. Her topun PPLA bloğu ardışık birleştirilir;
 *       tek seri/COM (Electron) veya BT (mobil) gönderiminde N etiket basılır. Dil
 *       `X-Label-Language` header'ında (RASTER_HTML → istemci reddeder, native değil).
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollIds]
 *             properties:
 *               rollIds: { type: array, items: { type: string, format: uuid } }
 *               copies: { type: integer }
 *     responses:
 *       200: { description: Birleşik native komut akışı (text/plain) }
 */
router.post(
  "/rolls/bulk-native",
  verifyToken,
  requireAnyPermission("label:read", ...MOBILE_LABEL_PRINTERS),
  controller.getBulkRollLabelsNative,
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
 *               kind: { type: string, enum: [ROLL_RAW, ROLL_FINISHED, SWATCH] }
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
 * /api/labels/preview/native-text:
 *   post:
 *     tags: [Labels]
 *     summary: Editör native (PPLA/ZPL) metin-zone önizlemesi — sıralı satırlar (JSON)
 *     description: Body { kind, fields } (preview/html ile aynı). { lines:[{text,size,bold}] } döner.
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Native metin satırları } }
 */
router.post(
  "/preview/native-text",
  verifyToken,
  requirePermission("label-template:read"),
  controller.getPreviewNativeText,
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
 * /api/labels/swatches/{id}/html:
 *   get:
 *     tags: [Labels]
 *     summary: Kartela etiketinin tam HTML'i (100×60 yatay)
 *     description: |
 *       `/rolls/:id/html`'in kartela analoğu. Mobil expo-print basar, Electron iframe
 *       srcDoc ile gösterir. Format `?profileId=`/`?machineId=` veya sistem default.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: HTML, content: { text/html: { schema: { type: string } } } }
 *       404: { description: Kartela bulunamadı }
 */
router.get(
  "/swatches/:id/html",
  verifyToken,
  requireAnyPermission("label:read", "mobile:tambur", "mobile:tarti-paket"),
  controller.getSwatchLabelHtml,
);

/**
 * @openapi
 * /api/labels/swatches/{id}/native:
 *   get:
 *     tags: [Labels]
 *     summary: Kartela etiketi SEÇİLİ yazıcı dilinde (HTML veya native komut)
 *     description: |
 *       `/rolls/:id/native`'in kartela analoğu. RASTER_HTML → text/html; PPLA/PPLB/ZPL
 *       → text/plain native komut (Faz-1: üretilir, gönderim simüle). Dil
 *       `X-Label-Language` header'ında.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Seçili dilde kartela etiketi }
 *       404: { description: Kartela bulunamadı }
 */
router.get(
  "/swatches/:id/native",
  verifyToken,
  requireAnyPermission("label:read", "mobile:tambur", "mobile:tarti-paket"),
  controller.getSwatchLabelNative,
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
 * /api/labels/rolls/{id}/seed-snapshot:
 *   post:
 *     tags: [Labels]
 *     summary: Etiket niyetini topa kalıcılaştır (baskısız)
 *     description: |
 *       Operatörün seçtiği müşteri/stok niyetini `lastLabelSnapshot`'a yazar —
 *       fiziksel baskıdan ve LABEL_PRINTED audit'inden BAĞIMSIZ. Yazıcı bağlı
 *       olmasa / diyalog iptal edilse bile niyet kalıcı olsun diye baskı-ÖNCESİ
 *       çağrılır; LABEL_PRINTED audit'i YAZMAZ (sadece snapshot).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Snapshot yazıldı }
 *       404: { description: Top bulunamadı }
 */
router.post(
  "/rolls/:id/seed-snapshot",
  verifyToken,
  requireAnyPermission("label:print", ...MOBILE_LABEL_PRINTERS),
  controller.seedRollLabelSnapshot,
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
