// =============================================================================
// TeksERP - Patron push cihazı (`/api/bildirim/cihaz`, push köprüsü P2)
// =============================================================================
// Patron telefonu Expo belirtecini kaydeder/bırakır. Toplu kapı kimlik + `patron-app:login`; patron oturumu ve
// kapı (`bildirim.patronPushEnabled` ∧ `bildirim.gelenKutusuEnabled`, yalnız kayıtta) serviste. Belirteç biçimi
// tel aynasının deseninden (tek kaynak). Yanıt ham belirteci ya da özetini TAŞIMAZ. Bulut eşlemesi iş turunda.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { PATRON_LOGIN_PERMISSION } from "../constants/permission-catalog";
import { PushSoundSchema, PushTokenSchema } from "../cloud-sync/wire";
import { AppError } from "../utils/app-error";
import { registerPatronPushDevice, releasePatronPushDevice, type PushCaller } from "../services/patron-push/device.service";

const router = Router();
// ⚠️ Toplu kapı: bu satırdan ÖNCE tanımlanan uç kapısız kalır (Express kayıt sırası).
router.use(verifyToken, requirePermission(PATRON_LOGIN_PERMISSION));

const tokenField = PushTokenSchema.describe("Expo belirteci");
const registerSchema = z.strictObject({
  belirtec: z.string({ error: "belirtec zorunlu" }).pipe(tokenField),
  platform: z.enum(["android", "ios"], { error: "platform android ya da ios olmalı" }),
  cihazAdi: z.string().trim().max(80, "cihazAdi en çok 80 karakter").optional(),
  // S0: telefonun seçtiği ses; eski uygulama göndermez → varsayılan zil/alarm (serviste).
  sesBildirim: PushSoundSchema.optional(),
  sesAlarm: PushSoundSchema.optional(),
});
const releaseSchema = z.strictObject({ belirtec: z.string({ error: "belirtec zorunlu" }).pipe(tokenField) });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  // Hata iletisi değeri yansıtmaz: belirteç biçimsizse bile metni yanıta/log'a düşmesin.
  if (!r.success) {
    const issue = r.error.issues[0];
    const field = issue?.path[0];
    const message = field === "belirtec" ? "belirtec geçerli bir Expo push belirteci değil" : issue?.message ?? "İstek geçersiz";
    throw AppError.badRequest(message, { code: "PATRON_PUSH_GOVDE" });
  }
  return r.data;
}

const callerOf = (req: Request): PushCaller => ({ userId: req.user!.userId, jti: req.user!.jti });

/**
 * @openapi
 * /api/bildirim/cihaz:
 *   post:
 *     tags: [Bildirim]
 *     summary: Patron telefonunun push belirtecini kaydet (idempotent)
 *     description: Yalnız patron uygulaması oturumu, yalnız kendi adına. Aynı belirteç tek kayıt; başka kullanıcıdaysa bu kullanıcıya geçer. Kullanıcı başına 10 cihaz, aşan en eski bırakılır. Buluta bağlama arka planda yapılır.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [belirtec, platform]
 *             properties:
 *               belirtec: { type: string, example: "ExponentPushToken[xxxxxxxx]" }
 *               platform: { type: string, enum: [android, ios] }
 *               cihazAdi: { type: string, maxLength: 80 }
 *               sesBildirim: { type: string, enum: [tekserp_zil, tekserp_alarm, tekserp_mekik, tekserp_dokuma, tekserp_kisa, varsayilan, sessiz], description: "Yoksa tekserp_zil" }
 *               sesAlarm: { type: string, enum: [tekserp_zil, tekserp_alarm, tekserp_mekik, tekserp_dokuma, tekserp_kisa, varsayilan, sessiz], description: "Yoksa tekserp_alarm" }
 *     responses:
 *       200: { description: "{ kayitli: true, durum: BEKLIYOR | KAYITLI, birakilanEski }" }
 *       400: { description: Gövde geçersiz (PATRON_PUSH_GOVDE) }
 *       403: { description: patron-app:login yok ya da patron oturumu değil (PATRON_ISTEMCI_DEGIL) }
 *       409: { description: Push ya da gelen kutusu bayrağı kapalı (PATRON_PUSH_KAPALI) ya da eşzamanlı değişiklik (PATRON_PUSH_CAKISMA) }
 *       503: { description: Anahtar halkası yok (PUSH_ANAHTAR_YOK) }
 *   delete:
 *     tags: [Bildirim]
 *     summary: Patron telefonunun push belirtecini bırak
 *     description: Yalnız kendi canlı belirtecini bırakır; başkasının ya da olmayan belirteç `birakildi:false`. Bayrak kapalıyken de çalışır.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [belirtec]
 *             properties:
 *               belirtec: { type: string }
 *     responses:
 *       200: { description: "{ birakildi: boolean }" }
 *       403: { description: patron oturumu değil (PATRON_ISTEMCI_DEGIL) }
 */
router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = parse(registerSchema, req.body);
    const data = await registerPatronPushDevice(
      { token: body.belirtec, platform: body.platform, deviceName: body.cihazAdi ? body.cihazAdi : null, soundNotification: body.sesBildirim, soundAlarm: body.sesAlarm },
      callerOf(req),
    );
    res.set("Cache-Control", "no-store").status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.delete("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = parse(releaseSchema, req.body);
    const data = await releasePatronPushDevice(body.belirtec, callerOf(req));
    res.set("Cache-Control", "no-store").status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

export default router;
