// =============================================================================
// TeksERP — Depolar Arası Transfer Routes
// =============================================================================
// `warehouse:transfer` AYRI bir izindir: depo ADINI düzeltebilen herkesin STOK
// TAŞIYABİLMESİ istenmiyor (shipping:write ↔ shipping:undo-dispatch emsali).
// =============================================================================
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { warehouseTransferService } from "../services/warehouse-transfer.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";
import { requireDepoMultiEnabled } from "../middlewares/module.middleware";
import { parseQueryParams } from "../utils/query-parser";

const router = Router();

// Modül kapısı — bu router'daki HER uç için (2026-09-02).
// ⚠️ AYRIM: depo TANIMI ve DEFTERİ rejimsizdir (`warehouse.service.ts` başlığı
// — defteri KK1/sevk/iade/fason da yazar, kapı koymak fabrikada YAZILANI
// fabrikada OKUNAMAZ yapardı); TRANSFER ise çoklu depo YÜZEYİDİR ve tek depolu
// bir kurulumda taşınacak ikinci depo yoktur. Panel karosu zaten çizilmiyordu;
// kapı o görünmez yüzeyi sunucuda da kapatır.
// Kapı `verifyToken`dan SONRA: kimliksiz istek 401 almalı, 403 değil.
router.use(verifyToken, requireDepoMultiEnabled);

const createSchema = z.object({
  fromWarehouseId: z.string().uuid(),
  toWarehouseId: z.string().uuid(),
  // 500 top üst sınırı: tek transfer tek tx'te koşuyor (perf kuralı 10 —
  // transaction süresi kısa kalmalı).
  // min(0): yalnız çuval taşınan transferde toplar boş olabilir — "ikisi de
  // boş" kontrolü serviste (anlamlı Türkçe mesajla).
  rollIds: z.array(z.string().uuid()).min(0).max(500),
  // Çuval-BÜTÜN transfer: çuval içindeki tüm toplarıyla taşınır (2026-08-14).
  sackIds: z.array(z.string().uuid()).max(100).optional(),
  notes: z.string().max(500).nullable().optional(),
  clientToken: z.string().uuid().optional(),
});

