import { UserSquare2 } from "lucide-react";
import type { HubTile } from "../_components/ReportHubGrid";

/**
 * Müşteri raporları.
 *
 * "Alias Eşleştirme" KALDIRILDI (2026-08-09): bir yönetim raporu değil, veri
 * hijyeni sayacıydı ("kaç alias tanımlı"). Hiçbir kararı değiştirmiyordu ve
 * yeri Tanımlar ekranı. Rapor menüsündeki her fazlalık, gerçek raporlara olan
 * güveni de seyreltir.
 */
export const customerReportTiles: HubTile[] = [
  {
    key: "order-profile",
    title: "Müşteri Sipariş Profili",
    description: "Favori renk, desen, en ve sıklık analizi",
    icon: UserSquare2,
    to: "/reports/customer/order-profile",
  },
];
