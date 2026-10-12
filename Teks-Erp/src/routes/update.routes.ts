// =============================================================================
// TeksERP — Güncelleme uçları (`/api/guncelleme/*`, Dağıtım v2 — docs/design/GUNCELLEYICI.md §3.2 · §5.1)
// =============================================================================
// Panelin "Sistem → Güncellemeler" ekranı: kiradaki politika + güncelleyicinin durum/geçmişi (okuma) ve panel
// onayı (yazma — güncelleyicinin niyet dosyasına giden TETİK; yetki kirada ve imzalı bildirimde). Ekranı herkes
// açar: izinsiz kullanıcı yalnız `/ozet`i (kurulu sürüm + durum, OPT-IN alanlar) okur.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";
import { AppError } from "../utils/app-error";
import { getUpdateStatus } from "../services/update-status.service";
import { updateSummaryOf } from "../services/update-summary";
import { RecordUpdateApprovalSchema, recordUpdateApproval } from "../services/update-approval.service";

const router = Router();

/**
 * @openapi
 * /api/guncelleme/ozet:
 *   get:
 *     tags: [Lisans]
 *     summary: Sunucu güncelleme özeti — oturumlu her panel kullanıcısı için (kurulu sürüm, durum, son sonuç; belirteç/politika/onaylayan yok)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "UpdateSummary — { kuruluSurum, donuk, guncelleyici{durum}, bekleyen{surum,karar,neden,zorunlu}, karar, yerel{durum,hataKodu,ilerleme}, son{sonuc,hedefSurum,bitis} }" }
 *       401: { description: Token geçersiz }
 */
// ⚠️ Bilerek `router.use`dan ÖNCE: izin kapısı bu ucu görmez (yalnız kimlik). Alan kümesi `updateSummaryOf`ta kilitli.
router.get("/ozet", verifyToken, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({ success: true, data: updateSummaryOf(await getUpdateStatus()) });
  } catch (err) {
    next(err);
  }
});

router.use(verifyToken, requireAnyPermission("license:view", "license:manage"));

/**
 * @openapi
 * /api/guncelleme/durum:
 *   get:
 *     tags: [Lisans]
 *     summary: Backend güncelleme durumu (kurulu sürüm, kiradaki politika, güncelleyici canlılığı, bekleyen sürüm, onay, son deneme, geçmiş)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "UpdateStatus — { kuruluSurum, kanal, grup, politika, donuk, sonrakiPencere, indirmeBelirteci, guncelleyici, bekleyen, son, yerel, gecmis, karar, canlilik, onay, eylemler }" }
 *       401: { description: Token geçersiz }
 *       403: { description: license:view ya da license:manage yok }
 */
router.get("/durum", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({ success: true, data: await getUpdateStatus() });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/guncelleme/onay:
 *   post:
 *     tags: [Lisans]
 *     summary: Backend güncellemesini onayla ("Şimdi kur" · "Bu gece kur") ya da onayı geri al (clientToken ile idempotent)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [clientToken, surum, zamanlama]
 *             properties:
 *               clientToken: { type: string, format: uuid }
 *               surum: { type: string, description: "güncelleyicinin doğruladığı aday (x.y.z[-ön])" }
 *               zamanlama: { type: string, enum: [HEMEN, PENCERE, GERI_AL] }
 *     responses:
 *       201: { description: "Karar kaydedildi — { kayitId, niyet: { yazildi, kod }, durum: UpdateStatus }" }
 *       400: { description: Geçersiz gövde (tanınmayan alan, biçimsiz sürüm ya da zamanlama) }
 *       403: { description: license:manage yok }
 *       409: { description: "Onay verilemez (UPDATE_APPROVAL_NOT_ALLOWED) · sürüm değişti (UPDATE_APPROVAL_VERSION_CHANGED) · işlem kimliği çakıştı (CLIENT_TOKEN_COLLISION)" }
 */
router.post("/onay", requirePermission("license:manage"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = RecordUpdateApprovalSchema.parse(req.body ?? {});
    const userId = req.user?.userId;
    if (!userId) throw AppError.unauthorized("Oturum gerekli.");
    res.status(201).json({ success: true, data: await recordUpdateApproval({ userId, input }) });
  } catch (err) {
    next(err);
  }
});

export default router;
