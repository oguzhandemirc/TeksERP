import { Gauge, ListChecks, ClipboardList, Link2, Timer, Siren, Disc3, Activity, Hourglass } from "lucide-react";
import type { HubTile } from "../_components/ReportHubGrid";

/**
 * Dokuma raporları — rapor sözleşmesi `docs/kurallar/dokuma.md` § Raporların sözleşmesi.
 * Üç rapor + karne listesi (mühür eylemleri). Adres kalıbı ÜÇ segment (`ReportSideRail`).
 * Karo yalnız `dokuma.enabled` açıkken çizilir (`dokuma-regime.ts`); levent karoları ayrıca
 * `devere.enabled` ister (uçları `requireDevereEnabled` — kapalıyken karo 403'e açılmaz).
 */
export const dokumaReportTiles: HubTile[] = [
  {
    key: "zincir",
    title: "Üretim Zinciri",
    description: "Sipariş satırı → terbiye iş emri → dokuma iş emri → levent: nerede, ne kadar ilerledi, nerede takıldı; bağsız kayıtlar ayrı",
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
    key: "mudahale",
    title: "Müdahale ve Çözüm Süresi",
    description: "Tezgah alarmları: ortalama üstlenme ve çözüm süresi, hedef aşım oranı; sebep · hol · vardiya · tezgah · usta (yetkiliye) kırılımı",
    icon: Siren,
    to: "/reports/dokuma/mudahale",
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
  {
    key: "levent-sonucu",
    title: "Levent Sonucu",
    description: "Leventten beklenen kumaş (take-up) ile gerçek kumaş ve fire; gerçek kumaş otomatik / elle ayrı, take-up yoksa 'ölçülemedi'",
    icon: Disc3,
    to: "/reports/dokuma/levent-sonucu",
  },
  {
    key: "kapasite-kullanimi",
    title: "Kapasite Kullanımı",
    description: "Tezgah × hafta: teorik kapasite (nominal ÷ atkı/cm) ile gerçek top metresi; hesaplanamayan satır gerekçesiyle",
    icon: Activity,
    to: "/reports/dokuma/kapasite-kullanimi",
  },
  {
    key: "levent-bitis-tahmini",
    title: "Levent Bitiş Tahmini",
    description: "Tezgahtaki leventlerin kalanı ve son 7 günlük tüketim hızıyla tahmini bitiş günü (kesit)",
    icon: Hourglass,
    to: "/reports/dokuma/levent-bitis-tahmini",
  },
];

/** Uçları Devere modülüne de bağlı karolar (`dokuma.report.routes` `requireDevereEnabled`). */
export const DEVERE_GEREKEN_KAROLAR: ReadonlySet<string> = new Set(["levent-sonucu", "levent-bitis-tahmini"]);

/** Hub süzmesi — Devere kapalıyken levent karoları çizilmez (çizilse uç 403 `MODULE_DISABLED` döner). */
export function visibleDokumaTiles(tiles: readonly HubTile[], devereEnabled: boolean): HubTile[] {
  return tiles.filter((t) => devereEnabled || !DEVERE_GEREKEN_KAROLAR.has(t.key));
}
