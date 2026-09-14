import {
  Activity,
  Building2,
  Calculator,
  Factory,
  ShieldCheck,
  Spool,
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
import { dokumaReportTiles } from "./Dokuma/tile-config";

export interface ReportTile {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  to: string;
  permission?: string;
  /**
   * Bu karo yalnız ilgili MODÜL bayrağı AÇIKKEN çizilir (`nav-config.ts` deseni).
   *
   * ⚠️ İzin filtresi TEK BAŞINA YETMEZ: `ReportsHubPage` süzgeci `isAdmin ||`
   * ile kısa devre yapıyor, yani `report:finance` taşımayan bir ADMİN bile
   * karoyu görürdü — tıklayınca üç ucun üçü de `requireFinanceEnabled` ile 403
   * döner ve kullanıcı sebebi hiçbir yerde göremez. Bayrak GÖRÜNÜRLÜK,
   * izin KİŞİ kapısıdır; ikisi birbirinin yerine geçmez.
   *
   * ⚠️ DEĞER, BAĞLAM ALANININ ADIDIR (`OperationsVisibilityContext`) ve karar
   * O BAĞLAMDAN okunur — `useFeatureFlags()`ten değil. Sebep varsayılanların
   * YÖNÜ: `financeEnabled` belirsizken KAPALI, `productionEnabled` belirsizken
   * AÇIK sayılır. İkisini tek bir `?? false` ile okumak, fabrikada üretim
   * raporları karosunun bir an kaybolup geri gelmesi demekti ("sıfır görünür
   * fark" ihlali). Zincir tek yerde: `useOperationsVisibilityContext`.
   */
  featureFlag?: "financeEnabled" | "productionEnabled" | "dokumaEnabled";
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
  dokuma: dokumaReportTiles,
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
  dokuma: "Dokuma",
};

export const reportTiles: ReportTile[] = [
  {
    key: "production",
    title: "Üretim",
    description: "İstasyon verimliliği, operatör/makine performansı, fire",
    icon: Factory,
    to: "/reports/production",
    permission: "report:production",
    // ÜRETİM MODÜLÜ (2026-09-03). ⚠️ BİLİNÇLİ ASİMETRİ: `/api/reports` KARMA bir
    // router ve BİLEREK kapısız (`module.middleware` başlığı) — yani modül
    // kapalıyken karo gizlenir ama uç 200 dönmeye devam eder. Bu, "karo var /
    // uç 403" ayrışmasının TERSİ ve zararsız yönüdür: kullanıcı görmediği bir
    // ekranı açmaz; uç bazlı ayrım yazıldığı gün kapı da eklenir.
    featureFlag: "productionEnabled",
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
    // Üretim modülü — `reports/production` ile aynı karma-router asimetrisi.
    featureFlag: "productionEnabled",
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
  // Dokuma raporları (Dilim 5, 2026-09-14) — dokuma defterlerinden doğar; referans
  // fabrikada `dokuma.enabled` KAPALI ⇒ karo HİÇ çizilmez (`Dokuma/dokuma-regime.ts`).
  // İzin `report:production` (üretim raporudur; ayrı `loom:read` açılmadı — 1e hükmü ③).
  {
    key: "dokuma",
    title: "Dokuma",
    description: "Tezgah randımanı (K · P · E ayrı), duruş Pareto'su, vardiya karnesi ve mühür",
    icon: Spool,
    to: "/reports/dokuma",
    permission: "report:production",
    featureFlag: "dokumaEnabled",
  },
];
