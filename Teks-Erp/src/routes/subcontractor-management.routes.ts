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
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";

const MOBILE_FASON_READ = ["mobile:fason-sevk", "mobile:fason-kabul"] as const;

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
subcontractorRouter.get("/", verifyToken, requireAnyPermission("subcontractor:read", ...MOBILE_FASON_READ, "mobile:hizli-is-emri"), subCtrl.findAll);
subcontractorRouter.get("/:id", verifyToken, requireAnyPermission("subcontractor:read", ...MOBILE_FASON_READ, "mobile:hizli-is-emri"), subCtrl.findById);
subcontractorRouter.post("/", verifyToken, requirePermission("subcontractor:write"), subCtrl.create);
subcontractorRouter.patch("/:id", verifyToken, requirePermission("subcontractor:write"), subCtrl.update);
subcontractorRouter.delete("/:id", verifyToken, requirePermission("subcontractor:write"), subCtrl.remove);

// ─── /api/subcontractor-categories ──────────────────────────────────────────
const categoryRouter = Router();
const catCtrl = new SubcontractorCategoryController();

categoryRouter.get("/", verifyToken, requireAnyPermission("subcontractor:read", ...MOBILE_FASON_READ), catCtrl.findAll);
categoryRouter.get("/:id", verifyToken, requireAnyPermission("subcontractor:read", ...MOBILE_FASON_READ), catCtrl.findById);
categoryRouter.post("/", verifyToken, requirePermission("subcontractor:write"), catCtrl.create);
categoryRouter.patch("/:id", verifyToken, requirePermission("subcontractor:write"), catCtrl.update);
categoryRouter.delete("/:id", verifyToken, requirePermission("subcontractor:write"), catCtrl.remove);

export { subcontractorRouter, categoryRouter as subcontractorCategoryRouter };
