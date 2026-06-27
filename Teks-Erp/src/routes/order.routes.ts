// =============================================================================
// TeksERP - Order Routes (OrderService + BaseController CRUD)
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { BaseController } from "../controllers/base.controller";
import { OrderService } from "../services/order.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";
import "../types/express-augment";

const service = new OrderService({
  modelName: "order",
  tableName: "ORDER",
  searchFields: ["orderNumber"],
  dateFields: ["createdAt", "deadline"],
  defaultInclude: {
    customer: true,
    branch: { select: { id: true, name: true, city: true, district: true } },
    lines: {
      include: {
        item: {
          include: {
            allowedProperties: { include: { property: true } },
          },
        },
        color: true,
        requiredProperties: { include: { property: true } },
        // Frontend "Kalemler düzenlenebilir mi?" kararı için: kalem bir WO'ya
        // bağlıysa kilit. CANCELLED WO bağı sayılmaz (frontend status'e bakar).
        workOrderLinks: {
          select: {
            workOrderId: true,
            workOrder: { select: { status: true } },
          },
        },
      },
    },
  },
  nestedCreateFields: ["lines"],
  // İlişki/aggregate sıralama: Müşteri (customer.name), Şube (branch.name),
  // Kalem (lines _count). Bu anahtarlarda findAllCursor offset-cursor'a düşer.
  relationSortMap: {
    customer: (o) => ({ customer: { name: o } }),
    branch: (o) => ({ branch: { name: o } }),
    lineCount: (o) => ({ lines: { _count: o } }),
  },
});

const controller = new BaseController(service);
const router = Router();

const reasonSchema = z.object({
  reason: z.string().min(1, "Sebep gerekli").max(500),
});

/**
 * @openapi
 * /api/orders/{id}/manual-close:
 *   post:
 *     tags: [Orders]
 *     summary: Siparişi manuel tamamla (planlamacı)
 *     description: |
 *       Tölerans dışında eksik metraj, müşteri kabulü vb. durumlarda planlamacı
 *       siparişi manuel kapatır. APPROVED veya PARTIAL_SHIPPED durumdaki
 *       siparişler için. Sebep zorunlu.
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
 *               reason: { type: string, maxLength: 500 }
 *     responses:
 *       200: { description: Sipariş tamamlandı }
 *       400: { description: Onaysız/iptal/zaten tamamlanmış sipariş }
 */
