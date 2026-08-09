import { PackageX, Truck } from "lucide-react";
import type { HubTile } from "../_components/ReportHubGrid";

/**
 * Sipariş & Sevkiyat raporları.
 *
 * 2026-08-09'da iki rapor KALDIRILDI ve yerlerine Sevk & Termin Karnesi geldi:
 *   • "Sipariş Gerçekleşme" → karnenin sevk hacmi + sipariş ilerleme bölümü
 *   • "Geç Teslimat"        → karnenin termin bölümü. Eskisi tarih aralığı
 *     ALMIYORDU (yalnız anlık liste); "geçen ay zamanında teslim oranımız neydi"
 *     sorusu cevapsızdı. Yeni karne hem trendi hem anlık geciken listesini verir.
 */
export const salesReportTiles: HubTile[] = [
  {
    key: "shipment-scorecard",
    title: "Sevk & Termin Karnesi",
    description: "Dönemsel sevk hacmi + zamanında teslim oranı ve geciken siparişler",
    icon: Truck,
    to: "/reports/sales/shipment-scorecard",
  },
  {
    key: "return-scorecard",
    title: "İade Karnesi",
    description: "İade oranı, nedeni ve müşteri kırılımı — sevk metrajına göre",
    icon: PackageX,
    to: "/reports/sales/return-scorecard",
  },
];
