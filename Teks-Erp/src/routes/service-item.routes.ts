// =============================================================================
// HİZMET KARTI ROTALARI (`service_items`, D1b) — app.use("/api/service-items", serviceItemRoutes)
// =============================================================================
// İzin ürün kartıyla aynı (`item:read` / `item:write`): aynı kişiler yönetir, yeni izin YOK (plan §6 D1b).
// Modül kapısı yok: hizmet kartı ana veridir; faturalama/fiyat uçları kendi kapılarını taşır.
// Gövdeler `.strict()` — tanınmayan alan 400 (sessiz düşüş yok); iş mantığı `service-item.service.ts`.
// =============================================================================
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { ItemLifecycleStatus, ItemUnit } from "@prisma/client";
import { BaseController } from "../controllers/base.controller";
import { serviceItemService } from "../services/service-item.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { readFilterList } from "../utils/query-parser";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import "../types/express-augment";

const controller = new BaseController(serviceItemService);
const router = Router();
router.use(verifyToken);

const unitEnum = z.nativeEnum(ItemUnit, { message: "Birim MT, KG ya da ADET olmalı" });
const createBody = z
  .object({
    code: z.string().max(32, "Hizmet kodu en fazla 32 karakter olabilir").optional().nullable(),
    name: z.string({ message: "Hizmet adı zorunlu" }).min(1, "Hizmet adı boş bırakılamaz").max(100, "Hizmet adı en fazla 100 karakter olabilir"),
    unit: unitEnum.optional(),
    isActive: z.boolean({ message: "'isActive' true/false olmalı" }).optional(),
  })
  .strict();
const updateBody = z
  .object({
    name: z.string().min(1, "Hizmet adı boş bırakılamaz").max(100, "Hizmet adı en fazla 100 karakter olabilir").optional(),
    unit: unitEnum.optional(),
    isActive: z.boolean({ message: "'isActive' true/false olmalı" }).optional(),
  })
  .strict();
const lifecycleBody = z.object({
  to: z.nativeEnum(ItemLifecycleStatus),
  reason: z.string().trim().max(500, "Gerekçe en fazla 500 karakter olabilir").optional().nullable(),
});
const lifecyclePreviewQuery = z.object({ to: z.nativeEnum(ItemLifecycleStatus) });
const lifecycleSummaryQuery = z.object({
  ids: z
    .string()
    .transform((v) => readFilterList(v))
    .pipe(z.array(z.string().uuid("Geçersiz hizmet kartı ID")).min(1, "En az bir hizmet kartı ID").max(200, "En fazla 200 hizmet kartı")),
});

const idOf = (req: Request): string => assertValidUuid(req.params.id as string, "id");

/**
 * @openapi
 * /api/service-items:
 *   get:
 *     tags: [ServiceItems]
 *     summary: Hizmet kartı listesi
 *     description: Ürün kartlarından ayrı tablo. Arama kod ve adda; `filter[lifecycleStatus]`, `filter[isActive]`, sayfalama/cursor BaseService sözleşmesi.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Sayfalanmış hizmet kartı listesi
 *   post:
 *     tags: [ServiceItems]
 *     summary: Yeni hizmet kartı
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               code: { type: string, description: "Boşsa HZM-NNNNNN üretilir; STK-/HZM- öneki elle yazılamaz" }
 *               name: { type: string }
 *               unit: { type: string, enum: [MT, KG, ADET], default: MT }
 *               isActive: { type: boolean }
 *     responses:
 *       201:
 *         description: Oluşturuldu
 *       400:
 *         description: Geçersiz gövde (Türkçe mesaj)
 *       409:
 *         description: Kod/ad çakışması (ürün kartı dahil — `CARD_CODE_TAKEN_BY_OTHER_KIND`, `CARD_NAME_TAKEN_BY_OTHER_KIND`)
 */
router.get("/", requirePermission("item:read"), controller.findAll);
router.post("/", requirePermission("item:write"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await serviceItemService.create(createBody.parse(req.body ?? {}), req.user?.userId));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/service-items/similar-names:
 *   get:
 *     tags: [ServiceItems]
 *     summary: Benzer adlı hizmet kartları (mükerreri önleme; engel değil liste)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: name
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: excludeId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Benzer kayıt listesi
 */
// ⚠️ Sabit yollar `/:id`den ÖNCE (Express aksi hâlde onları id sanar).
router.get("/similar-names", requirePermission("item:write"), controller.similarNames);

/**
 * @openapi
 * /api/service-items/lifecycle-summary:
 *   get:
 *     tags: [ServiceItems]
 *     summary: Kartların kalan canlı referans sayısı (liste rozeti)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: ids
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "[{ id, liveTotal, rolls }]"
 */
router.get("/lifecycle-summary", requirePermission("item:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await serviceItemService.lifecycleSummary(lifecycleSummaryQuery.parse(req.query).ids));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/service-items/{id}:
 *   get:
 *     tags: [ServiceItems]
 *     summary: Hizmet kartı detayı
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Detay
 *       404:
 *         description: Bulunamadı
 *   patch:
 *     tags: [ServiceItems]
 *     summary: Hizmet kartını güncelle (ad, birim; `isActive` yaşam döngüsüne gider)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Güncellendi
 *   delete:
 *     tags: [ServiceItems]
 *     summary: Pasif'e al (canlı referans varsa 409 ITEM_HAS_LIVE_REFERENCES)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Pasife alındı
 */
router.get("/:id", requirePermission("item:read"), controller.findById);
router.patch("/:id", requirePermission("item:write"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await serviceItemService.update(idOf(req), updateBody.parse(req.body ?? {}), req.user?.userId));
  } catch (err) {
    next(err);
  }
});
router.delete("/:id", requirePermission("item:write"), controller.remove);

/**
 * @openapi
 * /api/service-items/{id}/lifecycle-preview:
 *   get:
 *     tags: [ServiceItems]
 *     summary: Yaşam döngüsü geçiş önizlemesi (canlı referanslar tek tek)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: to
 *         required: true
 *         schema: { type: string, enum: [ACTIVE, PHASE_OUT, ARCHIVED] }
 *     responses:
 *       200:
 *         description: Önizleme
 */
router.get("/:id/lifecycle-preview", requirePermission("item:write"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await serviceItemService.lifecyclePreview(idOf(req), lifecyclePreviewQuery.parse(req.query).to));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/service-items/{id}/lifecycle:
 *   post:
 *     tags: [ServiceItems]
 *     summary: Yaşam döngüsü geçişi (Aktif / Tükenene kadar / Pasif) — tek yazar
 *     security:
 *       - bearerAuth: []
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
 *             required: [to]
 *             properties:
 *               to: { type: string, enum: [ACTIVE, PHASE_OUT, ARCHIVED] }
 *               reason: { type: string, maxLength: 500 }
 *     responses:
 *       200:
 *         description: Geçiş yapıldı (ya da kart zaten hedefteydi)
 *       409:
 *         description: Canlı referans var / durum bu sırada değişti
 */
router.post("/:id/lifecycle", requirePermission("item:write"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { to, reason } = lifecycleBody.parse(req.body ?? {});
    res.json(await serviceItemService.transitionLifecycle(idOf(req), to, reason ?? null, req.user?.userId));
  } catch (err) {
    next(err);
  }
});

export default router;
