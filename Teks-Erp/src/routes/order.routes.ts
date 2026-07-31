// =============================================================================
// TeksERP - Order Routes (OrderService + BaseController CRUD)
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { BaseController } from "../controllers/base.controller";
import { OrderService } from "../services/order.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import "../types/express-augment";

// F157: /available query şeması — ham parse yerine Zod (geçersiz uuid/width net 400).
const emptyToUndef = (v: unknown) => (v === "" || v == null ? undefined : v);
const availableQuerySchema = z.object({
  itemId: z.string().uuid("Geçersiz ürün id").optional(),
  colorId: z.string().uuid("Geçersiz renk id").optional(),
  width: z.preprocess(emptyToUndef, z.coerce.number().positive("En pozitif olmalı").optional()),
  search: z.preprocess(emptyToUndef, z.string().optional()),
  cursor: z.preprocess(emptyToUndef, z.string().optional()),
  limit: z.preprocess(emptyToUndef, z.coerce.number().int().min(1).max(50).optional()),
  withInProduction: z.string().optional().transform((v) => v === "true"),
  withTotal: z.string().optional().transform((v) => v === "true"),
});

const service = new OrderService({
  modelName: "order",
  tableName: "ORDER",
  // Liste araması picker'la (findAvailableForWorkOrder) aynı kapsamda:
  // sipariş no + müşteri adı + kalem kumaş adı / müşteri kumaş adı.
  searchFields: [
    "orderNumber",
    "customer.name",
    "lines.some.item.name",
    "lines.some.customerItemName",
  ],
  dateFields: ["createdAt", "deadline"],
  defaultInclude: {
    customer: true,
    branch: { select: { id: true, name: true, code: true, city: true, district: true } },
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
        // Ayrıca sipariş listesi "İş Emri" rollup rozeti + detay panelindeki
        // "Bağlı İş Emirleri" listesi bu bağdan türer → id + workOrderNumber lazım.
        workOrderLinks: {
          select: {
            workOrderId: true,
            workOrder: { select: { id: true, workOrderNumber: true, status: true } },
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
        assertValidUuid(req.params.id),
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
        assertValidUuid(req.params.id),
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
      const result = await service.getCancelPreview(assertValidUuid(req.params.id));
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/orders/{id}/shipments:
 *   get:
 *     tags: [Orders]
 *     summary: Siparişin sevkiyat drill-down'ı (hangi sevkiyatlarla sevk edildi)
 *     description: >
 *       Çuval sevkiyatı (DISPATCHED + PLANNED, CANCELLED hariç) ve fason direkt sevkleri
 *       birleştirir. dispatchedTotal = order.shippedQty ile mutabık. Bilgilendirici.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: "{ dispatchedTotal, plannedTotal, shipments[] }" }
 */
router.get(
  "/:id/shipments",
  verifyToken,
  // Sipariş detayından (satış kullanıcısı) çağrılır → order:read ŞART; sevk verisi
  // gösterdiği için shipping izinleri de kabul (lojistik kullanıcısı da erişsin).
  requireAnyPermission("order:read", "shipping:read", "shipping:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await service.getOrderShipments(assertValidUuid(req.params.id));
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
        assertValidUuid(req.params.id),
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
 *         schema: { type: string, enum: [PENDING, APPROVED, PARTIAL_SHIPPED, COMPLETED, CANCELLED] }
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
 *       Aktif WO'ya (PLANNED/IN_PROGRESS/COMPLETED) bağlı kalemler
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
      const q = availableQuerySchema.parse(req.query);
      const result = await service.findAvailableOrderLines({
        itemId: q.itemId,
        colorId: q.colorId,
        width: q.width,
        withInProduction: q.withInProduction,
        search: q.search,
        cursor: q.cursor,
        limit: q.limit,
        withTotal: q.withTotal,
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
 * /api/orders/spec-availability:
 *   get:
 *     tags: [Orders]
 *     summary: Spec (kumaş+renk+en) anlık müsaitlik — sipariş giriş formu ipucu
 *     description: >
 *       itemId zorunlu; colorId/width opsiyonel. Depoda serbest (WAREHOUSE, renk+en
 *       birebir) / Üretimde (canlı WO in-flight) / Ham (STOCK, renk-joker + en-agnostik)
 *       metrajlarını döner. ANLIK FOTOĞRAF — rezervasyon değildir.
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
 *       200: { description: "{ freeWarehouse, inProduction, freeStock } (metre)" }
 */
router.get(
  "/spec-availability",
  verifyToken,
  // Sipariş formundan (satış kullanıcısı) çağrılır → order:read ŞART. Planlamacı
  // da erişebilsin diye workorder:read eklenir; yalnız workorder:read satışçıya 403.
  requireAnyPermission("order:read", "order:write", "workorder:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({
        itemId: z.string().uuid("Geçersiz ürün id"),
        colorId: z.string().uuid("Geçersiz renk id").optional(),
        width: z.preprocess(emptyToUndef, z.coerce.number().positive("En pozitif olmalı").optional()),
      });
      const q = schema.parse(req.query);
      const result = await service.getSpecAvailability(q);
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
 *     description: Sipariş numarası otomatik üretilir (SIP+GGAAYY+NNNN (örn SIP1207260001) formatında).
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
 *               clientToken: { type: string, format: uuid, description: "İdempotency anahtarı — form-oturumu başına üretilir; aynı token'la tekrar gönderim mevcut siparişi cached döner (409 CLIENT_TOKEN_COLLISION: aynı token farklı payload)" }
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
 *             required: [customerId, rollIds, clientToken]
 *             properties:
 *               customerId: { type: string, format: uuid }
 *               branchId: { type: string, format: uuid, nullable: true }
 *               rollIds: { type: array, items: { type: string, format: uuid } }
 *               clientToken: { type: string, format: uuid, description: "İdempotency anahtarı — timeout-replay'de mükerrer sipariş önlenir (toplar WAREHOUSE olduğundan claim tek başına korumaz)" }
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
        // İdempotency anahtarı — mobil form-oturumu başına üretir; timeout-replay
        // aynı token'la gelir → create cached siparişi döner (mükerrer önlenir).
        // ZORUNLU (A3, 2026-07-31): tümü-WAREHOUSE top yolunda STOCK-claim bloğu
        // atlanır ve TEK koruma bu token'dır — token'sız replay birebir aynı satırlı
        // ikinci siparişi açardı. Tek çağıran mobil (HizliSiparisScreen) zaten gönderiyor;
        // Electron'da çağıran yok (grep 2026-07-31).
        clientToken: z.string().uuid("Geçersiz istemci anahtarı"),
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
 *     summary: Sipariş güncelle (header + kalemler)
 *     description: |
 *       APPROVED/PENDING durumunda header alanları (customerId, branchId, currency,
 *       totalAmount, deadline, orderDate) + kalemler (lines) güncellenebilir: id
 *       eşleşene update, yeniye create, çıkarılana delete (diff). Aktif (CANCELLED-dışı)
 *       iş emri bağı varsa kalemler kilit (409); customer/branch değişimi
 *       IN_PROGRESS/COMPLETED WO bağında kilit. PARTIAL_SHIPPED'de yalnız
 *       deadline. COMPLETED/CANCELLED kilitli. currency ISO 4217 kataloğuna, deadline
 *       >= orderDate kuralına göre doğrulanır.
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
