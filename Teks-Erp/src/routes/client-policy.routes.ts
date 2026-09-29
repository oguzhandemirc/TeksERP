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
// `minVersion` KODDA sabittir (src/config/client-version-policy.ts) — gerekçe orada;
// `currentVersion` kira varsa kanalın güncel sürümüdür (src/lib/client-policy-lease.ts).
// =============================================================================

import { Router, Request, Response } from "express";

import { effectiveClientPolicies, effectiveClientPolicy } from "../lib/client-policy-lease";
import { APP_VERSION } from "../lib/app-version";

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

/**
 * @openapi
 * /api/client-policy:
 *   get:
 *     tags: [Sistem]
 *     summary: Sunucunun sürüm künyesi — kendi sürümü + TÜM istemci beklentileri (PUBLIC)
 *     description: >
 *       "Ben şu API sürümüyüm ve şu istemcilerden şunları bekliyorum" cümlesini
 *       TEK istekte verir. Sürüm uyumu bir ilişkidir; iki ucu ayrı uçlarda
 *       durursa kimse bütünü görmez.
 *     responses:
 *       200:
 *         description: Künye
 */
router.get("/", (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: { apiVersion: APP_VERSION, clients: effectiveClientPolicies() },
  });
});

/**
 * @openapi
 * /api/client-policy/{istemci}:
 *   get:
 *     tags: [Sistem]
 *     summary: Tek istemcinin surum politikasi (PUBLIC)
 *     parameters:
 *       - in: path
 *         name: istemci
 *         required: true
 *         schema: { type: string, enum: [electron, mobil] }
 *     responses:
 *       200:
 *         description: Politika (yanit apiVersion de tasir)
 *       404:
 *         description: Bu istemci icin politika tanimli degil (istemci fail-open okur)
 */
router.get("/:istemci", (req: Request, res: Response) => {
  const policy = effectiveClientPolicy(String(req.params.istemci).toLowerCase());
  if (!policy) {
    res.status(404).json({ success: false, message: "Bu istemci için politika tanımlı değil" });
    return;
  }
  // `apiVersion` tekil yanıtta da var: istemci "hangi sunucuya bakıyorum"
  // sorusunu ikinci bir istek atmadan cevaplayabilsin.
  res.json({ success: true, data: { apiVersion: APP_VERSION, ...policy } });
});

export default router;
