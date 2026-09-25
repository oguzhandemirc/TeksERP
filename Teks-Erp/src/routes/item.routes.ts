// =============================================================================
// TeksERP - Item (Stok Kartı) Routes
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { ItemLifecycleStatus } from "@prisma/client";
import { BaseController } from "../controllers/base.controller";
import { ItemService } from "../services/item.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";
import { readFilterList } from "../utils/query-parser";
import "../types/express-augment";

export const itemService = new ItemService({
  modelName: "item",
  tableName: "ITEM",
  // ⚠️ MÜŞTERİ ALIAS'I DA ARANIR (2026-08-19): müşterinin bizim ürüne verdiği ad
  // etikete/irsaliyeye basılıyor ama aranamıyordu — "BELLE" diyen müşterinin
  // kastettiği bizim "18152". Sonuç listesi her zaman BİZİM adımızı gösterir.
  searchFields: ["name", "customerAliases.some.alias"],
  codeSearchFields: ["code"],
  defaultInclude: {
    allowedColors: { include: { color: true } },
    allowedProperties: { include: { property: true } },
  },
  // Create/update ItemService'te custom — assertNameNotDuplicate oradan da
  // açıkça çağrılır (super.create çağrılmayan yol için).
  duplicateNameField: "name",
  entityLabel: "ürün",
});

const controller = new BaseController(itemService);
const router = Router();

// Yaşam döngüsü (URUN-YASAM-DONGUSU.md §5). `clientToken` şemada YOK: geçiş hedef-durum
// idempotenttir (aynı hedefe ikinci istek yazmadan 200 döner), saklanmayacak alan kabul edilmez.
const lifecycleBody = z.object({
  to: z.nativeEnum(ItemLifecycleStatus),
  reason: z.string().trim().max(500, "Gerekçe en fazla 500 karakter olabilir").optional().nullable(),
});
const lifecyclePreviewQuery = z.object({ to: z.nativeEnum(ItemLifecycleStatus) });
const lifecycleSummaryQuery = z.object({
  ids: z
    .string()
    .transform((v) => readFilterList(v))
    .pipe(z.array(z.string().uuid("Geçersiz ürün ID")).min(1, "En az bir ürün ID").max(200, "En fazla 200 ürün")),
});

const addAllowedColorBody = z.object({
  colorId: z.string().uuid("Geçersiz renk ID"),
});
const addAllowedPropertyBody = z.object({
  propertyId: z.string().uuid("Geçersiz özellik ID"),
});

// Saha (mobil KK1) hızlı desen oluşturma — YALNIZ ad kabul edilir (.strict()):
// itemType/kod/birim/isActive/izinli listeler istemciden GELMEZ, backend zorlar.
const quickCreateBody = z
  .object({
    name: z
      .string()
      .min(1, "Desen adı zorunlu")
      .max(100, "Desen adı en fazla 100 karakter olabilir"),
  })
  .strict();

/**
 * @openapi
 * /api/items:
 *   get:
 *     tags: [Items]
 *     summary: Stok kartı listesi
 *     description: Tüm ürünleri filtre, sıralama ve sayfalama ile listeler.
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
 *         name: sortBy
 *         schema: { type: string, default: createdAt }
 *       - in: query
 *         name: sortOrder
 *         schema: { type: string, enum: [asc, desc], default: desc }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Kod veya isimde arama
 *       - in: query
 *         name: filter[itemType]
 *         schema: { type: string, enum: [YARN, FABRIC, CONSUMABLE] }
 *       - in: query
 *         name: filter[isActive]
 *         schema: { type: string, enum: [true, false] }
 *       - in: query
 *         name: filter[allowedColorId]
 *         schema: { type: string }
 *         description: "Bu rengi alabilecek ürünler (uuid; CSV) — izinli renk listesi BOŞ olan ürün her rengi alır"
 *       - in: query
 *         name: filter[allowedPropertyId]
 *         schema: { type: string }
 *         description: "Bu özelliği alabilecek ürünler (uuid; CSV) — izinli özellik listesi BOŞ olan ürün her özelliği alır"
 *     responses:
 *       200:
 *         description: Sayfalanmış ürün listesi
 *       401:
 *         description: Yetkisiz erişim
 */
