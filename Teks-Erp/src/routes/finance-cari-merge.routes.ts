// =============================================================================
// CARİ BİRLEŞTİRME ROTALARI (D4-K3e) — `/api/finance/cari/...`
// =============================================================================
// ⚠️ KENDİ BAŞINA MOUNT EDİLMEZ: `finance.routes.ts` içinde `router.use("/cari", cariMergeRoutes)` ile bağlanır ve
// oradaki `verifyToken` + `requireFinanceEnabled` kapısını miras alır (`finance-cari-hold.routes` emsali).
// Üç uç da `finance:cari-merge` (SoD kümesi: yalnız Muhasebe/Süpervizör). Çekirdek `helpers/cari-merge.helper`.
// =============================================================================
import { Router, type Request } from "express";
import { z } from "zod";
import { requirePermission } from "../middlewares/rbac.middleware";
import { cariMergeService } from "../services/cari-merge.service";
import { AppError } from "../utils/app-error";

const router = Router();

const uuid = (v: unknown, label: string): string => {
  const r = z.uuid().safeParse(v);
  if (!r.success) throw AppError.badRequest(`Geçersiz ${label}.`);
  return r.data;
};

const actor = (req: Request): string => {
  const id = req.user?.userId;
  if (!id) throw AppError.unauthorized("Oturum gerekli.");
  return id;
};

const applySchema = z.strictObject({
  sourceId: z.uuid({ error: "Kaynak hesap geçerli bir kimlik olmalı" }),
  targetId: z.uuid({ error: "Hedef hesap geçerli bir kimlik olmalı" }),
  stamp: z.string({ error: "Ön izleme damgası zorunlu" }).regex(/^[0-9a-f]{32}$/, "Ön izleme damgası geçersiz — ön izlemeyi yenileyin"),
  clientToken: z.uuid({ error: "clientToken geçerli bir UUID olmalı" }),
});

/**
 * @openapi
 * /api/finance/cari/{id}/merge-candidates:
 *   get:
 *     tags: [Finance]
 *     summary: Bu hesapla birleştirilebilecek aynı kartın öbür hesapları (D4-K3e)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ data: [{ id, kind, label, isActive, sourceId, targetId, balances[] }] } — önerilen yön dahil" }
 *       403: { description: "finance:cari-merge yok" }
 *       404: { description: CARI_ACCOUNT_NOT_FOUND }
 */
router.get("/:id/merge-candidates", requirePermission("finance:cari-merge"), async (req, res, next) => {
  try {
    res.json(await cariMergeService.candidates(uuid(req.params.id, "cari")));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/cari/merge/preview:
 *   get:
 *     tags: [Finance]
 *     summary: Cari birleştirme ön izlemesi — aktarılacak HER açık kalem, döviz başına bakiye, engeller, sürüm damgası (D4-K3e)
 *     description: Yazmaz. Çekirdek `fix_cari_cift_hesap` betiğiyle aynı (`planCariMerge`).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: sourceId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: targetId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ data: { sourceLabel, targetLabel, blockers[], balances[], items[], termsToCopy, draftInvoices, alreadyMerged, stamp } }" }
 *       400: { description: doğrulama }
 *       404: { description: Cari hesap bulunamadı }
 */
router.get("/merge/preview", requirePermission("finance:cari-merge"), async (req, res, next) => {
  try {
    res.json(await cariMergeService.preview(uuid(req.query.sourceId, "kaynak hesap"), uuid(req.query.targetId, "hedef hesap")));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/cari/merge:
 *   post:
 *     tags: [Finance]
 *     summary: Cari birleştirmeyi uygula — ön izlemedeki damgayla (D4-K3e)
 *     description: >
 *       Damga değiştiyse 409 CARI_MERGE_STALE. Engel varsa 409 CARI_MERGE_BLOCKED + liste. Aynı clientToken → replay.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sourceId, targetId, stamp, clientToken]
 *             properties:
 *               sourceId: { type: string, format: uuid }
 *               targetId: { type: string, format: uuid }
 *               stamp: { type: string }
 *               clientToken: { type: string, format: uuid }
 *     responses:
 *       200: { description: "{ data: { alreadyMerged, transferGroupId, legs, movedDrafts } }" }
 *       409: { description: "CARI_MERGE_STALE · CARI_MERGE_BLOCKED · CARI_MERGE_CONFLICT · CARI_MERGE_REVERTED · CLIENT_TOKEN_COLLISION" }
 */
router.post("/merge", requirePermission("finance:cari-merge"), async (req, res, next) => {
  try {
    res.json(await cariMergeService.apply(applySchema.parse(req.body), actor(req)));
  } catch (e) {
    next(e);
  }
});

export default router;
