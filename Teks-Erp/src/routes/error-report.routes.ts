// =============================================================================
// TeksERP — Hata raporları (`/api/hata-raporlari/*`, plan 3.6)
// =============================================================================
// Onay (varsayılan KAPALI) ayar şifreli yönetici kararıdır; panel/tablet hataları bu uçtan backend'e gelir ve
// backend'in tek kanalından (kurulum imzalı `POST /v1/hata-raporu`) gider. İstemci gövdesi KATIdır: mesaj metni,
// kullanıcı, sorgu taşıyan anahtar tanınmaz (400); kabul edilen alanlar da arındırıcıdan geçer.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { readClientVersionHeader } from "../constants/client-info";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireSettingsPassword } from "../middlewares/settings-password.middleware";
import { AppError } from "../utils/app-error";
import { errorReportConsentGiven, getErrorReportOverview, recordError, setErrorReportConsent } from "../services/error-report.service";

const router = Router();
router.use(verifyToken);

const ConsentBody = z.strictObject({ acik: z.boolean("Onay açık/kapalı (true/false) olmalı") });

/** İstemci hata kaydı — tanınmayan anahtar 400 (mesaj/gövde/kullanıcı alanı yoktur). */
export const ClientErrorBody = z.strictObject({
  kaynak: z.enum(["panel", "tablet"], "Kaynak panel ya da tablet olmalı"),
  surum: z.string().max(40).optional(),
  kod: z.string().max(60).optional(),
  sinif: z.string().max(60).optional(),
  bilesen: z.string().max(60).optional(),
  yol: z.string().max(400).optional(),
  yigin: z.string().max(16000).optional(),
});

/** Kullanıcı başına dakikada en çok bu kadar istemci kaydı (fazlası sessizce alınmaz). */
export const CLIENT_ERROR_PER_MINUTE = 30;
const RATE_WINDOW_MS = 60_000;
const RATE_USERS_MAX = 1000;
const rate = new Map<string, { windowStart: number; count: number }>();

function allowClientError(userKey: string, now: number): boolean {
  const cur = rate.get(userKey);
  if (!cur || now - cur.windowStart >= RATE_WINDOW_MS) {
    if (!cur && rate.size >= RATE_USERS_MAX) rate.clear();
    rate.set(userKey, { windowStart: now, count: 1 });
    return true;
  }
  if (cur.count >= CLIENT_ERROR_PER_MINUTE) return false;
  cur.count++;
  return true;
}

/** Bekçi düzeneği: hız sınırı durumunu sıfırlar. */
export function resetClientErrorRateForTest(): void {
  rate.clear();
}

/**
 * @openapi
 * /api/hata-raporlari:
 *   get:
 *     tags: [HataRaporlari]
 *     summary: Hata raporu onayı (kim/ne zaman) + kuyruk özeti ve son 100 grup (ne gidiyor, ne gitti)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "Onay durumu, bekleyen/gönderilen sayısı ve gruplar" }
 *       403: { description: İzin yok (admin:settings) }
 */
router.get("/", requirePermission("admin:settings"), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({ success: true, data: await getErrorReportOverview() });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/hata-raporlari/onay:
 *   put:
 *     tags: [HataRaporlari]
 *     summary: Hata raporlarının satıcıya gönderilmesine onay ver / geri al (ayar şifresi; geri alınca bekleyenler silinir)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [acik]
 *             properties:
 *               acik: { type: boolean }
 *     responses:
 *       200: { description: Güncel onay durumu }
 *       400: { description: Gövde geçersiz }
 *       403: { description: İzin yok / ayar şifresi gerekli }
 */
router.put("/onay", requirePermission("admin:settings"), requireSettingsPassword, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = ConsentBody.parse(req.body);
    const data = await setErrorReportConsent(body.acik, req.user?.userId);
    res.status(200).json({
      success: true,
      data,
      message: body.acik ? "Hata raporları açıldı: kişisel veri içermeyen hata özetleri satıcıya gönderilecek." : "Hata raporları kapatıldı: bekleyen raporlar silindi, hiçbir şey gönderilmeyecek.",
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/hata-raporlari/istemci:
 *   post:
 *     tags: [HataRaporlari]
 *     summary: Panel/tablet hata kaydı (onay yoksa alınmaz; mesaj metni kabul edilmez, yalnız tür/yer/sürüm)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [kaynak]
 *             properties:
 *               kaynak: { type: string, enum: [panel, tablet] }
 *               surum: { type: string, maxLength: 40, description: "yoksa X-Client-Version başlığı" }
 *               kod: { type: string, maxLength: 60 }
 *               sinif: { type: string, maxLength: 60 }
 *               bilesen: { type: string, maxLength: 60 }
 *               yol: { type: string, maxLength: 400 }
 *               yigin: { type: string, maxLength: 16000 }
 *     responses:
 *       200: { description: "alindi=false: onay yok ya da hız sınırı" }
 *       400: { description: Gövde geçersiz (tanınmayan alan dahil) }
 */
router.post("/istemci", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const b = ClientErrorBody.parse(req.body);
    const userKey = req.user?.userId;
    if (!userKey) throw AppError.unauthorized("Oturum gerekli");
    let alindi = false;
    if (errorReportConsentGiven() && allowClientError(userKey, Date.now())) {
      recordError({ source: b.kaynak, version: b.surum ?? readClientVersionHeader(req.headers), code: b.kod, errorClass: b.sinif, component: b.bilesen, route: b.yol ?? null, stack: b.yigin });
      alindi = true;
    }
    res.status(200).json({ success: true, data: { alindi } });
  } catch (err) {
    next(err);
  }
});

export default router;
