// =============================================================================
// KALEM FİYATI ROTALARI (Paket D · D2)
// =============================================================================
// ⚠️ MOUNT — ROUTER KENDİ KAPISINI TAŞIR:
//
//     app.use("/api/item-prices", itemPriceRoutes);
//
// Bu router `router.use(verifyToken, requireTicaretEnabled)` ile kendi rejim
// kapısını taşıdığı için app.ts'e SPESİFİK ön ekle bağlanır. `/api/finance`
// altına konulmadı: fiyat bir MASTER-DATA ayarıdır (kalem kartının uzantısı),
// bir defter kaydı değil — panelde de Tanımlar tarafında yaşayacak.
//
// ── ⚠️ İKİ KAPI, İKİ SORU ────────────────────────────────────────────────────
// `requireTicaretEnabled` → "bu kurulum ticaret paketini kullanıyor mu"
//                            (2026-09-02'de `requireFinanceEnabled`ten taşındı:
//                            fiyat listesi MAL tarafıdır, cari defteri değil)
// `requirePermission`      → "bu kişi bunu yapabilir mi"
// Bayrak kapısını atlayan TEK bir uç, üretici fabrikada modülü fiilen açık
// bırakır ve "sıfır-fark" garantisini deler. Kapı `router.use` ile TOPLU
// konulur; uç uç yazılırsa biri unutulur ve unutulan uç sessizce açık kalır.
//
// ── ⚠️ OKUMA/YAZMA İZİN AYRIMI (bilinçli) ────────────────────────────────────
// Okuma  → `item:read`   — fiyatı OKUMAK faturayı hazırlayan HERKESİN işidir.
//                          Ayrı bir `price:read` açmak, onu zaten fatura kesen
//                          herkese vermek zorunda kalacağımız bir gürültü
//                          olurdu.
// Yazma  → `price:write` — satış/alış fiyatını KİM belirler sorusu ayrıdır ve
//                          görev ayrılığı ailesindendir (`shipping:write` ↔
//                          `shipping:invoice` emsali).
//
// ── ⚠️ YOL SIRASI ────────────────────────────────────────────────────────────
// `/resolve` `/:id`ten ÖNCE tanımlanır. Ters sırada "resolve" bir UUID param'ı
// gibi eşleşmeye çalışır ve uç 400/404 verir (emsal: `/rolls/stats`).
// =============================================================================
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { itemPriceService } from "../services/item-price.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireTicaretEnabled } from "../middlewares/module.middleware";
import { parseQueryParams } from "../utils/query-parser";

const router = Router();

// Modül kapısı — bu router'daki HER uç için.
router.use(verifyToken, requireTicaretEnabled);

const kindEnum = z.enum(["PURCHASE", "SALE"]);
const currencyEnum = z.enum(["TRY", "USD", "EUR", "GBP", "RUB"]);