// `mobile:tambur` — Tambur ekranı kumaş seçicisi (manuel top ekleme + alan
// düzeltme) bu listeyi çağırıyor. 2026-08-17'ye kadar YOKTU: yalnız Tambur
// yetkisi taşıyan operatör sessiz 403 alıyordu (bekçi: test_mobile_screen_permissions).
router.get("/", verifyToken, requireAnyPermission("item:read", "mobile:kk1", "mobile:siparis", "mobile:kumas", "mobile:tambur", "mobile:hizli-is-emri", "mobile:dokuma"), controller.findAll);

/**
 * @openapi
 * /api/items/{id}:
 *   get:
 *     tags: [Items]
 *     summary: Stok kartı detayı
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Ürün detayı
 *       404:
 *         description: Kayıt bulunamadı
 */
// BENZER KAYITLAR — mükerreri REDDETMEK yerine ÖNLEMEK için (2026-08-19).
// ⚠️ `/:id`den ÖNCE tanımlı olmalı; sonra gelirse Express "similar-names"i id
// sanar ve `uuid-param` middleware'i 400 döndürür.
// ⚠️ İzin WRITE: bu uç var olan adları listeler ve yalnız KAYIT AÇAN kişiye
// lazımdır; okuma iznine bakmak görünürlüğü gereksiz genişletirdi.
router.get("/similar-names", verifyToken, requirePermission("item:write"), controller.similarNames);

/**
 * @openapi
 * /api/items/lifecycle-summary:
 *   get:
 *     tags: [Items]
 *     summary: Kartların kalan canlı referans sayısı (liste rozeti)
 *     description: >
 *       Her kart için kalan canlı referans toplamı ve canlı top sayısı — "Tükenene kadar ·
 *       N top kaldı" / "Pasife hazır" rozeti. Kayıtların tek tek listesi önizleme ucundadır.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: ids
 *         required: true
 *         description: Virgülle ayrılmış ürün ID'leri (en fazla 200)
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "[{ id, liveTotal, rolls }]"
 *       400:
 *         description: Geçersiz ID listesi
 */
// ⚠️ `/:id`den ÖNCE: sonra gelirse Express "lifecycle-summary"yi id sanar.
router.get(
  "/lifecycle-summary",
  verifyToken,
  requirePermission("item:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ids } = lifecycleSummaryQuery.parse(req.query);
      res.json(await itemService.lifecycleSummary(ids));
    } catch (err) {
      next(err);
    }
  },
);

router.get("/:id", verifyToken, requireAnyPermission("item:read", "mobile:kk1"), controller.findById);

/**
 * @openapi
 * /api/items:
 *   post:
 *     tags: [Items]
 *     summary: Yeni stok kartı oluştur
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, itemType]
 *             properties:
 *               code: { type: string, example: "STK-000123", description: "Opsiyonel — boş bırakılırsa STK-NNNNNN otomatik üretilir" }
 *               name: { type: string, example: "Boyalı Saten Kumaş" }
 *               itemType: { type: string, enum: [YARN, FABRIC, CONSUMABLE] }
 *               unit: { type: string, enum: [MT, KG, ADET], default: "MT" }
 *     responses:
 *       201:
 *         description: Ürün oluşturuldu
 *       409:
 *         description: Kod zaten mevcut
 */
// Mobil "Kumaş Ekle" ekranı da bu ucu kullanır. `mobile:kumas` YALNIZ buraya
// (yaratma) eklenir — PATCH/DELETE hâlâ `item:write` ister, yoksa saha
// kullanıcısı mevcut kumaşı düzenleyip pasife de alabilirdi.
router.post("/", verifyToken, requireAnyPermission("item:write", "mobile:kumas"), controller.create);

/**
 * @openapi
 * /api/items/quick-create:
 *   post:
 *     tags: [Items]
 *     summary: Saha (KK1) hızlı desen oluştur — yalnız ad
 *     description: >
 *       Mobil ham giriş operatörünün seçili yetkiyle (mobile:kk1-desen) yeni bir
 *       FABRIC kumaş (desen) açması için dar uç. Yalnız `name` kabul edilir; kod
 *       (STK-NNNNNN), birim (MT), itemType (FABRIC) ve isActive backend tarafından
 *       set edilir. Kayıt `pendingReview=true` ile işaretlenir (admin onayı bekler).
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
 *               name: { type: string, example: "PATOS" }
 *     responses:
 *       201:
 *         description: Desen oluşturuldu (pendingReview=true)
 *       403:
 *         description: "'mobile:kk1-desen' yetkisi gerekli"
 *       409:
 *         description: Aynı adda ürün zaten var
 */
