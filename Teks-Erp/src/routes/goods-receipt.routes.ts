// =============================================================================
// TeksERP — Mal Kabul (GoodsReceipt) Routes
// =============================================================================
// Satın alınan malın depoya girişi. Alım-satım kurulumunun ana giriş kapısı;
// üretici fabrikada kullanılmaz (mal KK1'den ham girer). Bu yüzden izinler
// hiçbir varsayılan rol şablonunda YOKTUR — kurulumda elle atanır.
// =============================================================================
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { describeOverReceipt, goodsReceiptService } from "../services/goods-receipt.service";
import { describeContractPricing } from "../services/helpers/contract-price.helper";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";
import { requireTicaretEnabled } from "../middlewares/module.middleware";
import { parseQueryParams } from "../utils/query-parser";

const router = Router();

// Modül kapısı — bu router'daki HER uç için (2026-09-02).
// ⚠️ Bu, modül paketinin TEK bilinçli davranış farkıdır: mal kabul bugüne
// kadar kapısızdı ve eski gerekçe "fabrikada da kullanılır" diyordu. Dosyanın
// KENDİ başlığı bunun tersini söylüyor ("üretici fabrikada kullanılmaz — mal
// KK1'den ham girer") ve ölçüm de onu doğruladı: fabrikada bu uçlara giden
// istek yok, izinler hiçbir rol şablonunda tanımlı değil. Kapısız bırakmak,
// alım-satım kurulumunun ANA giriş kapısını her kurulumda açık tutmak olurdu.
// Kapı `verifyToken`dan SONRA: kimliksiz istek 401 almalı, 403 değil.
router.use(verifyToken, requireTicaretEnabled);

const lineSchema = z.object({
  itemId: z.string().uuid(),
  colorId: z.string().uuid().nullable().optional(),
  initialQty: z.number().positive(),
  weightKg: z.number().positive().nullable().optional(),
  width: z.number().positive().nullable().optional(),
  qualityGrade: z.string().max(64).nullable().optional(),
  foldType: z.string().max(64).nullable().optional(),
  propertyIds: z.array(z.string().uuid()).optional(),
  // Satın alma birim fiyatı — fişin para biriminde. ⚠️ Zod tanımadığı anahtarı
  // SESSİZCE ATAR: bu satır olmadan panel fiyat gönderir, backend düşürür.
  unitPrice: z.number().nonnegative().nullable().optional(),
  clientToken: z.string().uuid().optional(),
  // İplik satırı (devere Faz 2): lot numarası + bobin adedi — Zod tanımadığını sessizce atar.
  lotNo: z.string().max(64).nullable().optional(),
  bobbinCount: z.number().int().positive().nullable().optional(),
});

const createSchema = z.object({
  warehouseId: z.string().uuid(),
  supplierId: z.string().uuid().nullable().optional(),
  // C4 — FASON tedarikçi bacağı; `supplierId` ile XOR (servis kapısı 400 verir,
  // mesajı tek kaynaktan: `supplier-party.helper`). ⚠️ Zod tanımadığı anahtarı
  // SESSİZCE ATAR: bu satır olmadan panel fason firmayı seçer, backend düşürür
  // ve fiş tedarikçisiz doğar — üstelik hiçbir hata çıkmadan.
  subcontractorId: z.string().uuid().nullable().optional(),
  // C2 — "ham stok girişi": toplar satılabilir `WAREHOUSE` yerine `STOCK`
  // rafına doğar. Fiş SEVİYESİNDE (satır seviyesi bilinçli açılmadı).
  rawStockEntry: z.boolean().optional(),
  deliveryNoteNo: z.string().max(64).nullable().optional(),
  // Fiş TEK para birimlidir (satır fiyatları bu birimde).
  currency: z.enum(["TRY","USD","EUR","GBP","RUB"]).optional(),
  notes: z.string().max(500).nullable().optional(),
  clientToken: z.string().uuid().optional(),
  // D3 — bu fiş hangi ALIŞ SİPARİŞİNİ karşılıyor (opsiyonel: sipariş bir
  // PLANDIR, kabulün ön koşulu değil). ⚠️ Zod tanımadığı anahtarı SESSİZCE
  // ATAR: bu satır olmadan panel siparişi seçer, backend bağı düşürür ve
  // "ne ısmarladım ne geldi" raporu hiç dolmaz.
  purchaseOrderId: z.string().uuid().nullable().optional(),
  lines: z.array(lineSchema).max(500).optional(),
});

/**
 * @openapi
 * /api/goods-receipts:
 *   get:
 *     tags: [GoodsReceipts]
 *     summary: Mal kabul fişi listesi
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: filter[warehouseId]
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: filter[supplierId]
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: filter[subcontractorId]
 *         schema: { type: string, format: uuid }
 *         description: Fason tedarikçi bacağı (C4) — `supplierId` ile AYRI anahtar
 *       - in: query
 *         name: filter[status]
 *         schema: { type: string, enum: [ACTIVE, CANCELLED] }
 *       - in: query
 *         name: filter[rawStockEntry]
 *         schema: { type: boolean }
 *         description: Ham stok girişli fişler (C2)
 *       - in: query
 *         name: dateField
 *         schema: { type: string, enum: [createdAt] }
 *         description: >
 *           Tarih aralığının uygulanacağı kolon. ⚠️ ÜÇÜ BİRLİKTE gönderilir —
 *           `dateField` yoksa `dateFrom`/`dateTo` SESSİZCE yok sayılır
 *           (whitelist dışı değer de aynı şekilde). Whitelist: `createdAt`.
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: dateTo
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200: { description: Sayfalanmış fiş listesi }
 */
