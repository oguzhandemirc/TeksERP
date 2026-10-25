// =============================================================================
// /api/rapor-calistirmalari — rapor koşusu yönetimi (Raporlar v2, R1-SEMCEK)
// =============================================================================
// İptal KENDİ koşusunda; `report:publish` taşıyan başkasınınkini de durdurur (R1-KAYIT). İzinsiz
// kullanıcıya başkasının koşusu 404 döner (varlığı sızdırılmaz).
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission } from "../middlewares/rbac.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { REPORT_PERMISSION_CODES } from "../constants/permission-catalog";
import { loadAccessContext } from "../services/reports/semantik/izin";
import { cancelRun } from "../services/reports/semantik/calistirici";

const router = Router();

router.use(verifyToken, requireAnyPermission(...REPORT_PERMISSION_CODES));

/**
 * @openapi
 * /api/rapor-calistirmalari/{id}/iptal:
 *   post:
 *     tags: [Reports]
 *     summary: Süren rapor koşusunu iptal et (kendi koşusu; report:publish başkasınınkini)
 *     description: Durum CALISIYOR → IPTAL (atomik) ve sorgu `pg_cancel_backend` ile durdurulur; bitmiş koşu 409.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "İptal edildi" }
 *       404: { description: "Koşu yok ya da kullanıcının değil" }
 *       409: { description: "Koşu zaten bitmiş" }
 */
router.post("/:id/iptal", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = assertValidUuid(req.params.id);
    const ctx = await loadAccessContext(req.user!);
    res.status(200).json({ success: true, data: await cancelRun(id, ctx) });
  } catch (e) {
    next(e);
  }
});

export default router;
