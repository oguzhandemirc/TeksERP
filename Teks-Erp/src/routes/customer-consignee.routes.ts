// =============================================================================
// Alıcı kataloğu uçları (2026-11-10) — müşterimizin müşterisi; etikete basılan ad (tambur emanet top).
// =============================================================================
// İki mount: sahip kapsamlı `/api/customers/:id/consignees` (liste + ensure; tablet de kullanır →
// `mobile:tambur`) ve kayıt kapsamlı `/api/customer-consignees/:id/*` (panel yönetimi, `customer:write`).
// Yeni izin kodu yok. İş mantığı serviste; Zod burada.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import {
  activateConsignee, deactivateConsignee, ensureConsignee, listConsignees, renameConsignee, setConsigneeTemplate,
} from "../services/customer-consignee.service";
import { consigneeMergePreview, mergeConsignee } from "../services/customer-consignee-merge.service";

type Handler = (req: Request) => Promise<{ status: number; body: unknown }>;
const wrap = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req);
    res.status(out.status).json(out.body);
  } catch (err) {
    next(err);
  }
};
const idOf = (req: Request) => assertValidUuid(req.params.id, "id");
const ok = (data: unknown, message?: string) => ({ status: 200, body: { success: true, data, ...(message ? { message } : {}) } });

const nameBody = z.object({ name: z.string().max(200) });
const templateBody = z.object({ labelTemplateId: z.string().uuid().nullable() });
const mergeBody = z.object({ targetId: z.string().uuid() });

// ── Sahip kapsamlı: /api/customers/:id/consignees (mergeParams) ─────────────
export const customerConsigneeOwnerRouter = Router({ mergeParams: true });
customerConsigneeOwnerRouter.use(verifyToken);

/**
 * @openapi
 * /api/customers/{id}/consignees:
 *   get:
 *     tags: [Customers]
 *     summary: Müşterinin alıcıları (son kullanılan önce; search katlanmış ad; includeInactive)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "[{ id, name, isActive, labelTemplate, lastUsedAt, liveRollCount }]" }
 * /api/customers/{id}/consignees/ensure:
 *   post:
 *     tags: [Customers]
 *     summary: Alıcıyı adla bul ya da doğur (doğal anahtarla idempotent; pasif → yeniden aktif; mezar taşı → hedef)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ consignee, created, reactivated }" }
 *       400: { description: CONSIGNEE_NAME_INVALID }
 *       409: { description: CUSTOMER_MERGED · CONSIGNEE_CHANGED }
 */
customerConsigneeOwnerRouter.get(
  "/",
  requireAnyPermission("customer:read", "mobile:tambur"),
  wrap(async (req) => {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    return ok(await listConsignees(idOf(req), { search, includeInactive: req.query.includeInactive === "true" }));
  }),
);
customerConsigneeOwnerRouter.post(
  "/ensure",
  requireAnyPermission("customer:write", "mobile:tambur"),
  wrap(async (req) => ok(await ensureConsignee(idOf(req), nameBody.parse(req.body).name, req.user?.userId))),
);

// ── Kayıt kapsamlı: /api/customer-consignees/:id/* ──────────────────────────
const router = Router();
router.use(verifyToken, requirePermission("customer:write"));

/**
 * @openapi
 * /api/customer-consignees/{id}:
 *   patch:
 *     tags: [Customers]
 *     summary: Alıcıyı yeniden adlandır (ad çakışırsa 409 CONSIGNEE_NAME_TAKEN + conflictId; basılmış canlı toplar labelDirty)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Alıcı }
 *       409: { description: CONSIGNEE_NAME_TAKEN · CONSIGNEE_MERGED · CONSIGNEE_CHANGED }
 * /api/customer-consignees/{id}/deactivate:
 *   post:
 *     tags: [Customers]
 *     summary: Pasife al (canlı topu varsa 409 CONSIGNEE_IN_USE + toplar; çıkış birleştir)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Alıcı }
 *       409: { description: CONSIGNEE_IN_USE }
 * /api/customer-consignees/{id}/activate:
 *   post:
 *     tags: [Customers]
 *     summary: Aktifleştir
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Alıcı }
 * /api/customer-consignees/{id}/label-template:
 *   put:
 *     tags: [Customers]
 *     summary: Alıcıya bağlı etiket şablonu (null kaldırır; elle seçimden sonra, müşteri kuralından önce)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Alıcı }
 *       400: { description: TEMPLATE_NOT_FOUND }
 * /api/customer-consignees/{id}/merge-preview:
 *   get:
 *     tags: [Customers]
 *     summary: Birleştirme önizlemesi (hedefe dönecek canlı toplar tek tek; sevkliler sayıyla)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ source, target, rolls[], untouchedRollCount }" }
 *       400: { description: CONSIGNEE_OWNER_MISMATCH · CONSIGNEE_MERGE_SELF }
 * /api/customer-consignees/{id}/merge:
 *   post:
 *     tags: [Customers]
 *     summary: Alıcıyı hedefe birleştir (kaynak mezar taşı olur; canlı toplar hedefe döner)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ sourceId, targetId, movedRolls, dirtiedRolls }" }
 *       409: { description: CONSIGNEE_MERGED }
 */
router.patch("/:id", wrap(async (req) => ok(await renameConsignee(idOf(req), nameBody.parse(req.body).name, req.user?.userId), "Alıcı güncellendi")));
router.post("/:id/deactivate", wrap(async (req) => ok(await deactivateConsignee(idOf(req), req.user?.userId), "Alıcı pasife alındı")));
router.post("/:id/activate", wrap(async (req) => ok(await activateConsignee(idOf(req), req.user?.userId), "Alıcı aktifleştirildi")));
router.put(
  "/:id/label-template",
  wrap(async (req) => ok(await setConsigneeTemplate(idOf(req), templateBody.parse(req.body).labelTemplateId, req.user?.userId), "Etiket şablonu güncellendi")),
);
router.get(
  "/:id/merge-preview",
  wrap(async (req) => ok(await consigneeMergePreview(idOf(req), mergeBody.parse({ targetId: req.query.targetId }).targetId))),
);
router.post("/:id/merge", wrap(async (req) => ok(await mergeConsignee(idOf(req), mergeBody.parse(req.body).targetId, req.user?.userId), "Alıcılar birleştirildi")));

export default router;
