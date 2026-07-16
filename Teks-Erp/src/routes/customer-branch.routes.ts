// =============================================================================
// TeksERP - Customer Branch Routes
// =============================================================================
// Mount: /api/customers/:customerId/branches
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { CustomerBranchService } from "../services/customer-branch.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";

const service = new CustomerBranchService();

// Uzunluk sınırları DB kolonlarıyla birebir: name VARCHAR(100) / code VARCHAR(50)
// (aşan girdi P2000 → jenerik 400 yerine alan-adlı zod hatası alsın).
const createSchema = z.object({
  code: z.string().max(50).optional().nullable(),
  name: z.string().min(1, "Şube adı zorunludur").max(100),
  address: z.string().max(500).optional().nullable(),
  city: z.string().max(80).optional().nullable(),
  district: z.string().max(80).optional().nullable(),
  contactName: z.string().max(120).optional().nullable(),
  contactPhone: z.string().max(40).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

const router = Router({ mergeParams: true });

/**
 * @openapi
 * /api/customers/{customerId}/branches:
 *   get:
 *     tags: [Customer Branches]
 *     summary: Müşterinin şube listesi
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: includeInactive
 *         schema: { type: boolean }
 *     responses:
 *       200: { description: Şube listesi }
 */
router.get(
  "/",
  verifyToken,
  requireAnyPermission("customer:read", "mobile:tarti-paket", "mobile:sevkiyat", "mobile:fason-sevk", "mobile:fason-kabul"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = req.params.customerId as string;
      const includeInactive = req.query.includeInactive === "true";
      const result = await service.findByCustomer(customerId, { includeInactive });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/customers/{customerId}/branches:
 *   post:
 *     tags: [Customer Branches]
 *     summary: Yeni şube ekle
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/",
  verifyToken,
  requirePermission("customer:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = req.params.customerId as string;
      const body = createSchema.parse(req.body);
      const result = await service.create(customerId, body, req.user?.userId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/customers/{customerId}/branches/{branchId}:
 *   patch:
 *     tags: [Customer Branches]
 *     summary: Şube güncelle
 *     security: [{ bearerAuth: [] }]
 */
router.patch(
  "/:branchId",
  verifyToken,
  requirePermission("customer:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = updateSchema.parse(req.body);
      const result = await service.update(
        req.params.customerId as string, // F204: müşteri-kapsamlı guard
        req.params.branchId as string,
        body,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/customers/{customerId}/branches/{branchId}:
 *   delete:
 *     tags: [Customer Branches]
 *     summary: Şubeyi pasife al (soft delete)
 *     security: [{ bearerAuth: [] }]
 */
router.delete(
  "/:branchId",
  verifyToken,
  requirePermission("customer:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await service.deactivate(
        req.params.customerId as string, // F204: müşteri-kapsamlı guard
        req.params.branchId as string,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