const resolveSchema = z.object({
  itemId: z.string().uuid("Geçersiz kalem ID"),
  kind: kindEnum,
  currency: currencyEnum,
  // Boş string ("müşteri seçilmedi") kart varsayılanı demektir — uuid şeması
  // onu reddederdi ve panel her seferinde parametreyi silmek zorunda kalırdı.
  customerId: z
    .string()
    .uuid("Geçersiz cari ID")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

// Geçmiş görünümü açıkça istenir; tanınmayan değer 400 (fail-closed), sessizce "aktif" sayılmaz.
const listScopeSchema = z.object({
  includeRevoked: z
    .enum(["0", "1", "true", "false"], { message: "includeRevoked yalnız 0/1/true/false olabilir" })
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

const upsertSchema = z.object({
  itemId: z.string().uuid("Geçersiz kalem ID"),
  // `null` = KART VARSAYILANI. Alanın hiç gönderilmemesi de aynı anlama gelir.
  customerId: z.string().uuid("Geçersiz cari ID").nullable().optional(),
  kind: kindEnum,
  currency: currencyEnum,
  // ⚠️ SIFIR SERBEST (promosyon/numune), NEGATİF DEĞİL — DB CHECK'i de aynısını
  // söyler (`item_prices_price_nonneg`). Zod burada durmasaydı kullanıcı ham
  // Postgres kısıt hatası görürdü.
  price: z.number().nonnegative("Fiyat negatif olamaz").finite(),
  // Hizmet fiyatının birimi (brode fiyat birimi ayarı); atlanmış = metre (eski istemci).
  priceUnit: z.enum(["METER", "PIECE", "STITCH"], { message: "Fiyat birimi METER, PIECE ya da STITCH olmalı" }).nullish(),
});

/**
 * @openapi
 * /api/item-prices/resolve:
 *   get:
 *     tags: [ItemPrices]
 *     summary: ⭐ Bir kalemin geçerli fiyatını çözer
 *     description: >
 *       ÇÖZÜM SIRASI: müşteri istisnası > kart varsayılanı > **null**.
 *       Fiyat bulunamazsa `data: null` döner — SIFIR DÖNMEZ. Çağıran alanı BOŞ
 *       bırakmalıdır; sıfır yazmak "fiyat bilinmiyor" ile "bedava"yı aynı şeye
 *       çevirir ve fatura sessizce sıfır tutarla onaylanabilir hale gelir.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: itemId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: kind, required: true, schema: { type: string, enum: [PURCHASE, SALE] } }
 *       - { in: query, name: currency, required: true, schema: { type: string, enum: [TRY, USD, EUR, GBP, RUB] } }
 *       - { in: query, name: customerId, schema: { type: string, format: uuid }, description: Yoksa yalnız kart varsayılanı aranır }
 *     responses:
 *       200: { description: "{ id, price, source: CUSTOMER|DEFAULT, customerId } veya null" }
 *       404: { description: Kalem bulunamadı }
 */
router.get(
  "/resolve",
  requirePermission("item:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = resolveSchema.parse(req.query);
      res.status(200).json(
        await itemPriceService.resolve({
          itemId: q.itemId,
          kind: q.kind,
          currency: q.currency,
          customerId: q.customerId ?? null,
        }),
      );
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/item-prices:
 *   get:
 *     tags: [ItemPrices]
 *     summary: Fiyat listesi
 *     description: >
 *       `filter[customerId]=null` (ya da `default`) YALNIZ kart varsayılanlarını
 *       getirir — o değer bir UUID değildir ve jenerik filtre yolundan geçseydi
 *       "null" METNİ uuid kolonuna gidip 400 üretirdi. Varsayılan YALNIZ aktif
 *       (damgasız) satırlar; `includeRevoked=1` kaldırılmış/değişmiş sürümleri de
 *       getirir (aynı anahtarda yeniden eskiye).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: includeRevoked, schema: { type: string, enum: ["0", "1", "true", "false"] }, description: "Damgalı fiyat geçmişini de getir" }
 *       - { in: query, name: "filter[itemId]", schema: { type: string } }
 *       - { in: query, name: "filter[customerId]", schema: { type: string }, description: "UUID · CSV · 'null' (yalnız varsayılanlar)" }
 *       - { in: query, name: "filter[kind]", schema: { type: string, enum: [PURCHASE, SALE] } }
 *       - { in: query, name: "filter[currency]", schema: { type: string, enum: [TRY, USD, EUR, GBP, RUB] } }
 *       - { in: query, name: search, schema: { type: string }, description: Kalem kodu/adı }
 *     responses:
 *       200: { description: Sayfalanmış fiyat listesi }
 */
router.get(
  "/",
  requirePermission("item:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, pageSize, filters, search } = parseQueryParams(req);
      const { includeRevoked } = listScopeSchema.parse({ includeRevoked: req.query.includeRevoked });
      const { rows, total } = await itemPriceService.list({ page, pageSize, filters, search, includeRevoked });
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
 * /api/item-prices:
 *   post:
 *     tags: [ItemPrices]
 *     summary: Fiyat yaz (yoksa açar, farklıysa yeni sürüm, aynıysa dokunmaz)
 *     description: >
 *       `customerId` YOKSA/`null` ise KART VARSAYILANI yazılır; doluysa o
 *       müşterinin İSTİSNASI. Fiyat yerinde EZİLMEZ: eski sürüm `revokedAt` ile
 *       damgalanır, yeni sürüm yazılır (tek tx; eşzamanlı ikinci yazım 409).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Yazıldı ("created" alanı ilk tanım mı, değişim/aynı fiyat mı olduğunu söyler) }
 *       400: { description: Kalem/cari yok ya da pasif · fiyat negatif/çok büyük }
 *       409: { description: Aynı anahtara eşzamanlı yazım }
 */
router.post(
  "/",
  requirePermission("price:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = upsertSchema.parse(req.body);
      res.status(200).json(await itemPriceService.upsert(input, req.user?.userId));
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/item-prices/{id}:
 *   delete:
 *     tags: [ItemPrices]
 *     summary: Fiyat satırını kaldır
 *     description: >
 *       Satır SİLİNMEZ, `revokedAt` ile damgalanır (defter ③a): fiyat geçmişi
 *       "şu tarih itibarıyla" okunmaya devam eder. İstisna kaldırılınca müşteri
 *       kart varsayılanına döner; varsayılan kaldırılınca fiyat "bilinmiyor" olur
 *       ve satır BOŞ gelir (sıfıra düşmez).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Kaldırıldı (damgalandı) }
 *       404: { description: Bulunamadı }
 *       409: { description: Zaten kaldırılmış ya da eşzamanlı değişti }
 */
router.delete(
  "/:id",
  requirePermission("price:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json(await itemPriceService.remove(req.params.id as string, req.user?.userId));
    } catch (e) {
      next(e);
    }
  },
);

export default router;