router.post(
  "/quick-create",
  verifyToken,
  requirePermission("mobile:kk1-desen"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = quickCreateBody.parse(req.body);
      const result = await itemService.quickCreateFabric(name, req.user?.userId);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/items/{id}:
 *   patch:
 *     tags: [Items]
 *     summary: Stok kartını güncelle
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
 *               name: { type: string }
 *               unit: { type: string }
 *     responses:
 *       200:
 *         description: Güncellendi
 */
router.patch("/:id", verifyToken, requirePermission("item:write"), controller.update);

/**
 * @openapi
 * /api/items/{id}:
 *   delete:
 *     tags: [Items]
 *     summary: Stok kartını pasife al (Pasif'e geç)
 *     description: >
 *       Fiziksel silme yapılmaz; yaşam döngüsü yazıcısıyla ARCHIVED olur. Canlı referans
 *       varsa 409 `ITEM_HAS_LIVE_REFERENCES` + kayıt listesi (çıkış: Tükenene kadar / Birleştir).
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
router.delete("/:id", verifyToken, requirePermission("item:write"), controller.remove);

/**
 * @openapi
 * /api/items/{id}/lifecycle-preview:
 *   get:
 *     tags: [Items]
 *     summary: Yaşam döngüsü geçiş önizlemesi
 *     description: >
 *       Kartın canlı referanslarını (top, açık iş emri, açık sipariş/alış kalemi, dokuma işi,
 *       tezgah koşumu, fason iplik sevki, iplik bakiyesi) TEK TEK listeler. `to=ARCHIVED`
 *       için `canTransition` yalnız canlı referans 0 iken true. Benzer adlı aktif kartlar
 *       yalnız bilgidir (birleştirme otomatik değildir).
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
 *       404:
 *         description: Kart bulunamadı
 */
router.get(
  "/:id/lifecycle-preview",
  verifyToken,
  requirePermission("item:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { to } = lifecyclePreviewQuery.parse(req.query);
      res.json(await itemService.lifecyclePreview(String(req.params.id), to));
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/items/{id}/lifecycle:
 *   post:
 *     tags: [Items]
 *     summary: Yaşam döngüsü geçişi (Aktif / Tükenene kadar / Pasif)
 *     description: >
 *       Tek yazar. Pasif'e geçişte canlı referans varsa 409 `ITEM_HAS_LIVE_REFERENCES`
 *       (`details.references` önizlemeyle aynı biçim). Kart zaten hedef durumdaysa yazmadan
 *       200 + `idempotent:true`.
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
router.post(
  "/:id/lifecycle",
  verifyToken,
  requirePermission("item:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { to, reason } = lifecycleBody.parse(req.body);
      res.json(await itemService.transitionLifecycle(String(req.params.id), to, reason ?? null, req.user?.userId));
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/items/{id}/permanent:
 *   delete:
 *     tags: [Items]
 *     summary: Stok kartını kalıcı olarak sil
 *     description: Veriyi veritabanından tamamen kaldırır. Bu işlem geri alınamaz.
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
 *         description: Kayıt bulunamadı
 */
router.delete("/:id/permanent", verifyToken, requirePermission("item:write"), controller.hardRemove);

/**
 * @openapi
 * /api/items/{id}/allowed-colors:
 *   post:
 *     tags: [Items]
 *     summary: Ürüne tek bir izinli renk ekle
 *     description: Mevcut ise idempotent — yeni satır oluşturulmaz, başarı döner.
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
 *             required: [colorId]
 *             properties:
 *               colorId: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Eklendi veya zaten dahil
 */
router.post(
  "/:id/allowed-colors",
  verifyToken,
  requirePermission("item:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { colorId } = addAllowedColorBody.parse(req.body);
      const result = await itemService.addAllowedColor(
        String(req.params.id),
        colorId,
        req.user?.userId,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/items/{id}/allowed-properties:
 *   post:
 *     tags: [Items]
 *     summary: Ürüne tek bir izinli özellik ekle
 *     description: Mevcut ise idempotent.
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
 *             required: [propertyId]
 *             properties:
 *               propertyId: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Eklendi veya zaten dahil
 */
router.post(
  "/:id/allowed-properties",
  verifyToken,
  requirePermission("item:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { propertyId } = addAllowedPropertyBody.parse(req.body);
      const result = await itemService.addAllowedProperty(
        String(req.params.id),
        propertyId,
        req.user?.userId,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
