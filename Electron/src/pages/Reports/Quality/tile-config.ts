import { Award, ShieldAlert, Trash2 } from "lucide-react";
import type { HubTile } from "../_components/ReportHubGrid";

/**
 * Kalite raporları — 2026-08-09'da DÖRT rapor kaldırıldı, yerine iki karne geldi.
 *
 * Kaldırılanlar ve nedenleri:
 *   • "Hata Türü Dağılımı" + "İstasyon Hata Oranı" → Fire Karnesi'nin tespit
 *     tablolarında, üstelik hurda METRAJIYLA birlikte (eskiden yalnız adet vardı).
 *   • "QC2 Kararları" → enum ikiye indikten sonra (CUT/NO_CUT) Fire Karnesi'nin
 *     tespit tablosuyla neredeyse birebir örtüşüyordu.
 *   • "Kurşun Uygulama Oranı" → yönetim sorusu değil proses parametresi denetimi;
 *     ayrıca iki bağımsız sayacı oranlıyordu (top eşleştirmiyordu), yani dönem
 *     sınırlarında kayan bir rakamdı.
 */
export const qualityReportTiles: HubTile[] = [
  {
    key: "scorecard",
    title: "Kalite Karnesi",
    description: "Metraj ağırlıklı 1./2. kalite oranı — kumaş, renk, fason kırılımıyla",
    icon: Award,
    to: "/reports/quality/scorecard",
  },
  {
    key: "scrap-scorecard",
    title: "Fire Karnesi",
    description: "Hurda metrajı ve nedeni — hata türü, kumaş, kaynak kırılımıyla",
    icon: Trash2,
    to: "/reports/quality/scrap-scorecard",
  },
  {
    key: "plan-deviation-scorecard",
    title: "Plan-Sapma Karnesi",
    description: "Tamburda plan dışı onayla depoya inen mal — renk/en, operatör, kumaş kırılımıyla",
    icon: ShieldAlert,
    to: "/reports/quality/plan-deviation-scorecard",
  },
];
