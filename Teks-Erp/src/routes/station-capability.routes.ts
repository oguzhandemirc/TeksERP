// =============================================================================
// TeksERP - Station Capability Routes
// =============================================================================
// Bir istasyonun renk + özellik yetkinliklerini yönetir.
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { Currency } from "@prisma/client";
import { StationCapabilityService } from "../services/station-capability.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireProductionEnabled } from "../middlewares/module.middleware";
import { requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";
import { getStampContext } from "../services/helpers/work-session.helper";
import { MOBILE_SESSION_PERMS } from "../services/work-session.service";
import { getKursunStation, getKursunStationPriceHistory, setKursunStation } from "../services/kursun-station.service";
import { resolveStationDefaultTargets } from "../services/helpers/station-default-targets.helper";
import { readFilterList } from "../utils/query-parser";

const service = new StationCapabilityService();
const router = Router();

// Modül kapısı — bu router'daki HER uç için (2026-09-02).
// ⚠️ Kapı `verifyToken`dan SONRA: kimliksiz istek 401 almalı, 403 değil
// (403 "kaynak var ama modül kapalı" bilgisini kimliksiz kişiye sızdırırdı).
// ⚠️ `router.use` ile TOPLU: uç uç yazılırsa biri unutulur ve unutulan uç
// sessizce açık kalır. Sıra da load-bearing — bu satırdan ÖNCE tanımlanan bir
// uç kapıyı HİÇ görmez (Express kayıt sırası; hata da log da üretmez).
router.use(verifyToken, requireProductionEnabled);

const setCapabilitiesSchema = z.object({
  // colorIds OPSİYONEL — gönderilmezse renk satırlarına dokunulmaz. `.default([])`
  // OLMAZ: renk artık kısıt olmadığı için panel bu alanı hiç göndermiyor, default
  // devreye girseydi her kayıtta istasyonun tüm renk atamaları sessizce silinirdi.
  colorIds: z.array(z.string().uuid()).optional(),
  // 2026-08-10: her özellik artık bir MOD taşır (AUTO/OPTIONAL/REQUIRED).
  // `propertyIds` eski sözleşme olarak KABUL EDİLMEYE DEVAM EDER — panel
  // güncellenene kadar 400 yağmuru olmasın diye; mod verilmeyen satır mevcut
  // modunu KORUR (yeni satır şema varsayılanı OPTIONAL alır).
  propertyIds: z.array(z.string().uuid()).optional(),
  properties: z
    .array(
      z.object({
        propertyId: z.string().uuid(),
        mode: z.enum(["AUTO", "OPTIONAL", "REQUIRED"]).optional(),
        // K22: verilmezse mevcut değer korunur (eski panel göndermez); null = varsayılan değeri kaldır.
        defaultOn: z.boolean().optional(),
        defaultValueId: z.string().uuid().nullable().optional(),
      }),
    )
    .optional(),
});

/**
 * @openapi
 * /api/station-capabilities:
 *   get:
 *     tags: [StationCapabilities]
 *     summary: Tüm istasyonların yetkinlik özeti
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: İstasyon başına renk/özellik sayıları }
 */
router.get(
  "/",
  verifyToken,
  requirePermission("station:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // ?detailed=true → her istasyonun renk + özellik listesini döner
      if (req.query.detailed === "true") {
        res.status(200).json(await service.listAllDetailed());
        return;
      }
      res.status(200).json(await service.listAll());
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/station-capabilities/for-session:
 *   get:
 *     tags: [StationCapabilities]
 *     summary: Aktif çalışma oturumunun İSTASYONUNUN yetkinlikleri (tablet)
 *     description: |
 *       İstasyon, cihazın aktif WorkSession'ından çözülür (x-device-id → oturum) —
 *       `peripherals/for-session` ile aynı desen. Tablet kendi istasyon id'sini
 *       bilmek zorunda kalmaz.
 *
 *       ⚠️ HENÜZ İSTEMCİSİ YOK: Kurşun/QC2 özellik tuşları open-cards
 *       payload'ındaki `stepSummary.properties`'ten, Tambur kat tuşları katalog
 *       kod aramasından çizilir (oturumsuz planlama yüzeyleri de aynı listeyi
 *       kullanır). Bu uç istasyon-bağlı yeni bir ekran için hazır altyapıdır.
 *
 *       Oturum yoksa 400 — boş liste döndürmek "kat seçeneği tanımlı değil" ile
 *       "oturum açık değil"i aynı ekrana çıkarırdı.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ colors, properties[] }" }
 *       400: { description: Aktif oturum yok }
 */
router.get(
  "/for-session",
  verifyToken,
  // Saha tabletleri `station:read` taşımaz — mobil ekran izinleri de kabul
  // edilir (proje kuralı: "Mobil ekranın dokunacağı endpoint → requireAnyPermission").
  requireAnyPermission("station:read", ...MOBILE_SESSION_PERMS),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stamp = await getStampContext(req);
      res.status(200).json(await service.getForSession(stamp?.stationId));
    } catch (e) {
      next(e);
    }
  },
);

