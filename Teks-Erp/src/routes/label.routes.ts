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
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";

const MOBILE_LABEL_PRINTERS = ["mobile:kk1", "mobile:tambur", "mobile:tarti-paket"] as const;

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
 *       `/html` ile aynı resolver'dan: `?peripheralId=` / `?machineId=` veya istasyon (mobil oto).
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
 *         name: peripheralId
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
 *       komutlar ÜRETİLİR, ham gönderim simüle (Faz-2). Format `?peripheralId=`/`?machineId=`
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
 *       `?kind` / `?customerId` / `?orderLineId` / `?stock` / `?peripheralId` / `?machineId`
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
 * /api/labels/peripherals/{id}/sample-html:
 *   get:
 *     tags: [Labels]
 *     summary: Test Et — seçili yazıcının medyasında örnek etiket HTML'i (boyut/pay önizleme)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Medyası kullanılacak yazıcı cihazı (peripheralId)
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Örnek etiket HTML, content: { text/html: { schema: { type: string } } } }
 */
router.get(
  "/peripherals/:id/sample-html",
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
 *       Body { peripheralId?, printerIp, port?, language? }. nativeSendEnabled açıkken gerçek
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
 *       srcDoc ile gösterir. Format `?peripheralId=`/`?machineId=` veya sistem default.
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

// ---- Serbest (statik) etiket baskısı — rulo/kartela bağlamı olmadan ----
// NOT: literal /standalone-templates, param'lı /templates/:id/*'tan ÖNCE (segment
// çakışması yok ama tutarlılık için).

/**
 * @openapi
 * /api/labels/standalone-templates:
 *   get:
 *     tags: [Labels]
 *     summary: Serbest (statik) etiket seçicisi — aktif standalone şablonlar + varyantları
 *     description: |
 *       Yalnız aktif `standalone` şablonlar; her biri basılabilir boyut
 *       varyantlarıyla (id/name/widthMm/heightMm/isPrimary) döner. Baskı seçicisi
 *       bunu tüketir (atama seçicileri `/api/label-templates?assignable=true`).
 *       `customerId` verilirse liste o müşteriye BAĞLI ∪ hiç bağı olmayan "genel"
 *       serbest etiketlerle filtrelenir (başka müşteriye özel bağlılar dışlanır);
 *       geçersiz/eksik → filtresiz. Bu bağ rulo/kartela çözümüne KATILMAZ.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: customerId
 *         required: false
 *         schema: { type: string, format: uuid }
 *         description: Serbest etiketleri bu müşteriye göre filtrele (bağlı ∪ genel)
 *     responses:
 *       200: { description: "{ data: [{ id, name, variants: [...] }] }" }
 */
router.get(
  "/standalone-templates",
  verifyToken,
  requireAnyPermission("label:print", "label-template:read", ...MOBILE_LABEL_PRINTERS),
  controller.listStandaloneTemplates,
);

/**
 * @openapi
 * /api/labels/templates/{id}/native:
 *   get:
 *     tags: [Labels]
 *     summary: Serbest etiketi SEÇİLİ yazıcı dilinde (mock payload) — /rolls/:id/native analoğu
 *     description: |
 *       Kaydedilmiş bir şablon varyantını mock payload ile basar (rulo/kartela YOK).
 *       Varyant seçimi: `?variantId=` → primary → ilk. `?copies=` 1–100 (akış 1–5
 *       DEĞİL). `?encoding=b64` → base64 JSON zarfı ({ encoding, content, language,
 *       contentType, count }); aksi → ham native/HTML. Dil `X-Label-Language`
 *       header'ında. Cihaz/dil/medya `?peripheralId=`/`?machineId=` veya istasyon
 *       (mobil x-device-id) ile çözülür — `/rolls/:id/native` ile aynı zincir.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: variantId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: copies
 *         schema: { type: integer, minimum: 1, maximum: 100 }
 *       - in: query
 *         name: encoding
 *         schema: { type: string, enum: [b64] }
 *     responses:
 *       200: { description: Seçili dilde etiket (JSON zarfı veya ham native/HTML) }
 *       400: { description: Basılabilir varyant yok / varyant bulunamadı }
 *       404: { description: Şablon bulunamadı veya pasif }
 */
router.get(
  "/templates/:id/native",
  verifyToken,
  requireAnyPermission("label:print", "label-template:read", ...MOBILE_LABEL_PRINTERS),
  controller.getStandaloneTemplateNative,
);

/**
 * @openapi
 * /api/labels/templates/{id}/html:
 *   get:
 *     tags: [Labels]
 *     summary: Serbest etiketin tam HTML'i (mock payload) — /rolls/:id/html analoğu
 *     description: |
 *       Kaydedilmiş bir şablon varyantını mock payload ile HTML olarak basar.
 *       Varyant seçimi `?variantId=` → primary → ilk; `?copies=` 1–100. Medya
 *       `?peripheralId=`/`?machineId=` veya istasyon ile çözülür.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: variantId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: copies
 *         schema: { type: integer, minimum: 1, maximum: 100 }
 *     responses:
 *       200: { description: HTML, content: { text/html: { schema: { type: string } } } }
 *       400: { description: Basılabilir varyant yok / varyant bulunamadı }
 *       404: { description: Şablon bulunamadı veya pasif }
 */
router.get(
  "/templates/:id/html",
  verifyToken,
  requireAnyPermission("label:print", "label-template:read", ...MOBILE_LABEL_PRINTERS),
  controller.getStandaloneTemplateHtml,
);

export default router;
