// =============================================================================
// Servis keşfi — public kimlik ucu
// =============================================================================
// ⚠️ KİMLİK DOĞRULAMASI YOK ve olamaz: istemci bu ucu HENÜZ GİRİŞ YAPMAMIŞKEN,
// hatta hangi sunucuya bağlanacağını bilmeden çağırır. `/health` ile aynı gerekçe
// (app.ts'teki nota bak).
//
// ⚠️ Handler DB'ye DOKUNMAZ — `buildDiscoveryIdentity()` senkron ve bellekten
// okur. Buraya `await prisma...` eklemek, alt ağ taraması yapan her istemciye
// sunucuda sorgu açtırmak demektir (rate limiter yok) ve Postgres düştüğünde
// keşfi de düşürür. Bekçi bu dosyada `prisma.` geçmediğini MEKANİK doğrular.
// =============================================================================

import { Router, Request, Response } from "express";
import { buildDiscoveryIdentity } from "../services/discovery.service";
import { readForwardedView } from "../lib/forwarded-view";

const router = Router();

/**
 * @swagger
 * /api/discovery/identity:
 *   get:
 *     summary: Sunucu kimliği (servis keşfi)
 *     description: >
 *       Ağda bulunan sunucunun kendini tanıttığı kimliksiz uç. İstemci, keşfettiği
 *       adayın gerçekten beklediği kurulum olup olmadığını bununla anlar.
 *       Veritabanına dokunmaz.
 *     tags: [Discovery]
 *     security: []
 *     responses:
 *       200:
 *         description: Kimlik yükü
 */
// Güvenilen vekil (TRUST_PROXY) arkasında şema/port istemcinin gördüğüdür; vekil yoksa bugünkü değerler.
router.get("/identity", (req: Request, res: Response) => {
    res.status(200).json(buildDiscoveryIdentity(readForwardedView(req)));
});

export default router;
