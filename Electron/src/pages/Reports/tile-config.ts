import {
  Activity,
  Building2,
  Calculator,
  Factory,
  ShieldCheck,
  Truck,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import type { HubTile } from "./_components/ReportHubGrid";
import { productionReportTiles } from "./Production/tile-config";
import { salesReportTiles } from "./Sales/tile-config";
import { qualityReportTiles } from "./Quality/tile-config";
import { inventoryReportTiles } from "./Inventory/tile-config";
import { subcontractReportTiles } from "./Subcontract/tile-config";
import { customerReportTiles } from "./Customer/tile-config";
import { auditReportTiles } from "./Audit/tile-config";
import { financeReportTiles } from "./Finance/tile-config";

export interface ReportTile {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  to: string;
  permission?: string;
  /**
   * Bu karo yalnız ilgili REJİM bayrağı AÇIKKEN çizilir (`nav-config.ts` deseni).
   *
   * ⚠️ İzin filtresi TEK BAŞINA YETMEZ: `ReportsHubPage` süzgeci `isAdmin ||`
   * ile kısa devre yapıyor, yani `report:finance` taşımayan bir ADMİN bile
   * karoyu görürdü — tıklayınca üç ucun üçü de `requireFinanceEnabled` ile 403
   * döner ve kullanıcı sebebi hiçbir yerde göremez. Bayrak GÖRÜNÜRLÜK,
   * izin KİŞİ kapısıdır; ikisi birbirinin yerine geçmez.
   */
  featureFlag?: "financeEnabled";
}

/**
 * URL pattern `/reports/<categoryKey>/...` → alt-rapor kartlarının listesi.
 * Sağ taraftaki SideRail bu map'ten current category'nin tile'larını okur.
 */
export const reportCategoryTiles: Record<string, HubTile[]> = {
  production: productionReportTiles,
  sales: salesReportTiles,
  quality: qualityReportTiles,
  inventory: inventoryReportTiles,
  subcontract: subcontractReportTiles,
  customer: customerReportTiles,
  audit: auditReportTiles,
  finance: financeReportTiles,
};

/** Kategori başlığı — rail'in tepesinde gösterilir. */
export const reportCategoryTitle: Record<string, string> = {
  production: "Üretim",
  sales: "Sipariş & Sevkiyat",
  quality: "Kalite",
  inventory: "Stok & Depo",
  subcontract: "Fason",
  customer: "Müşteri",
  audit: "Denetim",
  finance: "Ön Muhasebe",
};

export const reportTiles: ReportTile[] = [
  {
    key: "production",
    title: "Üretim",
    description: "İstasyon verimliliği, operatör/makine performansı, fire",
    icon: Factory,
    to: "/reports/production",
    permission: "report:production",
  },
  {
    key: "sales",
    title: "Sipariş & Sevkiyat",
    description: "Sipariş gerçekleşme, geç teslim, müşteri sevkiyatları",
    icon: Truck,
    to: "/reports/sales",
    permission: "report:sales",
  },
  {
    key: "quality",
    title: "Kalite",
    description: "Hata türü dağılımı, QC2 kararları, Kurşun oranı",
    icon: ShieldCheck,
    to: "/reports/quality",
    permission: "report:quality",
  },
  {
    key: "inventory",
    title: "Stok & Depo",
    description: "Rulo yaşlandırma, renk/desen dağılımı, hareketler",
    icon: Warehouse,
    to: "/reports/inventory",
    permission: "report:inventory",
  },
  {
    key: "subcontract",
    title: "Fason",
    description: "Fasoncu performansı, açık fason sevkleri",
    icon: Building2,
    to: "/reports/subcontract",
    permission: "report:subcontract",
  },
  {
    key: "customer",
    title: "Müşteri",
    description: "Müşteri sipariş profili, alias eşleştirmeleri",
    icon: Users,
    to: "/reports/customer",
    permission: "report:customer",
  },
  {
    key: "audit",
    title: "Denetim",
    description: "Denetim kaydı özetleri, kullanıcı aktivitesi",
    icon: Activity,
    to: "/reports/audit",
    permission: "report:audit",
  },
  // Paket C4 (2026-08-14) — ticaret rejimine ait; fabrikada `finance.enabled`
  // KAPALI olduğu için bu karo orada HİÇ çizilmez.
  {
    key: "finance",
    title: "Ön Muhasebe",
    description: "Cari yaşlandırma, kasa & banka defteri, cari ekstre",
    icon: Calculator,
    to: "/reports/finance",
    permission: "report:finance",
    featureFlag: "financeEnabled",
  },
];
