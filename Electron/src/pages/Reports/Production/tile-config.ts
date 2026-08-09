import { Gauge, UserCog, ScanBarcode, GitBranch } from "lucide-react";
import type { HubTile } from "../_components/ReportHubGrid";

/**
 * Üretim raporları — 2026-08-09 sadeleştirmesi.
 *
 * "İstasyon Verimliliği" → "Nerede Takıldı (WIP)". Eskisi `qtyIn` ve `qtyOut`
 * kolonlarını yan yana basıyordu ve olmayan bir "kayıp" okumasını davet
 * ediyordu — `qtyOut = qtyIn` TASARIM GEREĞİ yazılır. Yenisi o farkı hiç
 * basmaz ve asıl operasyonel soruyu sorar: hangi iş kaç gündür duruyor.
 *
 * Kaldırılanlar:
 *   • "Fire & Hurda" → Fire Karnesi (Kalite altında). Eskisi gün kırılımını
 *     `rolls.updatedAt`'ten alıyordu; o kolon gerçek bir hareket damgası DEĞİL
 *     (etiket yeniden basımı da günceller) → fire yanlış güne düşebiliyordu.
 *     Yeni karne `Roll.finalizedAt` çıpasını kullanır.
 *   • "Makine Kullanımı" → veri kapsamı yetersiz: operasyonların yalnız ~%31'inde
 *     makine bilgisi var ve bu BİLİNÇLİ (dağıtımsız kurşun kapanışı `machineId`
 *     yazmaz — kök CLAUDE.md). Rapor eksikliği söylemiyordu; kapsam düzelene
 *     kadar göstermemek doğrusu.
 *
 * "Operatör Performansı" → "Operatör İş Hacmi" olarak yeniden adlandırıldı ve
 * bir PERFORMANS sıralaması olarak sunulmuyor: tekstil operatörü metre başına
 * çalışır ve işini kendi seçmez; işlem sayısını sıralamak yanlış kullanıma açıktı.
 *
 * İZLEME ÇİFT YÖNLÜDÜR ve ikisi AYRI ekrandır:
 *   • "Top İzleme"   → İLERİ yön: bir top hangi istasyonlardan geçti.
 *   • "Parti İzleme" → GERİ yön: bu partiden hangi müşteriye ne gitti. Şikâyet
 *     geldiğinde etki kümesini bulmanın tek yolu buydu ve hiçbir ekranda yoktu.
 * Tek ekranda birleştirilmediler çünkü giriş noktaları farklı (barkod ↔ parti no)
 * ve parti numarası benzersiz olmadığı için aday seçimi gerektiriyor.
 */
export const productionReportTiles: HubTile[] = [
  {
    key: "wip",
    title: "Nerede Takıldı (WIP)",
    description: "İstasyonlarda bekleyen mal, en uzun bekleyen işler, başlamamış iş emirleri",
    icon: Gauge,
    to: "/reports/production/wip",
  },
  {
    key: "batch-trace",
    title: "Parti İzleme",
    description: "Bu partiden hangi müşteriye ne gitti — şikâyette etki kümesi",
    icon: GitBranch,
    to: "/reports/production/batch-trace",
  },
  {
    key: "traveler-trace",
    title: "Top İzleme",
    description: "Bir topun istasyon adımları, operatör ve süre geçmişi",
    icon: ScanBarcode,
    to: "/reports/production/traveler-trace",
  },
  {
    key: "operator-performance",
    title: "Operatör İş Hacmi",
    description: "Operatör başına işlenen top adedi — sıralama/performans ölçüsü DEĞİL",
    icon: UserCog,
    to: "/reports/production/operator-performance",
  },
];
