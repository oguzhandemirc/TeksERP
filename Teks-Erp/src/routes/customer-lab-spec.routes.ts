// =============================================================================
// TeksERP — Müşteri lab spesifikasyonları (`/api/customer-lab-specs/*`, K4P-SERT)
// =============================================================================
// Lab sonucunun karşılaştırma kaynağı (müşteri × ürün? × test türü → sınır). İzin lab izinleriyle
// aynı aile: okuma `labtest:read`, yazma `labtest:write`. Kapı satırı HER uçtan önce.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireKaliteGuvenceEnabled } from "../middlewares/module.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { createCustomerLabSpec, listCustomerLabSpecs, updateCustomerLabSpec } from "../services/customer-lab-spec.service";

const router = Router();
router.use(verifyToken, requireKaliteGuvenceEnabled);

type Handler = (req: Request) => Promise<{ status: number; data: unknown }>;
const wrap = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req);
    res.status(out.status).json({ success: true, data: out.data });
  } catch (err) {
    next(err);
  }
};
const Id = z.uuid("Geçersiz kimlik");
const Bound = z.number("Sınır sayı olmalı").finite().nullable().optional();

const ListQuery = z.object({
  customerId: Id.optional(),
  itemId: Id.optional(),
  testTypeId: Id.optional(),
  includeInactive: z.enum(["0", "1"]).optional(),
});
const CreateBody = z.strictObject({
  customerId: Id, itemId: Id.nullable().optional(), testTypeId: Id,
  specMin: Bound, specMax: Bound, note: z.string().max(500).nullable().optional(),
});
const UpdateBody = z.strictObject({ specMin: Bound, specMax: Bound, note: z.string().max(500).nullable().optional(), isActive: z.boolean().optional() });

/**
 * @openapi
 * /api/customer-lab-specs:
 *   get:
 *     tags: [Kalite]
 *     summary: Müşteri lab spesifikasyonları (varsayılan yalnız etkin)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste }
 *   post:
 *     tags: [Kalite]
 *     summary: Spesifikasyon ekle (aktif müşteri+ürün+tür tekil; 409 CUSTOMER_SPEC_DUPLICATE)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Spesifikasyon }
 * /api/customer-lab-specs/{id}:
 *   put:
 *     tags: [Kalite]
 *     summary: Sınır/not/etkinlik düzenle
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Spesifikasyon }
 */
router.get("/", requirePermission("labtest:read"), wrap(async (req) => {
  const q = ListQuery.parse(req.query);
  return { status: 200, data: await listCustomerLabSpecs({ ...q, includeInactive: q.includeInactive === "1" }) };
}));
router.post("/", requirePermission("labtest:write"), wrap(async (req) => ({ status: 201, data: await createCustomerLabSpec(CreateBody.parse(req.body), req.user!.userId) })));
router.put("/:id", requirePermission("labtest:write"), wrap(async (req) => ({ status: 200, data: await updateCustomerLabSpec(Id.parse(req.params.id), UpdateBody.parse(req.body), req.user!.userId) })));

export default router;