router.get(
  "/",
  verifyToken,
  requireAnyPermission("goods-receipt:read", "goods-receipt:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, pageSize, filters, search, dateField, dateFrom, dateTo } = parseQueryParams(req);
      const { rows, total } = await goodsReceiptService.list({
        page,
        pageSize,
        filters,
        search,
        dateField,
        dateFrom,
        dateTo,
      });
      res.status(200).json({
        success: true,
        data: rows,
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/goods-receipts/{id}:
 *   get:
 *     tags: [GoodsReceipts]
 *     summary: Fiş detayı (başlık + toplar)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Fiş detayı }
 *       404: { description: Bulunamadı }
 */
router.get(
  "/:id",
  verifyToken,
  requireAnyPermission("goods-receipt:read", "goods-receipt:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json({ success: true, data: await goodsReceiptService.loadDetail(req.params.id as string) });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/goods-receipts:
 *   post:
 *     tags: [GoodsReceipts]
 *     summary: Mal kabul fişi aç (opsiyonel satırlarla)
 *     description: >
 *       Her satır ayrı transaction'da doğar — düşen satır `failed[]` içinde
 *       SEBEBİYLE döner, diğerleri kalır. `clientToken` verilirse fiş
 *       idempotenttir (ağ kopmasında ikinci fiş açılmaz).
 *       TEDARİKÇİ (C4): `supplierId` (müşteri-tipli cari) **YA** `subcontractorId`
 *       (fason firma) — ikisi birden dolu olamaz; ikisi de boş bırakılabilir
 *       (zorunluluk fatura kapısındadır). Fiş bir alış siparişine bağlıysa taraf
 *       siparişinkiyle AYNI olmalıdır, boşsa siparişten miras alınır.
 *       RAF (C2): `rawStockEntry: true` → toplar `STOCK` (işlenmek üzere alınan
 *       ham mal), aksi hâlde `WAREHOUSE` (satılabilir). İPLİK satırları bundan
 *       ETKİLENMEZ (kg defteri raf ayrımı taşımaz).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Oluşturuldu }
 *       400: { description: Depo/tedarikçi geçersiz ya da iki tedarikçi birden }
 */
router.post(
  "/",
  verifyToken,
  requirePermission("goods-receipt:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = createSchema.parse(req.body);
      res.status(201).json(await goodsReceiptService.create(input, req.user?.userId));
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/goods-receipts/{id}/lines:
 *   post:
 *     tags: [GoodsReceipts]
 *     summary: Fişe top ekle
 *     description: Mal parça parça gelir — fiş bir KAPTIR, satırlar sonradan eklenebilir.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "Eklendi (failed[] atlanan satırları taşır)" }
 *       409: { description: Fiş iptal edilmiş }
 */
router.post(
  "/:id/lines",
  verifyToken,
  requirePermission("goods-receipt:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { lines } = z.object({ lines: z.array(lineSchema).min(1).max(500) }).parse(req.body);
      const result = await goodsReceiptService.addLines(req.params.id as string, lines, req.user?.userId);
      // ⚠️ İplik satırı `Roll` doğurmaz → `created.length` onu SAYMAZ. Yalnız
      // ona bakan mesaj, 5 kalem iplik girildiğinde "0 top eklendi" derdi ve
      // depocu kaydın düştüğünü sanıp tekrar girerdi. İplik yokken metin
      // eskisiyle BİREBİR.
      const summary =
        result.createdYarn.length > 0
          ? `${result.created.length} top + ${result.createdYarn.length} iplik kalemi`
          : `${result.created.length} top`;
      // ⚠️ D3 — ALIŞ SİPARİŞİ UYARISI BU UÇTA DA BASILIR. Fiş bir KAPTIR:
      // tipik akışta boş fiş açılır ve satırlar buradan eklenir, yani
      // "sipariş miktarı AŞILDI" / "bu ürün siparişte YOK" uyarılarının
      // GERÇEKTEN görüldüğü yer burasıdır. Yalnız `create`e konsaydı uyarı,
      // sahadaki en yaygın yolda hiç görünmeyecekti. Sipariş bağı yoksa
      // `describeOverReceipt` BOŞ string döner → mevcut mesaj bayt-bayt aynı.
      res.status(200).json({
        success: true,
        data: {
          ...(await goodsReceiptService.loadDetail(req.params.id as string)),
          failed: result.failed,
          purchaseOrder: result.purchaseOrder ?? null,
        },
        message:
          (result.failed.length > 0
            ? `${summary} eklendi, ${result.failed.length} satır atlandı.`
            : `${summary} eklendi.`) +
          describeOverReceipt(result.purchaseOrder) +
          // C1 — sözleşme (sipariş) fiyatı uygulandıysa/çeliştiyse SÖYLENİR.
          // Fiyat kararı satırın DOĞDUĞU yerde veriliyor; depocunun kart fiyatı
          // sandığı bir rakamla fişi kapatmasının önündeki tek işaret budur.
          describeContractPricing(result.contractPricing),
      });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/goods-receipts/{id}/cancel:
 *   post:
 *     tags: [GoodsReceipts]
 *     summary: Fişi iptal et (toplar da iptal edilir)
 *     description: >
 *       "Mal HİÇ girmedi" storno semantiği. İşlem görmüş (sevk edilmiş, üretime
 *       girmiş) top varsa 409 — o toplar önce ayıklanmalı.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: İptal edildi }
 *       409: { description: İşlem görmüş top var }
 */
router.post(
  "/:id/cancel",
  verifyToken,
  requirePermission("goods-receipt:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { reason } = z.object({ reason: z.string().max(300).optional() }).parse(req.body ?? {});
      res.status(200).json(await goodsReceiptService.cancel(req.params.id as string, reason, req.user?.userId));
    } catch (e) {
      next(e);
    }
  },
);

export default router;
