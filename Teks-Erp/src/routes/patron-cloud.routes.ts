// =============================================================================
// TeksERP — Patron bulutu fabrika yüzeyi (`/api/patron-bulut/*`)
// =============================================================================
// Üç uç, hepsi `admin:users` (teknik kullanıcı bir HESAPTIR; bulut hesapları listesi hesap yönetimidir):
//   · GET  /                  durum: teknik kullanıcı, ön koşul (fail-closed), bulut hesapları (salt okunur), son tur
//   · POST /etkinlestir        teknik kullanıcıyı normal kullanıcı servisinden audit'li doğurur (idempotent)
//   · POST /hesap/:id/kilitle  bulut hesabını kilitler — buluta imzalı istek, bulut tek yazar (B6)
// Lisans kapısı app düzeyinde: POST bir YAZMADIR (kısıtlı kipte kapalı), GET okumadır.
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireSettingsPassword } from "../middlewares/settings-password.middleware";
import { activatePatronCloud, getPatronCloudStatus, lockCloudAccount } from "../services/patron-cloud.service";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";

const router = Router();
// Toplu kapı (BE-30): iki uç da hesap yönetimidir.
router.use(verifyToken, requirePermission("admin:users"));

/**
 * @openapi
 * /api/patron-bulut:
 *   get:
 *     tags: [PatronBulutu]
 *     summary: Patron bulutu durumu — teknik kullanıcı, ön koşul, bulut hesapları (salt okunur), son gelen kutusu turu
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Durum özeti (sır taşımaz) }
 *       403: { description: admin:users izni yok }
 */
router.get("/", async (_req, res, next) => {
  try {
    res.json({ success: true, data: await getPatronCloudStatus() });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/patron-bulut/etkinlestir:
 *   post:
 *     tags: [PatronBulutu]
 *     summary: Patron bulutunu etkinleştir — teknik kullanıcıyı (giriş yöntemi yok; yalnız order:write + customer:write) doğurur
 *     description: İdempotent. Pasif teknik kullanıcı yeniden aktifleştirilir, eksik izinler tamamlanır. Ayar şifresi tanımlıysa ister.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Teknik kullanıcı hazır }
 *       403: { description: İzin yok / ayar şifresi gerekli }
 *       409: { description: "PATRON_BULUT_KULLANICI_ADI_DOLU — aynı adda başka hesap var" }
 */
router.post("/etkinlestir", requireSettingsPassword, async (req, res, next) => {
  try {
    const r = await activatePatronCloud(req.user?.userId);
    res.json({
      success: true,
      data: { ...r, durum: await getPatronCloudStatus() },
      message: r.created ? "Patron bulutu etkinleştirildi: teknik kullanıcı oluşturuldu." : "Patron bulutu zaten etkin; teknik kullanıcı ve izinleri doğrulandı.",
    });
  } catch (e) {
    next(e);
  }
});

const lockSchema = z.object({ islemKimligi: z.string().uuid("İşlem kimliği geçersiz") });

/**
 * @openapi
 * /api/patron-bulut/hesap/{id}/kilitle:
 *   post:
 *     tags: [PatronBulutu]
 *     summary: Bulut hesabını kilitle — buluta kurulum imzalı istek; yalnız AKTIF hesap, oturumları kapanır
 *     description: İdempotent (`islemKimligi` mantıksal deneme başına bir kez üretilir; ağ/5xx belirsizliğinde aynı kimlikle tekrar). Ayar şifresi tanımlıysa ister.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [islemKimligi], properties: { islemKimligi: { type: string, format: uuid } } }
 *     responses:
 *       200: { description: Hesap KILITLI (zaten kilitliyse değişmeden) }
 *       403: { description: İzin yok / ayar şifresi gerekli }
 *       404: { description: "BULUNAMADI — hesap bu tesiste yok" }
 *       409: { description: "PATRON_BULUT_KAPALI · SON_YONETICI · DURUM_CAKISMASI · ISLEM_KIMLIGI_CAKISTI" }
 *       503: { description: "BULUT_ULASILAMADI — aynı işlem kimliğiyle tekrar deneyin" }
 */
router.post("/hesap/:id/kilitle", requireSettingsPassword, async (req, res, next) => {
  try {
    const hesapId = assertValidUuid(req.params.id);
    const body = lockSchema.parse(req.body);
    const hesap = await lockCloudAccount({ hesapId, islemKimligi: body.islemKimligi, actorUserId: req.user?.userId });
    res.json({ success: true, data: hesap, message: `Bulut hesabı kilitlendi: ${hesap.ad}` });
  } catch (e) {
    next(e);
  }
});

export default router;
