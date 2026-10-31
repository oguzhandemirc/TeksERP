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
import targetValueNeedReportRoutes from "./reports/hedef-deger.report.routes";
import qualityReportRoutes from "./reports/quality.routes";
import inventoryReportRoutes from "./reports/inventory.routes";
import subcontractReportRoutes from "./reports/subcontract.routes";
import customerReportRoutes from "./reports/customer.routes";
import auditReportRoutes from "./reports/audit.routes";
import financeReportRoutes from "./reports/finance.report.routes";
import dokumaReportRoutes from "./reports/dokuma.report.routes";
import maliyetReportRoutes from "./reports/maliyet.report.routes";
import coreSalesReportRoutes from "./reports/temel-satis.routes";
import coreProductionReportRoutes from "./reports/temel-uretim.routes";
import coreWeavingFinanceReportRoutes from "./reports/temel-dokuma-finans.routes";

const router = Router();

router.use("/production", productionReportRoutes);
router.use("/sales", salesReportRoutes);
// SY-F1: kuşak / hedef değer ihtiyacı (kendi dosyası; sales.routes boyut tavanında).
router.use("/sales", targetValueNeedReportRoutes);
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
// Maliyet raporları (MAL-7): `requireMaliyetEnabled` kendi dosyasında (aynı kalıp).
router.use("/maliyet", maliyetReportRoutes);
// Raporlar v2 temel satış raporları (R0-RAPA): ÖNEKSİZ mount — yollar dosyada tam (`/sales/termin`),
// katalog `kapiTasiyici.yol` beyanıyla bayt-eşit. `/sales` router'ında eşleşmeyen istek buraya düşer.
router.use(coreSalesReportRoutes);
// Raporlar v2 temel üretim/kalite/depo/fason raporları (R0-RAPB): ÖNEKSİZ mount — yollar dosyada tam
// (`/quality/kayip`), katalog `kapiTasiyici.yol` ile bayt-eşit; kimlik kapısı uç zincirinde (router.use YOK).
router.use(coreProductionReportRoutes);
// Raporlar v2 temel dokuma/alacak raporları (R0-RAPC): aynı kalıp; modül kapısı (dokuma/devere/finans) uç zincirinde.
router.use(coreWeavingFinanceReportRoutes);

export default router;
