import { Ban, ClipboardList, Globe2, PackageSearch, PackageX, Target, Timer, Truck } from "lucide-react";
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
    key: "order-cancellation",
    title: "Sipariş İptal Karnesi",
    description: "Müşteriler neden ve ne kadar geç vazgeçiyor — sebep dağılımı ve maliyet sınıfı",
    icon: Ban,
    to: "/reports/sales/order-cancellation",
  },
  {
    key: "order-leadtime",
    title: "Sipariş → Teslim Süresi",
    description: "Sipariş alındıktan kaç gün sonra mal çıkıyor — termin sözünün dayanağı",
    icon: Timer,
    to: "/reports/sales/order-leadtime",
  },
  {
    key: "demand-analysis",
    title: "Talep Analizi",
    description: "En çok istenen kumaş-renk-en üçlüleri ve aylık mevsimsellik",
    icon: Target,
    to: "/reports/sales/demand-analysis",
  },
  {
    key: "order-intake",
    title: "Sipariş Karnesi",
    description: "Dönemde alınan sipariş adedi, metrajı, ortalama büyüklüğü ve iptal oranı",
    icon: ClipboardList,
    to: "/reports/sales/order-intake",
  },
  {
    key: "open-order-coverage",
    title: "Açık Sipariş Karşılanma",
    description: "Açık siparişin ne kadarı bugün sevk edilebilir, ne kadarı üretim istiyor",
    icon: PackageSearch,
    to: "/reports/sales/open-order-coverage",
  },
  {
    key: "shipment-scorecard",
    title: "Sevk & Termin Karnesi",
    description: "Dönemsel sevk hacmi + zamanında teslim oranı ve geciken siparişler",
    icon: Truck,
    to: "/reports/sales/shipment-scorecard",
  },
  {
    key: "destination-mix",
    title: "Yurtiçi / Yurtdışı Satış",
    description: "Yön dağılımı (metre · kg · tutar), ihracat müşteri/ülke/ürün kırılımı, açık sipariş ve termin",
    icon: Globe2,
    to: "/reports/sales/destination-mix",
  },
  {
    key: "return-scorecard",
    title: "İade Karnesi",
    description: "İade oranı, nedeni ve müşteri kırılımı — sevk metrajına göre",
    icon: PackageX,
    to: "/reports/sales/return-scorecard",
  },
];
