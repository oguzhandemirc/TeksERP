import { Boxes } from "lucide-react";
import type { HubTile } from "../_components/ReportHubGrid";

/**
 * Stok raporları — 2026-08-09 sadeleştirmesi.
 *
 * "Rulo Yaşlandırma" + "Stok Dağılımı" TEK karnede birleşti. Eksik olan şey
 * ikisinin KESİŞİMİYDİ: yaşlı olmak tek başına sorun değil (sipariş bekliyor
 * olabilir), siparişsiz olmak da tek başına sorun değil (dün üretilmiş
 * olabilir). Nakit sıkışması ikisi birden olduğunda başlar.
 *
 * "Hareket Geçmişi" KALDIRILDI: günlük hareket sayacıydı, bir karar
 * değiştirmiyordu; tek top izleme ihtiyacını Üretim → Top İzleme karşılıyor.
 */
export const inventoryReportTiles: HubTile[] = [
  {
    key: "scorecard",
    title: "Stok & Ölü Stok",
    description: "Rafta ne var, kaç gündür duruyor, siparişi var mı",
    icon: Boxes,
    to: "/reports/inventory/scorecard",
  },
];
