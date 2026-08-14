// =============================================================================
// ALIŞ SİPARİŞİ (PurchaseOrder) ROTALARI — Paket D3
// =============================================================================
// ⚠️ MOUNT: bu router KENDİ rejim kapısını taşıdığı için `app.ts`e SPESİFİK ön
// ekle bağlanır:
//
//     app.use("/api/purchase-orders", purchaseOrderRoutes);
//
// Genel bir `/api` prefix'inin ALTINA gömülmez. Kapısını üst router'dan MİRAS
// ALAN bir alt router olsaydı üst router'ın İÇİNE bağlanırdı (finance
// `/allocations` emsali) — bu router öyle değil.
//
// ⚠️ İKİ KAPI, İKİ SORU: `requireFinanceEnabled` ("bu kurulum ticaret paketini
// kullanıyor mu") + `requirePermission` ("bu kişi bunu yapabilir mi"). Fabrikada
// `finance.enabled` KAPALI ve tek bir kapısız uç, "fabrika sıfır-fark"
// garantisini deler: adresi bilen bir kullanıcı ekranı yine açar ve kapalı
// modüle kayıt yazar.
//
// ⚠️ ROTA SIRASI: `/open-lines` `/:id`ten ÖNCE. Sonra yazılsaydı Express
// "open-lines"ı bir id sanır, `assertValidUuid` 400 verir ve uç sahada "bozuk"
// görünürdü (`/stats` emsali).
//
// ⚠️ `:id` HER YOLDA `assertValidUuid`'DEN GEÇER. Ham string doğrudan Prisma'ya
// giderse hata `P2023`'e düşer ve kullanıcı "Geçersiz veri formatı" gibi hangi
// alanı gösterdiği belirsiz bir mesaj alır (`order.routes` emsali).
//
// İZİNLER:
//   `purchase-order:read`  — liste · detay · açık kalemler
//   `purchase-order:write` — aç · düzenle · iptal
// Yazan okuyabilmeli: yazma uçlarında `requirePermission("purchase-order:write")`
// yeterlidir, okuma uçları İKİSİNİ de kabul eder (`goods-receipt` emsali) —
// aksi hâlde yalnız "yazma" işaretlenen kullanıcı ekranı HİÇ açamaz ve sebebi
// hiçbir yerde yazmaz.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { purchaseOrderService } from "../services/purchase-order.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";
import { requireFinanceEnabled } from "../middlewares/finance.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { isCursorRequested, parseQueryParams } from "../utils/query-parser";

const router = Router();

// Rejim kapısı — bu router'daki HER uç için.
router.use(verifyToken, requireFinanceEnabled);

const READ_PERMS = ["purchase-order:read", "purchase-order:write"] as const;

// Takvim günü ya da tam ISO an — ikisi de kabul edilir (finance-period emsali).
const isoDate = z.string().datetime({ offset: true }).or(z.string().date());

const lineSchema = z.object({
  itemId: z.string().uuid(),
  // ⚠️ `positive()` burada DEĞİL serviste de kontrol edilir: Zod istemciyi,
  // servis ise dahili çağıranı korur (F221 deseni).
  qty: z.number().positive(),
  unitPrice: z.number().nonnegative().nullable().optional(),
  notes: z.string().max(300).nullable().optional(),
});

const createSchema = z.object({
  supplierId: z.string().uuid(),
  currency: z.enum(["TRY", "USD", "EUR", "GBP", "RUB"]).optional(),
  orderDate: isoDate.optional(),
  expectedDate: isoDate.nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  // Zaman aşımı tekrarında ikinci sipariş açılmaz — belge numarası boşa
  // sarf edilmez ve satın almacı aynı malı iki kez ısmarladığını sanmaz.
  clientToken: z.string().uuid().optional(),
  lines: z.array(lineSchema).min(1).max(500),
});

const updateSchema = z.object({
  supplierId: z.string().uuid().optional(),
  currency: z.enum(["TRY", "USD", "EUR", "GBP", "RUB"]).optional(),
  orderDate: isoDate.optional(),
  expectedDate: isoDate.nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  // Verilmezse kalemlere DOKUNULMAZ; verilirse TAMAMEN değiştirilir.
  lines: z.array(lineSchema).min(1).max(500).optional(),
});

/**
 * @openapi
 * /api/purchase-orders:
 *   get:
 *     tags: [PurchaseOrders]
 *     summary: Alış siparişi listesi
 *     description: >
 *       Offset (`page`/`pageSize`) veya cursor (`?mode=cursor`&`cursor=`) modu.
 *       Cursor modunda `total` NULL döner — cursor'ın tüm anlamı toplam sayımı
 *       yapmamaktır.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: filter[supplierId]
 *         schema: { type: string }
 *         description: Tek uuid ya da virgüllü liste
 *       - in: query
 *         name: filter[status]
 *         schema: { type: string, enum: [OPEN, PARTIAL, CLOSED, CANCELLED] }
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string, format: date-time }
 *         description: Sipariş tarihi alt sınırı
 *       - in: query
 *         name: dateTo
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200: { description: Sipariş listesi }
 *       403: { description: Ticaret paketi kapalı ya da yetki yok }
 */
