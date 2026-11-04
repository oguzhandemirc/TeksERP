// =============================================================================
// Gelen belge CANLI OKUMA ucu (kamera açıkken kare okuma, L1) — `gelen-belge.routes.ts` içine `router.use` ile bağlanır:
// kimlik + modül kapısı (`gelenBelge` kapalı → 403 MODULE_DISABLED) + gövde katmanı üst router'dan miras.
// Salt okuma: hiçbir şey yazmaz; izin belge yükleme ile aynı (`gelen-belge:write`).
// =============================================================================
import { Router } from "express";
import { requirePermission } from "../middlewares/rbac.middleware";
import { liveReadFrame } from "../services/gelen-belge-canli-okuma.service";

const router = Router();

/**
 * @openapi
 * /api/gelen-belge/canli-okuma:
 *   post:
 *     tags: [Gelen belge]
 *     summary: "Canlı okuma karesi: tabletin ML Kit kelime listesi (clientOcr tel biçimi) → belge türü + başlık alanları. HİÇBİR ŞEY YAZMAZ (tarama/taslak/şablon isabeti/audit yok); tablo satırları dönmez"
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [engine, width, height, words]
 *             properties:
 *               engine: { type: string, enum: [mlkit] }
 *               width: { type: integer, minimum: 1, maximum: 10000 }
 *               height: { type: integer, minimum: 1, maximum: 10000 }
 *               rotation: { type: integer, enum: [0, 90, 180, 270] }
 *               ms: { type: number }
 *               words: { type: array, maxItems: 4000, items: { type: object, required: [t, c], properties: { t: { type: string }, c: { type: array }, l: { type: integer }, p: { type: number } } } }
 *               lines: { type: array, maxItems: 2000, items: { type: object, required: [c], properties: { c: { type: array }, p: { type: number } } } }
 *     responses:
 *       200: { description: "template {code,name,version}|null · score · fields[{key,label,value|null,needsReview,issues?,box?{x,y,w,h} (karenin piksel çerçevesi)}] (şablonun TÜM alanları) · engineMs" }
 *       400: { description: "LIVE_FRAME_INVALID (şema dışı / tavan aşımı)" }
 *       403: { description: "MODULE_DISABLED (gelen belge kapalı) · izin yok" }
 */
router.post("/canli-okuma", requirePermission("gelen-belge:write"), async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await liveReadFrame(req.body) });
  } catch (err) {
    next(err);
  }
});

export default router;
