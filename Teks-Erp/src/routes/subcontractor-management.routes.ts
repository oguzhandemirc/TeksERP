// =============================================================================
// TeksERP - Subcontractor Management Routes
// =============================================================================
// Subcontractor (Fason firma) ve SubcontractorCategory CRUD endpoint'leri.

import { Router } from "express";
import {
  SubcontractorManagementController,
  SubcontractorCategoryController,
} from "../controllers/subcontractor-management.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

// ─── /api/subcontractors ────────────────────────────────────────────────────
const subcontractorRouter = Router();
const subCtrl = new SubcontractorManagementController();

/**
 * @openapi
 * /api/subcontractors:
 *   get:
 *     tags: [Subcontractor]
 *     summary: Fason firma listesi (categoryId filter desteklenir)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: filter[categoryId]
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: filter[isActive]
 *         schema: { type: string }
 *     responses:
 *       200: { description: Liste }
 */
subcontractorRouter.get("/", verifyToken, requirePermission("subcontractor:read"), subCtrl.findAll);
subcontractorRouter.get("/:id", verifyToken, requirePermission("subcontractor:read"), subCtrl.findById);
subcontractorRouter.post("/", verifyToken, requirePermission("subcontractor:write"), subCtrl.create);
subcontractorRouter.patch("/:id", verifyToken, requirePermission("subcontractor:write"), subCtrl.update);
subcontractorRouter.delete("/:id", verifyToken, requirePermission("subcontractor:write"), subCtrl.remove);

// ─── /api/subcontractor-categories ──────────────────────────────────────────
const categoryRouter = Router();
const catCtrl = new SubcontractorCategoryController();

categoryRouter.get("/", verifyToken, requirePermission("subcontractor:read"), catCtrl.findAll);
categoryRouter.get("/:id", verifyToken, requirePermission("subcontractor:read"), catCtrl.findById);
categoryRouter.post("/", verifyToken, requirePermission("subcontractor:write"), catCtrl.create);
categoryRouter.patch("/:id", verifyToken, requirePermission("subcontractor:write"), catCtrl.update);
categoryRouter.delete("/:id", verifyToken, requirePermission("subcontractor:write"), catCtrl.remove);

export { subcontractorRouter, categoryRouter as subcontractorCategoryRouter };
