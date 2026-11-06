// =============================================================================
// HİZMET FİYAT TABLOSU ROTALARI (2026-11-06, D4)
// =============================================================================
//     app.use("/api/service-prices", servicePriceRoutes);
//
// Kapılar `router.use` ile TOPLU: ticaret (fiyat MAL tarafı, `item-price.routes` emsali) + ön muhasebe +
// hizmet faturası alt anahtarı. Okuma `item:read`, yazma `price:write` (görev ayrılığı — item-price ile aynı).
// Yazım tek yazar `itemPriceService` üzerinden gider; burada iş mantığı yok.
// =============================================================================
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { servicePriceService } from "../services/service-price.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireTicaretEnabled } from "../middlewares/module.middleware";
import { requireFinanceEnabled, requireServiceBillingEnabled } from "../middlewares/finance.middleware";

const router = Router();
router.use(verifyToken, requireTicaretEnabled, requireFinanceEnabled, requireServiceBillingEnabled);

const currencyEnum = z.enum(["TRY", "USD", "EUR", "GBP", "RUB"], { message: "Para birimi TRY, USD, EUR, GBP ya da RUB olmalı" });
const optUuid = (msg: string) => z.string().uuid(msg).optional().or(z.literal("").transform(() => undefined));

const tableSchema = z.object({
  itemId: z.string().uuid("Geçersiz hizmet ID"),
  currency: currencyEnum,
  customerId: optUuid("Geçersiz cari ID"),
});

const historySchema = z.object({
  currency: currencyEnum,
  // "null" = yalnız genel satırlar; atlanmış = hepsi.
  customerId: z.union([z.literal("null").transform(() => null), z.string().uuid("Geçersiz cari ID")]).optional(),
  propertyValueId: z.union([z.literal("null").transform(() => null), z.string().uuid("Geçersiz kademe ID")]).optional(),
});

const writeSchema = z.object({
  clientToken: z.string().uuid("Geçersiz istemci anahtarı"),
  itemId: z.string().uuid("Geçersiz hizmet ID"),
  propertyValueId: z.string().uuid("Geçersiz kademe ID").nullable().optional(),
  customerId: z.string().uuid("Geçersiz cari ID").nullable().optional(),
  currency: currencyEnum,
  price: z.number().nonnegative("Fiyat negatif olamaz").finite(),
  priceUnit: z.enum(["METER", "PIECE", "STITCH"], { message: "Fiyat birimi METER, PIECE ya da STITCH olmalı" }).nullish(),
  validFrom: z.string().datetime({ offset: true, message: "Geçerlilik başlangıcı ISO tarih olmalı" }).nullish().transform((v) => (v ? new Date(v) : null)),
});

/**
 * @openapi
 * /api/service-prices/services:
 *   get:
 *     tags: [ServicePrices]
 *     summary: Hizmet kalemleri + güncel kademe satırı sayısı (tablonun sol listesi)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "[{ id, code, name, unit, isActive, tierRowCount }]" }
 *       403: { description: "MODULE_DISABLED (ticaret / ön muhasebe / hizmet faturası kapalı) ya da izin yok" }
 */
router.get("/services", requirePermission("item:read"), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(await servicePriceService.listServices());
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/service-prices/table:
 *   get:
 *     tags: [ServicePrices]
 *     summary: Bir hizmetin kademe tablosu — genel/müşteri fiyatı, bekleyen ileri tarihli fiyat, etkin fiyat + kaynağı
 *     description: >
 *       Etkin fiyat fatura çözücüsüyle AYNI sıradan gelir (müşteri kademe → müşteri gram → genel kademe →
 *       istasyon gram → kalem). Kademe tablosu doluyken tabloda olmayan kademe `tierMissing:true` (fiyatsız).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: itemId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: currency, required: true, schema: { type: string, enum: [TRY, USD, EUR, GBP, RUB] } }
 *       - { in: query, name: customerId, schema: { type: string, format: uuid }, description: Müşteri görünümü }
 *     responses:
 *       200: { description: ServicePriceTable }
 *       400: { description: Kalem hizmet değil (SERVICE_TIER_NOT_SERVICE) }
 *       404: { description: Hizmet bulunamadı }
 */
router.get("/table", requirePermission("item:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = tableSchema.parse(req.query);
    res.status(200).json(await servicePriceService.table({ itemId: q.itemId, currency: q.currency, customerId: q.customerId ?? null }));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/service-prices/{itemId}/history:
 *   get:
 *     tags: [ServicePrices]
 *     summary: Fiyat geçmişi (en yeni 200 sürüm) — durum ACTIVE / SCHEDULED / PENDING / CLOSED
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: itemId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: currency, required: true, schema: { type: string } }
 *       - { in: query, name: customerId, schema: { type: string }, description: "UUID ya da 'null' (yalnız genel)" }
 *       - { in: query, name: propertyValueId, schema: { type: string }, description: "UUID ya da 'null' (yalnız kalem geneli)" }
 *     responses:
 *       200: { description: Sürüm listesi }
 */
router.get("/:itemId/history", requirePermission("item:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const itemId = z.string().uuid("Geçersiz hizmet ID").parse(req.params.itemId);
    const q = historySchema.parse(req.query);
    res.status(200).json(await servicePriceService.history({ itemId, ...q }));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/service-prices:
 *   post:
 *     tags: [ServicePrices]
 *     summary: Hizmet fiyatı yaz (kademe/müşteri/ileri tarih) — idempotent
 *     description: >
 *       `clientToken` mantıksal deneme başına; aynı token aynı yükle tekrar gelirse ilk kayıt döner, farklı
 *       yükle 409. `validFrom` ileri tarihse yürürlükteki fiyat o ana zamanlanır (bekleyen fiyat).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Yazıldı / değişmedi / tekrar (replay) }
 *       400: { description: Kademe yazım kapıları (SERVICE_TIER_*, ITEM_PRICE_VALID_FROM_PAST) }
 *       409: { description: Eşzamanlı yazım · token çakışması · kaldırılmış kayıt }
 */
router.post("/", requirePermission("price:write"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(await servicePriceService.write(writeSchema.parse(req.body), req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/service-prices/{id}/revoke:
 *   post:
 *     tags: [ServicePrices]
 *     summary: Fiyat satırını kaldır (damga; bekleyen fiyat kaldırılınca yürürlükteki fiyatın zamanlaması geri alınır)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Kaldırıldı }
 *       404: { description: Bulunamadı }
 *       409: { description: Zaten kaldırılmış ya da eşzamanlı değişti }
 */
router.post("/:id/revoke", requirePermission("price:write"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = z.string().uuid("Geçersiz fiyat ID").parse(req.params.id);
    res.status(200).json(await servicePriceService.revoke(id, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

export default router;
