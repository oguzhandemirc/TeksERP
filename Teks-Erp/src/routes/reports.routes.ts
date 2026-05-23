// =============================================================================
// TeksERP - Reports Routes (root)
// =============================================================================
// /api/reports/* kökü. Domain alt-router'lar (production, sales, quality,
// inventory, subcontract, customer, audit) her etap eklenir; her birinin kendi
// permission'ı vardır (report:<domain>). Bu kök sadece mount eder, endpoint
// tanımlamaz.
// =============================================================================

import { Router } from "express";
import productionReportRoutes from "./reports/production.routes";
import salesReportRoutes from "./reports/sales.routes";
import qualityReportRoutes from "./reports/quality.routes";
import inventoryReportRoutes from "./reports/inventory.routes";
import subcontractReportRoutes from "./reports/subcontract.routes";
import customerReportRoutes from "./reports/customer.routes";
import auditReportRoutes from "./reports/audit.routes";

const router = Router();

router.use("/production", productionReportRoutes);
router.use("/sales", salesReportRoutes);
router.use("/quality", qualityReportRoutes);
router.use("/inventory", inventoryReportRoutes);
router.use("/subcontract", subcontractReportRoutes);
router.use("/customer", customerReportRoutes);
router.use("/audit", auditReportRoutes);

export default router;
