import { Gauge, ListChecks, ClipboardList, Link2, Timer } from "lucide-react";
import type { HubTile } from "../_components/ReportHubGrid";

/**
 * Dokuma raporları — rapor sözleşmesi `docs/kurallar/dokuma.md` § Raporların sözleşmesi.
 * Üç rapor + karne listesi (mühür eylemleri). Adres kalıbı ÜÇ segment (`ReportSideRail`).
 * Karo yalnız `dokuma.enabled` açıkken çizilir (`dokuma-regime.ts`).
 */
export const dokumaReportTiles: HubTile[] = [
  {
    key: "zincir",
    title: "Üretim Zinciri",
    description: "Sipariş satırı → iş emri → dokuma işi → levent: nerede, ne kadar ilerledi, nerede takıldı; bağsız kayıtlar ayrı",
    icon: Link2,
    to: "/reports/dokuma/zincir",
  },
  {
    key: "randiman",
    title: "Randıman",
    description: "Tezgah × vardiya: kullanılabilirlik · performans · etkinlik AYRI; ölçülemeyen beyan edilir; kaynak kırılımı",
    icon: Gauge,
    to: "/reports/dokuma/randiman",
  },
  {
    key: "durus-pareto",
    title: "Duruş Pareto",
    description: "Sebep × süre sınıfı; mikro duruşlar, sınıflandırılmamış ve atanmamış (levent) kovaları ayrı",
    icon: Timer,
    to: "/reports/dokuma/durus-pareto",
  },
  {
    key: "vardiya-karnesi",
    title: "Vardiya Karnesi",
    description: "Fabrika gününün vardiyaları: üretim, duruş, ölçülen / elle / simüle / çıkarım kırılımı",
    icon: ClipboardList,
    to: "/reports/dokuma/vardiya-karnesi",
  },
  {
    key: "karne",
    title: "Karne Listesi ve Mühür",
    description: "Vardiya × tezgah karneleri: anlık / mühürlü, terim düzeltme, mühürleme ve mühür açma",
    icon: ListChecks,
    to: "/reports/dokuma/karne",
  },
];
