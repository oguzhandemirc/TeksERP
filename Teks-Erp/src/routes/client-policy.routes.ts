// =============================================================================
// TeksERP — İstemci sürüm politikası ucu
// =============================================================================
// GET /api/client-policy/:istemci  → { minVersion, currentVersion, message? }
// Bugün tanımlı tek istemci: `electron`. Yeni istemci eklemek route'a değil
// `CLIENT_VERSION_POLICIES` kayıt defterine bir satır yazmaktır.
//
// ⚠️ PUBLIC (JWT yok) ve bu BİLİNÇLİ: panel politikayı giriş ekranından ÖNCE
// sorabilmeli. Kimlik aransaydı, "sözleşmesi bozulduğu için giriş yapamayan
// panele güncelle diyebilme" yolu — yani kurtarmanın kendisi — kapanırdı.
// Dönen veri zaten sırsızdır: iki sürüm numarası.
//
// Politika KODDA sabittir (src/config/client-version-policy.ts) — gerekçe orada.
// =============================================================================

import { Router, Request, Response } from "express";

import { CLIENT_VERSION_POLICIES } from "../config/client-version-policy";

const router = Router();

/**
 * @openapi
 * /api/client-policy/{istemci}:
 *   get:
 *     tags: [Sistem]
 *     summary: İstemcinin uyması gereken sürüm politikası (PUBLIC)
 *     parameters:
 *       - in: path
 *         name: istemci
 *         required: true
 *         schema: { type: string, enum: [electron] }
 *     description: >
 *       Panel kendi sürümünü `minVersion` ile kıyaslar; altındaysa kapatılamaz
 *       bir güncelleme kapısı gösterir. Yanıt okunamazsa panel KİLİTLENMEZ
 *       (fail-open) — bozuk bir yanıt sahadaki tüm panelleri durdurmamalıdır.
 *     responses:
 *       200:
 *         description: Politika
 *       404:
 *         description: Bu istemci için politika tanımlı değil (istemci fail-open okur)
 */
router.get("/:istemci", (req: Request, res: Response) => {
  const policy = CLIENT_VERSION_POLICIES[String(req.params.istemci).toLowerCase()];
  if (!policy) {
    res.status(404).json({ success: false, message: "Bu istemci için politika tanımlı değil" });
    return;
  }
  res.json({ success: true, data: policy });
});

export default router;
