// =============================================================================
// KASA/BANKA DÖNEM KAPANIŞI ROTALARI (K-1)
// =============================================================================
// ⚠️ MOUNT — CARİ DÖNEM ROUTER'IYLA AYNI DESEN (app.ts, `/api/finance`ten ÖNCE):
//
//     app.use("/api/finance/cash-period-closes", cashPeriodRoutes);  // ÖNCE
//     app.use("/api/finance", financeRoutes);                        // sonra
//
// Yollar bu yüzden ÖN EKSİZ (`/`, `/status`, `/:id/verify`); JSDoc'taki
// `/api/finance/cash-period-closes` dışa çıkan URL olarak aynen doğrudur.
// Spesifik ön ekin gerekçesi `finance-period.routes.ts` başlığında ölçümle
// yazılı: genel ön eke bağlansaydı `requireFinanceEnabled` (bilinçli CACHE'SİZ)
// istek başına İKİ kez koşardı.
//
// ⚠️ İKİ KAPI, İKİ SORU: `requireFinanceEnabled` ("bu kurulum bu modülü
// kullanıyor mu") + `requirePermission` ("bu kişi bunu yapabilir mi").
//
// ⚠️ İZİNLER MEVCUT ÇİFT — YENİ İZİN YOK: okuma `finance:read`, kapat/aç
// `finance:close` (cari dönem kapanışıyla AYNI görev: geçmişi mühürlemek /
// mührü kırmak — aynı kişi, aynı yetki; ikinci bir kod her kurulumda elle
// atama adımı doğururdu).
// =============================================================================

import { Router } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireFinanceEnabled } from "../middlewares/finance.middleware";
import { cashPeriodCloseService } from "../services/cash-period-close.service";

const router = Router();

// Modül kapısı — bu router'daki HER uç için.
router.use(verifyToken, requireFinanceEnabled);

// Takvim günü ya da tam ISO an — ikisi de kabul; servis fabrika takvim gününe
// çevirir. "2025-12-31" ile "2025-12-31T23:59+03:00" AYNI döneme çözülür.
const isoDate = z.string().datetime({ offset: true }).or(z.string().date());

/** Kasa XOR banka — servis de doğrular; burada hata Zod katmanında yakalanır. */
const accountXor = (o: { cashBoxId?: string; bankAccountId?: string }): boolean =>
  Boolean(o.cashBoxId) !== Boolean(o.bankAccountId);
const XOR_MSG = "Kasa VEYA banka hesabı seçilmeli (ikisi birden değil).";

/**
 * @openapi
 * /api/finance/cash-period-closes:
 *   get:
 *     tags: [Finance]
 *     summary: Kasa/banka dönem kapanışları
 *     description: >
 *       Varsayılan olarak yalnız AKTİF kapanışlar döner. `includeReopened=true`
 *       yeniden açılmış kayıtları da getirir (denetim görünümü — satır
 *       silinmez, işaretlenir). `cashBoxId` / `bankAccountId` süzgeci
 *       opsiyoneldir; ikisi birden verilemez.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Sayfalanmış kapanış listesi }
 */
