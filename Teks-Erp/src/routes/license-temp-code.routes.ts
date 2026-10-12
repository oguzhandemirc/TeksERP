// =============================================================================
// TeksERP — Yazarak etkinleştirme uçları (`/api/license/gecici-kod/*`)
// =============================================================================
// `license.routes.ts` bunu `verifyToken`dan SONRA bağlar; kilitte de açıktır (`/api/license/*`). İstek kodu ekranda
// okunur, telefonla satıcıya söylenir; satıcının verdiği 115 karakterlik kod buraya yazılır.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { requirePermission } from "../middlewares/rbac.middleware";
import { acceptTempCode, getTempRequest, renewTempRequestCode } from "../services/license-temp-code.service";

const router = Router();
const canManage = requirePermission("license:manage");

// Tire/boşluklu yazım serbest (115 karakter + 23 tire + ön ek); biçim denetimi kod çözücüde.
const TempCodeBody = z.object({ kod: z.string().trim().min(1).max(200) });

/**
 * @openapi
 * /api/license/gecici-kod/istek:
 *   get:
 *     tags: [Lisans]
 *     summary: Yazarak etkinleştirme istek kodu (TI-…; tüketilene/yenilenene dek aynı)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ istekKodu, olusturuldu, gecici: { bitis, kalanGun, kodSonu } | null }" }
 *       409: { description: Kurulum zaten etkin (LICENSE_ALREADY_ACTIVE) / lisans deposu kullanılamıyor }
 */
router.get("/istek", canManage, (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({ success: true, data: getTempRequest() });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/license/gecici-kod/istek/yenile:
 *   post:
 *     tags: [Lisans]
 *     summary: İstek kodunu yenile (eski isteğe verilen kod artık geçmez)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Yeni istek kodu }
 *       409: { description: Kurulum zaten etkin / lisans deposu kullanılamıyor }
 */
router.post("/istek/yenile", canManage, (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({ success: true, data: renewTempRequestCode(req.user?.userId ?? null) });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/license/gecici-kod:
 *   post:
 *     tags: [Lisans]
 *     summary: Geçici açılış kodunu gir (TG-…, 23 × 5; kök imzalı, tek kullanımlık)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [kod], properties: { kod: { type: string } } }
 *     responses:
 *       200: { description: "Kurulum geçici etkin — { istekKodu (yenilendi), gecici: { bitis, kalanGun, kodSonu } }" }
 *       400: { description: "TEMP_CODE_INVALID — details.neden: BICIM · KARAKTER (konum) · SAGLAMA · SURUM · IMZACI · IMZA · SURESI_GECMIS · TEKRAR" }
 *       409: { description: Kurulum zaten etkin / lisans deposu kullanılamıyor }
 */
router.post("/", canManage, (req: Request, res: Response, next: NextFunction) => {
  try {
    const { kod } = TempCodeBody.parse(req.body);
    res.status(200).json({ success: true, data: acceptTempCode(kod, req.user?.userId ?? null) });
  } catch (err) {
    next(err);
  }
});

export default router;