// Barkodsuz çuval seçimi — depo ZORUNLU: deposuz çağrı "sistemdeki tüm
// çuvallar" demek olurdu ve transfer her zaman BİR depodan çıkar.
const warehouseSacksSchema = z.object({
  warehouseId: z.string().uuid("Geçersiz depo ID"),
  search: z.string().trim().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/**
 * @openapi
 * /api/warehouse-transfers/sack-lookup:
 *   get:
 *     tags: [WarehouseTransfers]
 *     summary: Çuval kodlarını transfer için çözer (CSV)
 *     description: >
 *       Transfer formunun tarayıcı girişi — CV kodu okutulunca çuval + üye top
 *       özeti döner. Uygunluk hükmü BURADA verilmez (yalnız bilgi taşınır);
 *       gerçek guard'lar create transaction'ının içindedir.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: codes
 *         schema: { type: string, example: "CV1408260001,CV1408260002" }
 *     responses:
 *       200: { description: Çuval listesi (üye sayısı + toplam metraj + konum) }
 */
router.get(
  "/sack-lookup",
  verifyToken,
  requirePermission("warehouse:transfer"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const codes = String(req.query.codes ?? "")
        .split(",")
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 100);
      res.json(await warehouseTransferService.lookupSacks(codes));
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/warehouse-transfers/warehouse-sacks:
 *   get:
 *     tags: [WarehouseTransfers]
 *     summary: BARKODSUZ SEÇİM — bir depodaki transfer edilebilir çuvallar
 *     description: >
 *       Etiket basmayan / barkod okutmayan kullanıcı için transferin çuval
 *       ayağı. Top ayağının karşılığı `GET /api/rolls`'ta zaten var
 *       (filter[warehouseId] + filter[statusIn]). Sevkiyata atanmış ve boş
 *       çuvallar listeye GİRMEZ — `create` onları zaten reddediyor.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: warehouseId, required: true, schema: { type: string } }
 *       - { in: query, name: search, schema: { type: string }, description: Çuval no parçası }
 *       - { in: query, name: limit, schema: { type: integer, default: 50, maximum: 200 } }
 *     responses:
 *       200: { description: Çuval listesi (üye sayısı + toplam metraj) }
 */
router.get(
  "/warehouse-sacks",
  verifyToken,
  requirePermission("warehouse:transfer"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = warehouseSacksSchema.parse(req.query);
      res.json(
        await warehouseTransferService.listWarehouseSacks({
          warehouseId: q.warehouseId,
          search: q.search ?? null,
          limit: q.limit ?? 50,
        }),
      );
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/warehouse-transfers:
 *   get:
 *     tags: [WarehouseTransfers]
 *     summary: Transfer listesi
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: filter[status]
 *         schema: { type: string, enum: [COMPLETED, CANCELLED] }
 *       - in: query
 *         name: filter[fromWarehouseId]
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: dateField
 *         schema: { type: string, enum: [createdAt] }
 *         description: >
 *           Tarih aralığının uygulanacağı kolon. ⚠️ ÜÇÜ BİRLİKTE gönderilir —
 *           `dateField` yoksa `dateFrom`/`dateTo` SESSİZCE yok sayılır.
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: dateTo
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200: { description: Sayfalanmış transfer listesi }
 */
router.get(
  "/",
  verifyToken,
  requireAnyPermission("warehouse:transfer", "warehouse:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, pageSize, filters, search, dateField, dateFrom, dateTo } = parseQueryParams(req);
      const { rows, total } = await warehouseTransferService.list({
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
 * /api/warehouse-transfers/{id}:
 *   get:
 *     tags: [WarehouseTransfers]
 *     summary: Transfer detayı (başlık + taşınan toplar)
 *     description: Kalemler DEFTERDEN okunur — transferin ayrı satır tablosu yoktur.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Transfer detayı }
 *       404: { description: Bulunamadı }
 */
router.get(
  "/:id",
  verifyToken,
  requireAnyPermission("warehouse:transfer", "warehouse:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json({ success: true, data: await warehouseTransferService.loadDetail(req.params.id as string) });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/warehouse-transfers:
 *   post:
 *     tags: [WarehouseTransfers]
 *     summary: Depolar arası transfer (tek adımlı — anında uygulanır)
 *     description: >
 *       TEK TRANSACTION: ya hepsi taşınır ya hiçbiri. Yarım transfer fiziksel
 *       dünyada karşılığı olmayan bir durumdur. Uygun olmayan top varsa 400 +
 *       SOMUT top listesi (hangi topu ayıklayacağı söylenir).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Taşındı }
 *       400: { description: Uygun olmayan top / aynı depo }
 *       409: { description: Toplar bu sırada başka işleme girdi }
 */
router.post(
  "/",
  verifyToken,
  requirePermission("warehouse:transfer"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = createSchema.parse(req.body);
      res.status(201).json(await warehouseTransferService.create(input, req.user?.userId));
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/warehouse-transfers/{id}/cancel:
 *   post:
 *     tags: [WarehouseTransfers]
 *     summary: Transferi geri al (storno)
 *     description: >
 *       Toplar kaynak depoya döner. Yalnız toplar HÂLÂ hedef depoda ve serbestse
 *       geri alınabilir — aradan sevk/başka transfer geçtiyse 409.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Geri alındı }
 *       409: { description: Toplar işlem görmüş }
 */
router.post(
  "/:id/cancel",
  verifyToken,
  requirePermission("warehouse:transfer"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { reason } = z.object({ reason: z.string().max(300).optional() }).parse(req.body ?? {});
      res.status(200).json(await warehouseTransferService.cancel(req.params.id as string, reason, req.user?.userId));
    } catch (e) {
      next(e);
    }
  },
);

export default router;