router.post(
  "/:id/manual-close",
  verifyToken,
  requirePermission("order:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { reason } = reasonSchema.parse(req.body);
      const result = await service.manualComplete(
        req.params.id as string,
        reason,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/orders/{id}/reopen:
 *   post:
 *     tags: [Orders]
 *     summary: Manuel kapatılmış siparişi yeniden aç
 *     description: |
 *       Sadece manualClosedById dolu siparişler için. Status PARTIAL_SHIPPED
 *       (sevk varsa) veya APPROVED'a döner.
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/:id/reopen",
  verifyToken,
  requirePermission("order:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { reason } = reasonSchema.parse(req.body);
      const result = await service.reopen(
        req.params.id as string,
        reason,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/orders/{id}/cancel-preview:
 *   get:
 *     tags: [Orders]
 *     summary: Sipariş iptal preview — etkilenecek WO listesi
 *     description: |
 *       Operatöre detaylı onay göstermek için çağrılır. Her etkilenecek WO için
 *       statü, üretilen rulo sayısı, diğer bağlı sipariş sayısı ve izinli
 *       aksiyonları (UNLINK_ONLY / CONVERT_TO_STOCK / CANCEL_WO) döner.
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/:id/cancel-preview",
  verifyToken,
  requirePermission("order:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await service.getCancelPreview(req.params.id as string);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/orders/{id}/cancel:
 *   post:
 *     tags: [Orders]
 *     summary: Sipariş iptal et (per-WO aksiyonlu)
 *     description: |
 *       Operatör preview'ı görüp her WO için aksiyon seçtikten sonra çağrılır.
 *       `workOrderActions` boş gelirse default davranış uygulanır (PLANNED →
 *       UNLINK_ONLY, IN_PROGRESS+ tek-sipariş → CONVERT_TO_STOCK, çoklu →
 *       UNLINK_ONLY).
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               workOrderActions:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [workOrderId, action]
 *                   properties:
 *                     workOrderId: { type: string, format: uuid }
 *                     action: { type: string, enum: [UNLINK_ONLY, CONVERT_TO_STOCK, CANCEL_WO] }
 */
const cancelBodySchema = z.object({
  workOrderActions: z
    .array(
      z.object({
        workOrderId: z.string().uuid(),
        action: z.enum(["UNLINK_ONLY", "CONVERT_TO_STOCK", "CANCEL_WO"]),
      })
    )
    .optional()
    .default([]),
});
router.post(
  "/:id/cancel",
  verifyToken,
  requirePermission("order:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workOrderActions } = cancelBodySchema.parse(req.body ?? {});
      const result = await service.cancelWithActions(
        req.params.id as string,
        workOrderActions,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/orders:
 *   get:
 *     tags: [Orders]
 *     summary: Sipariş listesi
 *     description: Tüm siparişleri müşteri ve sipariş kalemleri ile listeler.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Sipariş numarası ile arama
 *       - in: query
 *         name: filter[status]
 *         schema: { type: string, enum: [PENDING, APPROVED, IN_PRODUCTION, PARTIAL_SHIPPED, COMPLETED, CANCELLED] }
 *       - in: query
 *         name: filter[customerId]
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Sayfalanmış sipariş listesi
 */
router.get("/", verifyToken, requirePermission("order:read"), controller.findAll);

/**
 * @openapi
 * /api/orders/wo-picker:
 *   get:
 *     tags: [Orders]
 *     summary: İş emri picker'ı için müsait sipariş kalemleri
 *     description: |
 *       Aktif WO'ya (PLANNED/IN_PROGRESS/PAUSED/COMPLETED) bağlı kalemler
 *       hem `lines`'tan çıkarılır hem de hiç müsait satırı kalmayan sipariş
 *       tamamen düşer. CANCELLED WO blok değildir. `excludeWorkOrderId`
 *       verilirse o WO'nun kendi bağları "bağ değil gibi" sayılır
 *       (edit modu).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: excludeWorkOrderId
 *         schema: { type: string, format: uuid }
 *         description: Düzenleme modunda mevcut WO'nun kendi bağlarını yoksay
 *       - in: query
 *         name: filter[status]
 *         schema: { type: string }
 *       - in: query
 *         name: filter[customerId]
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Müsait kalemleri olan siparişler }
 */
router.get(
  "/wo-picker",
  verifyToken,
  // O10 fix (frontend incelemesi): WO formunun sipariş picker'ı — kardeşi
  // /order-lines/coverage gibi WO izinleriyle de erişilebilir olmalı; yalnız
  // order:read istemek workorder:write'lı planlamacının formunu kilitliyordu.
  requireAnyPermission("order:read", "workorder:read", "workorder:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await service.findAvailableForWorkOrder(req);
      res.json(result);
    } catch (e) {
      next(e);
    }
  }
);

/**
 * @openapi
 * /api/orders/order-lines/available:
 *   get:
 *     tags: [Orders]
 *     summary: Özelliğe uyan açık sipariş kalemleri (Açık>0)
 *     description: itemId zorunlu; colorId/width opsiyonel. Tambur yeniden-kes / paket picker'ı.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: itemId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: colorId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: width
 *         schema: { type: number }
 *     responses:
 *       200: { description: Açık sipariş kalemleri }
 */
router.get(
  "/order-lines/available",
  verifyToken,
  requireAnyPermission(
    "order:read",
    "quality:write",
    "mobile:tambur",
    "mobile:tarti-paket",
    "mobile:hizli-is-emri",
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // itemId opsiyonel: legacy modda (limit yok) servis zorunlu kılar; cursor
      // modda (limit var) "sipariş-önce" aramalı liste için boş bırakılabilir.
      const itemId = (req.query.itemId as string | undefined) || undefined;
      const colorId = (req.query.colorId as string | undefined) || undefined;
      const widthRaw = req.query.width as string | undefined;
      const width =
        widthRaw != null && widthRaw !== "" ? Number(widthRaw) : undefined;
      // Hızlı İş Emri "ne kadar daha üretmeliyim" için üretimdeki düşülmüş net açık ister.
      const withInProduction = req.query.withInProduction === "true";
      const search = (req.query.search as string | undefined) || undefined;
      const cursor = (req.query.cursor as string | undefined) || undefined;
      const limitRaw = req.query.limit as string | undefined;
      const limit =
        limitRaw != null && limitRaw !== "" ? parseInt(limitRaw, 10) : undefined;
      const withTotal = req.query.withTotal === "true";
      const result = await service.findAvailableOrderLines({
        itemId,
        colorId,
        width,
        withInProduction,
        search,
        cursor,
        limit,
        withTotal,
      });
      res.json(result);
    } catch (e) {
      next(e);
    }
  }
);

/**
 * @openapi
 * /api/orders/order-lines/coverage:
 *   post:
 *     tags: [Orders]
 *     summary: Seçili sipariş kalemleri için üretim kapsama paneli (net açık)
 *     description: >
 *       Her kalem için istenen − sevk − WO-rezerve − serbest depo − ham stok = net açık.
 *       Serbest stok rezerve edilmez (anlık fotoğraf). excludeWorkOrderId düzenleme modunda
 *       WO'nun kendi tahsisini saymaz. WO oluşturma ekranını besler.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [lineIds]
 *             properties:
 *               lineIds:            { type: array, items: { type: string, format: uuid } }
 *               excludeWorkOrderId: { type: string, format: uuid }
 *     responses:
 *       200: { description: "Kalem başına kapsama (requested/shipped/reserved/freeWarehouse/freeStock/netGap)" }
 */
router.post(
  "/order-lines/coverage",
  verifyToken,
  requireAnyPermission("order:read", "workorder:read", "workorder:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({
        lineIds: z.array(z.string().uuid("Geçersiz kalem ID")).max(100),
        excludeWorkOrderId: z.string().uuid("Geçersiz WO ID").optional(),
      });
      const body = schema.parse(req.body);
      const result = await service.getCoverageForLines(body);
      res.json(result);
    } catch (e) {
      next(e);
    }
  }
);

/**
 * @openapi
 * /api/orders/{id}:
 *   get:
 *     tags: [Orders]
 *     summary: Sipariş detayı
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Sipariş detayı (müşteri ve kalemler dahil)
 *       404:
 *         description: Sipariş bulunamadı
 */
router.get("/:id", verifyToken, requirePermission("order:read"), controller.findById);

/**
 * @openapi
 * /api/orders:
 *   post:
 *     tags: [Orders]
 *     summary: Yeni sipariş oluştur
 *     description: Sipariş numarası otomatik üretilir (YYYYMMDD-N formatında).
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerId]
 *             properties:
 *               customerId: { type: string, format: uuid }
 *               branchId: { type: string, format: uuid, nullable: true }
 *               currency: { type: string, enum: [TRY, USD, EUR, GBP], default: "TRY" }
 *               totalAmount:
 *                 type: number
 *                 description: |
 *                   Boş bırakılırsa lines'tan otomatik hesaplanır
 *                   (sum(quantity × unitPrice)). Manuel verirseniz override
 *                   olur (KDV/indirim/navlun gibi durumlar için).
 *               deadline: { type: string, format: date-time }
 *               lines:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     itemId: { type: string, format: uuid }
 *                     colorId: { type: string, format: uuid, nullable: true }
 *                     quantity: { type: number }
 *                     unitPrice: { type: number, nullable: true, description: "Opsiyonel — fiyatsız sipariş için boş bırakılabilir" }
 *                     width: { type: number, nullable: true }
 *                     customerItemName: { type: string, nullable: true }
 *                     customerColorName: { type: string, nullable: true }
 *     responses:
 *       201:
 *         description: Sipariş oluşturuldu
 *       400:
 *         description: Geçersiz para birimi veya validasyon hatası
 */
router.post("/", verifyToken, requirePermission("order:write"), controller.create);

/**
 * @openapi
 * /api/orders/quick-from-rolls:
 *   post:
 *     tags: [Orders]
 *     summary: Saha #11 — ham/stok toplardan hızlı sipariş (okut→müşteri→otomatik satır)
 *     description: |
 *       Okutulan topları spec (ürün+renk+en) bazında gruplayıp sipariş satırlarına
 *       çevirir, siparişi APPROVED açar ve STOK topları sevke hazır (WAREHOUSE) alır.
 *       Toplar siparişe BAĞLANMAZ (gevşek model — karşılanma spec-toplam üzerinden).
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerId, rollIds]
 *             properties:
 *               customerId: { type: string, format: uuid }
 *               branchId: { type: string, format: uuid, nullable: true }
 *               rollIds: { type: array, items: { type: string, format: uuid } }
 *     responses:
 *       201: { description: Hızlı sipariş açıldı }
 *       409: { description: Top uygun değil (sevkiyatta/iş emrinde/yanlış statü) }
 */
router.post(
  "/quick-from-rolls",
  verifyToken,
  requireAnyPermission("order:write", "mobile:hizli-is-emri", "mobile:tarti-paket"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({
        customerId: z.string().uuid("Geçersiz müşteri ID"),
        branchId: z.string().uuid("Geçersiz şube ID").optional().nullable(),
        rollIds: z.array(z.string().uuid("Geçersiz top ID")).min(1, "En az bir top okutulmalı").max(500),
      });
      const body = schema.parse(req.body);
      const result = await service.quickOrderFromRolls(body, req.user?.userId);
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  }
);

/**
 * @openapi
 * /api/orders/{id}:
 *   patch:
 *     tags: [Orders]
 *     summary: Sipariş güncelle (header alanları)
 *     description: |
 *       APPROVED durumunda customerId, branchId, currency, totalAmount, deadline
 *       güncellenebilir (aktif WO bağı varsa customer/branch kilit). PARTIAL_SHIPPED'de
 *       sadece deadline. COMPLETED/CANCELLED kilitli. Kalemler hiçbir durumda
 *       güncellenmez.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               customerId:  { type: string, format: uuid }
 *               branchId:    { type: string, format: uuid, nullable: true }
 *               currency:    { type: string, enum: [TRY, USD, EUR, GBP] }
 *               totalAmount: { type: number, nullable: true }
 *               deadline:    { type: string, format: date-time, nullable: true }
 *     responses:
 *       200: { description: Güncellendi }
 *       409: { description: Tamamlanmış veya aktif WO bağı nedeniyle kilit }
 */
router.patch("/:id", verifyToken, requirePermission("order:write"), controller.update);

/**
 * @openapi
 * /api/orders/{id}:
 *   delete:
 *     tags: [Orders]
 *     summary: Sipariş iptal et (soft delete)
 *     description: Siparişin durumunu CANCELLED olarak günceller.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: İptal edildi
 */
router.delete("/:id", verifyToken, requirePermission("order:write"), controller.remove);

/**
 * @openapi
 * /api/orders/{id}/permanent:
 *   delete:
 *     tags: [Orders]
 *     summary: Siparişi kalıcı olarak sil
 *     description: Sipariş ve tüm kalemleri veritabanından kalıcı olarak silinir.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Kalıcı olarak silindi
 *       404:
 *         description: Sipariş bulunamadı
 */
router.delete("/:id/permanent", verifyToken, requirePermission("order:write"), controller.hardRemove);

export default router;