const defaultTargetsQuery = z.object({
  stationIds: z.array(z.string().uuid("Geçersiz istasyon kimliği")).min(1, "En az bir istasyon verin.").max(50),
  customerId: z.string().uuid("Geçersiz müşteri kimliği").optional(),
});

/**
 * @openapi
 * /api/station-capabilities/default-targets:
 *   get:
 *     tags: [StationCapabilities]
 *     summary: İE rota adımı ön seçimi (K22) — istasyon başına seçili gelecek özellik/değerler
 *     description: |
 *       TEK KAYNAK çözücü (`helpers/station-default-targets.helper`). AUTO bayrak hep; OPTIONAL yalnız "varsayılan açık";
 *       CHOICE değeri müşteri varsayılanı > yetenek varsayılanı > değerin isDefault'u. İşaret yoksa boş liste (bugünkü).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: stationIds, required: true, schema: { type: string }, description: "virgüllü uuid listesi" }
 *       - { in: query, name: customerId, required: false, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "[{ stationId, targets[] }]" }
 *       400: { description: Geçersiz kimlik }
 */
router.get(
  "/default-targets",
  // İE formu (panel workorder:*) ve tablet İE formu (mobile:hizli-is-emri) okur; istasyon ekranı station:read.
  requireAnyPermission("station:read", "workorder:read", "workorder:write", "mobile:hizli-is-emri"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = defaultTargetsQuery.parse({
        stationIds: readFilterList(req.query.stationIds as string | string[] | undefined),
        customerId: typeof req.query.customerId === "string" && req.query.customerId ? req.query.customerId : undefined,
      });
      res.status(200).json({ success: true, data: await resolveStationDefaultTargets(q.stationIds, q.customerId ?? null) });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/station-capabilities/{stationId}:
 *   get:
 *     tags: [StationCapabilities]
 *     summary: Bir istasyonun renk + özellik yetkinlikleri
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: stationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: "{ colors, properties }" }
 *       404: { description: İstasyon bulunamadı }
 */
router.get(
  "/:stationId",
  verifyToken,
  requirePermission("station:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stationId = req.params.stationId as string;
      res.status(200).json(await service.findByStation(stationId));
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/station-capabilities/{stationId}:
 *   put:
 *     tags: [StationCapabilities]
 *     summary: İstasyonun renk + özellik yetkinliklerini topluca değiştir
 *     description: |
 *       Replace semantics — eski liste silinip yeni liste yazılır; mevcut satırın
 *       MODU korunur (2026-08-10). `colorIds` gönderilmezse renk satırlarına
 *       dokunulmaz. `properties` mod taşıyan yeni sözleşmedir; `propertyIds`
 *       (modsuz) eski sözleşme olarak kabul edilmeye devam eder.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: stationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               colorIds:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *               propertyIds:
 *                 type: array
 *                 description: Eski sözleşme — mod verilmeden satır listesi (yeni satır OPTIONAL doğar).
 *                 items: { type: string, format: uuid }
 *               properties:
 *                 type: array
 *                 description: Yeni sözleşme — satır başına davranış modu.
 *                 items:
 *                   type: object
 *                   required: [propertyId]
 *                   properties:
 *                     propertyId: { type: string, format: uuid }
 *                     mode:
 *                       type: string
 *                       enum: [AUTO, OPTIONAL, REQUIRED]
 *                       description: Verilmezse mevcut satırın modu korunur; yeni satırda OPTIONAL.
 *     responses:
 *       200: { description: Güncel yetkinlikler döner }
 */
router.put(
  "/:stationId",
  verifyToken,
  requirePermission("station:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stationId = req.params.stationId as string;
      const body = setCapabilitiesSchema.parse(req.body);
      const result = await service.setCapabilities(
        stationId,
        body,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  },
);

// Kurşun istasyonu (oie-a): "Kurşun uygular" + gramaj tablosu + gram fiyatı — tek boğaz.
const kursunStationSchema = z.object({
  enabled: z.boolean().optional(),
  values: z.array(z.object({
    code: z.string().trim().max(32).optional(),
    name: z.string().trim().min(1).max(100),
    amount: z.union([z.string().max(20), z.number()]).nullable().optional(),
    isActive: z.boolean().optional(),
    isDefault: z.boolean().optional(),
  }).strict()).max(100).optional(),
  gramPrice: z.union([z.string().max(20), z.number()]).nullable().optional(),
  gramCurrency: z.nativeEnum(Currency).nullable().optional(),
}).strict();

/**
 * @openapi
 * /api/station-capabilities/{stationId}/kursun:
 *   get:
 *     tags: [StationCapabilities]
 *     summary: İstasyonun kurşun ayarı (Kurşun uygular, gramajlar gr/m, gram fiyatı)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: stationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: "{ enabled, values[{code,name,amount,isDefault,isActive}], gramPrice, gramCurrency }" }
 *       404: { description: İstasyon bulunamadı }
 *   put:
 *     tags: [StationCapabilities]
 *     summary: İstasyonun kurşun ayarını değiştir
 *     description: |
 *       `enabled` = StationProperty(KURSUN, AUTO) satırı. `values` gramaj listesinin TAMAMI (eksik kod pasife düşer,
 *       silinmez; tek varsayılan). Çeşit yoksa ilk eklemede doğar. `gramPrice` + `gramCurrency` birlikte (null = kaldır).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: stationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled: { type: boolean }
 *               values: { type: array, items: { type: object } }
 *               gramPrice: { type: string, nullable: true }
 *               gramCurrency: { type: string, nullable: true }
 *     responses:
 *       200: { description: Güncel kurşun ayarı }
 *       400: { description: Geçersiz gramaj/fiyat, iki varsayılan, KURSUN özelliği yok }
 */
router.get(
  "/:stationId/kursun",
  verifyToken,
  requirePermission("station:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json({ success: true, data: await getKursunStation(req.params.stationId as string) });
    } catch (e) {
      next(e);
    }
  },
);

/** K14 geçmiş listesi sorgusu — yalnız cursor + limit (süzgeç yok). */
const priceHistoryQuery = z.object({ cursor: z.string().max(500).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).strict();

/**
 * @swagger
 * /api/station-capabilities/{stationId}/kursun/price-history:
 *   get:
 *     summary: İstasyonun kurşun gram fiyatı geçmişi (K14; en yeni önce, cursor)
 *     tags: [StationCapabilities]
 *     parameters:
 *       - { in: path, name: stationId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: cursor, schema: { type: string } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100 } }
 *     responses:
 *       200: { description: "{ items, nextCursor }" }
 *       400: { description: Geçersiz cursor/limit }
 *       404: { description: İstasyon yok }
 */
router.get(
  "/:stationId/kursun/price-history",
  verifyToken,
  requirePermission("station:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = priceHistoryQuery.parse(req.query);
      res.status(200).json({ success: true, data: await getKursunStationPriceHistory(req.params.stationId as string, q) });
    } catch (e) {
      next(e);
    }
  },
);

router.put(
  "/:stationId/kursun",
  verifyToken,
  requirePermission("station:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = kursunStationSchema.parse(req.body);
      res.status(200).json({ success: true, data: await setKursunStation(req.params.stationId as string, body, req.user?.userId) });
    } catch (e) {
      next(e);
    }
  },
);

export default router;