router.get("/", requirePermission("finance:read"), async (req, res, next) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const parsed = z
      .object({
        cashBoxId: z.string().uuid().optional(),
        bankAccountId: z.string().uuid().optional(),
        includeReopened: z.enum(["true", "false"]).optional(),
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(200).optional(),
      })
      .parse(q);
    const result = await cashPeriodCloseService.list({
      cashBoxId: parsed.cashBoxId,
      bankAccountId: parsed.bankAccountId,
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
 * /api/finance/cash-period-closes/status:
 *   get:
 *     tags: [Finance]
 *     summary: Bu kasa/banka hesabı nereye kadar kapalı
 *     description: >
 *       Kapanış YOKSA `closedThrough: null` döner — bu bir hata değildir,
 *       kapanış opsiyoneldir.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Aktif kapanış özeti }
 */
// ⚠️ `/status` ve `/preview` sabit yollardır; ileride `/:id` eklenirse
// ONLARDAN SONRA tanımlanmalı (`/rolls/stats` emsali).
router.get("/status", requirePermission("finance:read"), async (req, res, next) => {
  try {
    const p = z
      .object({ cashBoxId: z.string().uuid().optional(), bankAccountId: z.string().uuid().optional() })
      .refine(accountXor, { message: XOR_MSG })
      .parse(req.query);
    res.json(await cashPeriodCloseService.status(p));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/cash-period-closes/preview:
 *   get:
 *     tags: [Finance]
 *     summary: Kapanış önizlemesi (hiçbir şey yazmaz)
 *     description: >
 *       Mühürlenecek bakiye + ÜÇ yazarın (tahsilat/ödeme · kasa hareketi ·
 *       çek tahsil/ödeme) hareket sayısı. Kullanıcı hangi rakamı mühürlediğini
 *       ÖNCE görmelidir.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Fotoğraf önizlemesi }
 */
router.get("/preview", requirePermission("finance:read"), async (req, res, next) => {
  try {
    const p = z
      .object({
        cashBoxId: z.string().uuid().optional(),
        bankAccountId: z.string().uuid().optional(),
        periodEnd: isoDate,
      })
      .refine(accountXor, { message: XOR_MSG })
      .parse(req.query);
    res.json(
      await cashPeriodCloseService.preview({
        cashBoxId: p.cashBoxId,
        bankAccountId: p.bankAccountId,
        periodEnd: new Date(p.periodEnd),
      }),
    );
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/cash-period-closes/{id}/verify:
 *   get:
 *     tags: [Finance]
 *     summary: Kapanışı bugünkü defterden yeniden türet ve karşılaştır
 *     description: >
 *       Drift ALARMDIR, düzeltilmez (salt okuma). Bilinen kaynakları: guard'ı
 *       atlayan yazar, elle DB yazımı, ya da kapalı dönemdeki bir hareketin
 *       iptali (kasa defteri append-only değildir — iptal geriye dönük düşürür).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Saklanan ↔ türetilen karşılaştırması }
 */
router.get("/:id/verify", requirePermission("finance:read"), async (req, res, next) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    res.json(await cashPeriodCloseService.verify(id));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/cash-period-closes:
 *   post:
 *     tags: [Finance]
 *     summary: Kasa/banka dönemini kapat (mühürle)
 *     description: >
 *       Kapanış deftere satır YAZMAZ — bir fotoğraftır. Kapandıktan sonra bu
 *       hesaba o tarihe (ve öncesine) düşen her hareket 409 alır.
 *       Gelecek dönem kapatılamaz; kapanışlar sıralı ilerler.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Dönem kapatıldı }
 *       400: { description: Gelecek dönem / hesap seçimi hatalı }
 *       409: { description: Zaten kapalı / daha ileri kapanış var }
 */
router.post("/", requirePermission("finance:close"), async (req, res, next) => {
  try {
    const b = z
      .object({
        cashBoxId: z.string().uuid().optional(),
        bankAccountId: z.string().uuid().optional(),
        periodEnd: isoDate,
        notes: z.string().max(500).nullable().optional(),
      })
      .strict()
      .refine(accountXor, { message: XOR_MSG })
      .parse(req.body);
    res.status(201).json(
      await cashPeriodCloseService.close(
        {
          cashBoxId: b.cashBoxId,
          bankAccountId: b.bankAccountId,
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
 * /api/finance/cash-period-closes/{id}/reopen:
 *   post:
 *     tags: [Finance]
 *     summary: Dönemi yeniden aç (iz bırakır)
 *     description: >
 *       Kapanış satırı SİLİNMEZ, `reopenedAt` ile işaretlenir. LIFO: daha yeni
 *       bir aktif kapanış varken eski dönem açılamaz.
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
    res.json(await cashPeriodCloseService.reopen(id, b.reason, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

export default router;