router.get("/", requireAnyPermission(...READ_PERMS), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, filters, search, dateFrom, dateTo } = parseQueryParams(req);
    const cursorMode = isCursorRequested(req);
    const { rows, total, nextCursor } = await purchaseOrderService.list({
      page,
      pageSize,
      filters,
      search,
      dateFrom,
      dateTo,
      cursor: req.query.cursor as string | undefined,
      cursorMode,
    });
    res.status(200).json({
      success: true,
      data: rows,
      ...(cursorMode
        ? { pagination: { pageSize, nextCursor, hasMore: nextCursor !== null } }
        : { pagination: { page, pageSize, total, totalPages: Math.ceil((total ?? 0) / pageSize) } }),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/purchase-orders/open-lines:
 *   get:
 *     tags: [PurchaseOrders]
 *     summary: "Ne ısmarladım, ne geldi" — karşılanmamış sipariş kalemleri
 *     description: >
 *       Yalnız `OPEN`/`PARTIAL` siparişlerin `receivedQty < qty` olan kalemleri.
 *       Süzme SUNUCUDA yapılır: istemcide süzmek yalnız o anki sayfayı süzer ve
 *       satın almacı "açık kalem yok" sanardı.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: supplierId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: itemId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: overdueOnly
 *         schema: { type: boolean }
 *         description: Yalnız beklenen tarihi GEÇMİŞ kalemler (tarihsiz kalem gecikmiş SAYILMAZ)
 *     responses:
 *       200: { description: Açık kalemler }
 */
router.get("/open-lines", requireAnyPermission(...READ_PERMS), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = z
      .object({
        supplierId: z.string().uuid().optional(),
        itemId: z.string().uuid().optional(),
        overdueOnly: z
          .union([z.literal("true"), z.literal("false"), z.boolean()])
          .optional()
          .transform((v) => v === true || v === "true"),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      })
      .parse(req.query);
    const { rows, total } = await purchaseOrderService.openLines(q);
    res.status(200).json({ success: true, data: rows, meta: { total } });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/purchase-orders/{id}:
 *   get:
 *     tags: [PurchaseOrders]
 *     summary: Sipariş detayı — kalemler + karşılanma + bağlı mal kabul fişleri
 *     description: >
 *       Her kalem `receivedQty` (saklanan) ile birlikte `liveReceivedQty`
 *       (kaynaktan hesaplanan) ve `drift` işaretini de taşır. Fark varsa
 *       ekran bunu SÖYLER — sessiz kalmak, karşılanma rakamının neden
 *       tutmadığını hiçbir yerde açıklamamak olurdu.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Sipariş detayı }
 *       404: { description: Bulunamadı }
 */
router.get("/:id", requireAnyPermission(...READ_PERMS), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({ success: true, data: await purchaseOrderService.getById(assertValidUuid(req.params.id)) });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/purchase-orders:
 *   post:
 *     tags: [PurchaseOrders]
 *     summary: Alış siparişi aç
 *     description: >
 *       Belge numarası `AS + GGAAYY + NNNN`. `clientToken` verilirse idempotent
 *       (zaman aşımı tekrarında ikinci sipariş açılmaz).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Oluşturuldu }
 *       400: { description: Tedarikçi/ürün geçersiz ya da kalem yok }
 */
router.post("/", requirePermission("purchase-order:write"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createSchema.parse(req.body);
    const result = await purchaseOrderService.create(
      {
        ...body,
        orderDate: body.orderDate ? new Date(body.orderDate) : undefined,
        expectedDate: body.expectedDate ? new Date(body.expectedDate) : body.expectedDate === null ? null : undefined,
      },
      req.user?.userId,
    );
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/purchase-orders/{id}:
 *   patch:
 *     tags: [PurchaseOrders]
 *     summary: Siparişi düzenle (yalnız OPEN)
 *     description: >
 *       Mal görmüş sipariş revize EDİLMEZ — karşılanmanın FIFO dağıtımını
 *       geriye dönük değiştirirdi. `lines` verilirse kalemler tamamen
 *       değiştirilir; verilmezse kalemlere dokunulmaz.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Güncellendi }
 *       409: { description: Sipariş OPEN değil / mal kabul edilmiş }
 */
router.patch("/:id", requirePermission("purchase-order:write"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = updateSchema.parse(req.body);
    const result = await purchaseOrderService.update(
      assertValidUuid(req.params.id),
      {
        ...body,
        orderDate: body.orderDate ? new Date(body.orderDate) : undefined,
        expectedDate: body.expectedDate ? new Date(body.expectedDate) : body.expectedDate === null ? null : undefined,
      },
      req.user?.userId,
    );
    res.status(200).json(result);
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/purchase-orders/{id}/cancel:
 *   post:
 *     tags: [PurchaseOrders]
 *     summary: Siparişi iptal et
 *     description: >
 *       Siparişe bağlı AKTİF bir mal kabul fişi varsa 409 — "mal gelmişti"
 *       bilgisi sessizce kaybolmamalı. Önce fişleri iptal edin.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: İptal edildi }
 *       409: { description: Siparişe mal kabul edilmiş }
 */
router.post("/:id/cancel", requirePermission("purchase-order:write"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reason } = z.object({ reason: z.string().max(300).optional() }).parse(req.body ?? {});
    res.status(200).json(await purchaseOrderService.cancel(assertValidUuid(req.params.id), reason, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

export default router;
