// =============================================================================
// TeksERP — TEZGAH SALONU canlı ekran ucu (salt okuma)
// =============================================================================
// ⚠️ ÜÇ KAPI SIRAYLA: `verifyToken` → `requireTezgahEnabled` → `loom:live-view`. Modül
// `tezgahEnabled` (dokuma DEĞİL — DOKUMA-CANLI-EKRAN §8 karar 6); izin salt okumadır ve
// yazma izni taşımayan izleme/TV hesabına tek başına verilebilir. Yazma ucu YOK.
// =============================================================================
import { Router } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireTezgahEnabled } from "../middlewares/module.middleware";
import { getLoomFloor } from "../services/loom-floor.service";

const router = Router();
router.use(verifyToken, requireTezgahEnabled);
router.use(requirePermission("loom:live-view"));

/**
 * @openapi
 * /api/loom-floor:
 *   get:
 *     tags: [LoomFloor]
 *     summary: Tezgah Salonu — tezgah başına şu anki durum, açık duruşun süresi/hedefi, bugün % (süre payı) ve salon/hol özeti
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "Salon durumu (asOf · shift · graceMinutes · beamTracking · summary · halls · looms; looms[].beams yalnız devere + levent bağı defteri açıkken dizi, kapalıyken null)" }
 *       403: { description: Tezgah izleme modülü kapalı (MODULE_DISABLED) ya da loom:live-view yok }
 */
router.get("/", async (_req, res, next) => {
  try {
    res.json(await getLoomFloor());
  } catch (e) {
    next(e);
  }
});

export default router;
