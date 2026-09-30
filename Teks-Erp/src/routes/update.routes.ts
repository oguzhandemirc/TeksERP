// =============================================================================
// TeksERP — Güncelleme uçları (`/api/guncelleme/*`, Dağıtım v2 — docs/design/GUNCELLEYICI.md §3.2)
// =============================================================================
// Panelin "Sistem → Güncellemeler" ekranı (D7): kiradaki politika + güncelleyicinin durum/geçmişi.
// Salt okunur; onay yazan uç güncelleyicinin niyet dosyası (§5.1) ile bağlanır.
// =============================================================================
import { Router, type Request, type Response } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission } from "../middlewares/rbac.middleware";
import { getUpdateStatus } from "../services/update-status.service";

const router = Router();

router.use(verifyToken, requireAnyPermission("license:view", "license:manage"));

/**
 * @openapi
 * /api/guncelleme/durum:
 *   get:
 *     tags: [Lisans]
 *     summary: Backend güncelleme durumu (kurulu sürüm, kiradaki politika, güncelleyici, bekleyen sürüm, son deneme)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "UpdateStatus — { kuruluSurum, kanal, politika, donuk, sonrakiPencere, indirmeBelirteci, guncelleyici, bekleyen, son, yerel, gecmis }" }
 *       401: { description: Token geçersiz }
 *       403: { description: license:view ya da license:manage yok }
 */
router.get("/durum", (_req: Request, res: Response) => {
  res.status(200).json({ success: true, data: getUpdateStatus() });
});

export default router;
