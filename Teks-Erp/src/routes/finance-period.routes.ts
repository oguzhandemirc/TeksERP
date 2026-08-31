// =============================================================================
// DÖNEM KAPANIŞI ROTALARI (C3)
// =============================================================================
// ⚠️ MOUNT — ÇEK ROUTER'IYLA AYNI DESEN (app.ts, `/api/finance`ten ÖNCE):
//
//     app.use("/api/finance/period-closes", financePeriodRoutes);  // ÖNCE
//     app.use("/api/finance", financeRoutes);                      // sonra
//
// Bu yüzden aşağıdaki yollar ÖN EKSİZ yazılır (`/`, `/status`, `/:id/verify`);
// dışarıya çıkan URL değişmez, JSDoc'taki `/api/finance/period-closes` aynen
// doğrudur.
//
// ⚠️ İLK YAZIMDAKİ TALİMAT ("`/api/finance`e SONRA bağla, eşleşmeyen istek bir
// sonraki router'a düşer") ÖLÇÜMLE ÇÜRÜDÜ ve düzeltildi: Express eşleşme
// aramadan ÖNCE o router'ın `router.use(...)` middleware'lerini koşturur, yani
// `/api/finance/period-closes` isteği önce `finance.routes`a girer, ORADAKİ
// `verifyToken + requireFinanceEnabled` çifti koşar, hiçbir yol eşleşmez, çıkar
// ve BU dosyadaki aynı çift İKİNCİ KEZ koşar. `readFinanceEnabled()` bilinçli
// olarak CACHE'SİZ (acil kapatma anahtarı) → istek başına İKİ ayar okuması.
// Spesifik ön ek bunu yapısal olarak bitirir: istek `finance.routes`a hiç girmez.
//
// ⚠️ İKİ KAPI, İKİ SORU: `requireFinanceEnabled` ("bu kurulum bu modülü
// kullanıyor mu") + `requirePermission` ("bu kişi bunu yapabilir mi"). Bayrak
// kapısını atlayan tek bir uç, fabrikada modülü fiilen açık bırakır.
//
// ⚠️ YENİ İZİN `finance:close` — `finance:invoice` KAPSAMAZ ve kapsamamalı.
// Fatura onaylayan kişi her gün deftere işler; dönem kapatan kişi ise GEÇMİŞİ
// MÜHÜRLER (ve yeniden açan kişi mührü kırar). Görev ayrılığının aynı ailesi:
// `shipping:write` ↔ `shipping:undo-dispatch`.
// =============================================================================

import { Router } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireFinanceEnabled } from "../middlewares/finance.middleware";
import { periodCloseService } from "../services/period-close.service";

const router = Router();

// Modül kapısı — bu router'daki HER uç için.
router.use(verifyToken, requireFinanceEnabled);

const currencyEnum = z.enum(["TRY", "USD", "EUR", "GBP", "RUB"]);
// Takvim günü ya da tam ISO an — ikisi de kabul edilir; servis fabrika takvim
// gününe çevirir (`periodDayKey`). "2025-12-31" ile "2025-12-31T23:59+03:00"
// AYNI döneme çözülür.
const isoDate = z.string().datetime({ offset: true }).or(z.string().date());

/**
 * @openapi
 * /api/finance/period-closes:
 *   get:
 *     tags: [Finance]
 *     summary: Dönem kapanışları
 *     description: >
 *       Varsayılan olarak yalnız AKTİF kapanışlar döner. `includeReopened=true`
 *       yeniden açılmış kayıtları da getirir (denetim görünümü — satır silinmez,
 *       işaretlenir).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Sayfalanmış kapanış listesi }
 */
router.get("/", requirePermission("finance:read"), async (req, res, next) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const parsed = z
      .object({
        cariId: z.string().uuid().optional(),
        currency: currencyEnum.optional(),
        includeReopened: z.enum(["true", "false"]).optional(),
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(200).optional(),
      })
      .parse(q);
    const result = await periodCloseService.list({
      cariId: parsed.cariId,
      currency: parsed.currency,
      includeReopened: parsed.includeReopened === "true",
      page: parsed.page,
      pageSize: parsed.pageSize,
    });
    res.json({ success: true, ...result });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/period-closes/status:
 *   get:
 *     tags: [Finance]
 *     summary: Bu cari bu para biriminde nereye kadar kapalı
 *     description: >
 *       Kapanış YOKSA `closedThrough: null` döner — bu bir hata değildir,
 *       kapanış opsiyoneldir.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Aktif kapanış özeti }
 */
