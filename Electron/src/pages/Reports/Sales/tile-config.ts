import { Globe2, Target } from "lucide-react";
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
    key: "demand-analysis",
    title: "Talep Analizi",
    description: "En çok istenen kumaş-renk-en üçlüleri ve aylık mevsimsellik",
    icon: Target,
    to: "/reports/sales/demand-analysis",
  },
  {
    key: "destination-mix",
    title: "Yurtiçi / Yurtdışı Satış",
    description: "Yön dağılımı (metre · kg · tutar), ihracat müşteri/ülke/ürün kırılımı, açık sipariş ve termin",
    icon: Globe2,
    to: "/reports/sales/destination-mix",
  },
];
