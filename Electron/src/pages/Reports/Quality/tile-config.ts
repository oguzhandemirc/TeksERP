import { Bug, TrendingDown, CheckCircle2, Crosshair } from "lucide-react";
import type { HubTile } from "../_components/ReportHubGrid";

export const qualityReportTiles: HubTile[] = [
  {
    key: "defect-distribution",
    title: "Hata Türü Dağılımı",
    description: "DefectType bazında frekans ve metraj kaybı",
    icon: Bug,
    to: "/reports/quality/defect-distribution",
  },
  {
    key: "station-defect-rate",
    title: "İstasyon Hata Oranı",
    description: "KK1 / KK2 / Tambur kırılımında hata yoğunluğu",
    icon: TrendingDown,
    to: "/reports/quality/station-defect-rate",
  },
  {
    key: "qc2-decisions",
    title: "QC2 Kararları",
    description: "Tambur red/kabul oranı ve müşteri iadeleri",
    icon: CheckCircle2,
    to: "/reports/quality/qc2-decisions",
  },
  {
    key: "kursun-application",
    title: "Kurşun Uygulama Oranı",
    description: "Hangi siparişlerde / topların yüzde kaçına Kurşun geçildi",
    icon: Crosshair,
    to: "/reports/quality/kursun-application",
  },
];