// ⚠️ `/status` ve `/preview` sabit yollardır; ileride `/period-closes/:id`
// eklenirse ONLARDAN SONRA tanımlanmalı (`/rolls/stats` emsali).
router.get("/status", requirePermission("finance:read"), async (req, res, next) => {
  try {
    const p = z.object({ cariId: z.string().uuid(), currency: currencyEnum }).parse(req.query);
    res.json(await periodCloseService.status(p));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/period-closes/preview:
 *   get:
 *     tags: [Finance]
 *     summary: Kapanış önizlemesi (hiçbir şey yazmaz)
 *     description: >
 *       Mühürlenecek bakiye + hareket sayısı. Kapanış geri alınabilir ama iz
 *       bırakır — kullanıcı hangi rakamı mühürlediğini ÖNCE görmelidir.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Fotoğraf önizlemesi }
 */
router.get("/preview", requirePermission("finance:read"), async (req, res, next) => {
  try {
    const p = z
      .object({ cariId: z.string().uuid(), currency: currencyEnum, periodEnd: isoDate })
      .parse(req.query);
    res.json(
      await periodCloseService.preview({
        cariId: p.cariId,
        currency: p.currency,
        periodEnd: new Date(p.periodEnd),
      }),
    );
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/period-closes/{id}/verify:
 *   get:
 *     tags: [Finance]
 *     summary: Kapanışı bugünkü defterden yeniden türet ve karşılaştır
 *     description: >
 *       `txnCount` şemaya bu iş için kondu. Drift varsa kapanıştan sonra
 *       geçmişe yazılmış demektir. SALT OKUMA — hiçbir şeyi düzeltmez;
 *       kapanmış resmi rakamı sessizce tazelemek bu modülün reddettiği tek şey.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Saklanan ↔ türetilen karşılaştırması }
 */
router.get("/:id/verify", requirePermission("finance:read"), async (req, res, next) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    res.json(await periodCloseService.verify(id));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/period-closes:
 *   post:
 *     tags: [Finance]
 *     summary: Dönemi kapat (mühürle)
 *     description: >
 *       Kapanış deftere satır YAZMAZ — bir fotoğraftır. Kapandıktan sonra o
 *       tarihe (ve öncesine) düşen her defter yazımı 409 alır.
 *       Gelecek dönem kapatılamaz; kapanışlar sıralı ilerler.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Dönem kapatıldı }
 *       400: { description: Gelecek dönem }
 *       409: { description: Zaten kapalı / daha ileri kapanış var }
 */
router.post("/", requirePermission("finance:close"), async (req, res, next) => {
  try {
    const b = z
      .object({
        cariId: z.string().uuid(),
        currency: currencyEnum,
        periodEnd: isoDate,
        notes: z.string().max(500).nullable().optional(),
      })
      .strict()
      .parse(req.body);
    res.status(201).json(
      await periodCloseService.close(
        {
          cariId: b.cariId,
          currency: b.currency,
          periodEnd: new Date(b.periodEnd),
          notes: b.notes ?? null,
        },
        req.user?.userId,
      ),
    );
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/period-closes/{id}/reopen:
 *   post:
 *     tags: [Finance]
 *     summary: Dönemi yeniden aç (iz bırakır)
 *     description: >
 *       Kapanış satırı SİLİNMEZ, `reopenedAt` ile işaretlenir — "bu dönem bir
 *       kez kapandı, sonra açıldı" izi denetimde tam olarak aranan şeydir.
 *       LIFO: daha yeni bir aktif kapanış varken eski dönem açılamaz.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Dönem yeniden açıldı }
 *       400: { description: Gerekçe eksik }
 *       409: { description: Zaten açılmış / önce daha yeni kapanışı aç }
 */
router.post("/:id/reopen", requirePermission("finance:close"), async (req, res, next) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ reason: z.string().min(3).max(300) }).strict().parse(req.body);
    res.json(await periodCloseService.reopen(id, b.reason, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

export default router;
