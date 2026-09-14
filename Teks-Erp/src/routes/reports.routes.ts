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
import financeReportRoutes from "./reports/finance.report.routes";
import dokumaReportRoutes from "./reports/dokuma.report.routes";

const router = Router();

router.use("/production", productionReportRoutes);
router.use("/sales", salesReportRoutes);
router.use("/quality", qualityReportRoutes);
router.use("/inventory", inventoryReportRoutes);
router.use("/subcontract", subcontractReportRoutes);
router.use("/customer", customerReportRoutes);
router.use("/audit", auditReportRoutes);
// ⚠️ Ön muhasebe raporları (C4). Buradaki komşularından TEK farkı: kendi
// router'ında `requireFinanceEnabled` REJİM kapısını da taşır — fabrikada
// `finance.enabled` kapalı olduğu için bu üç uç orada 403 verir. Kapı burada
// değil o dosyada durur; buraya taşınırsa diğer yedi rapor da rejime bağlanır.
router.use("/finance", financeReportRoutes);
// Dokuma raporları (Dilim 4, 2026-09-14): aynı kalıp — `requireDokumaEnabled` kendi dosyasında.
router.use("/dokuma", dokumaReportRoutes);

export default router;
