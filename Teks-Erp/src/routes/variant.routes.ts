// =============================================================================
// TeksERP - ItemVariant Routes
// =============================================================================
// Routes are relative to /api/items mount point
// Full paths: POST/GET /api/items/:itemId/variants, DELETE /api/items/:itemId/variants/:variantId
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { VariantService } from "../services/variant.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const variantService = new VariantService();

const createSchema = z.object({
  code: z.string().min(1, "Varyant kodu zorunludur"),
  name: z.string().min(1, "Varyant adı zorunludur"),
});

const variantRouter = Router({ mergeParams: true }); // mergeParams to access :itemId from parent

// POST /api/items/:itemId/variants - Create a variant for an item
variantRouter.post(
  "/",
  verifyToken,
  requirePermission("item:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createSchema.parse(req.body);
      const itemId = req.params.itemId as string;
      const result = await variantService.create({ ...body, itemId }, req.user?.userId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/items/:itemId/variants - Get variants for an item
variantRouter.get(
  "/",
  verifyToken,
  requirePermission("item:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await variantService.findByItemId(req.params.itemId as string);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/items/:itemId/variants/:variantId - Delete a variant
variantRouter.delete(
  "/:variantId",
  verifyToken,
  requirePermission("item:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await variantService.delete(req.params.variantId as string, req.user?.userId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default variantRouter;
