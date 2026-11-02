import type { LucideIcon } from "lucide-react";
import { activityTiles } from "./tiles/activity";
import { monitoringTiles } from "./tiles/monitoring";
import { archiveTiles } from "./tiles/archive";
import { settingsTiles } from "./tiles/settings";
import { maintenanceTiles } from "./tiles/maintenance";

export type SystemTileGroup = "activity" | "monitoring" | "archive" | "settings" | "maintenance";

export interface SystemTile {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  to: string;
  group: SystemTileGroup;
  adminOnly?: boolean;
  /**
   * Kapısız karo — hub'ı açabilen herkes görür, route da `ProtectedRoute`
   * taşımaz (`tile-route-permission.test` bunu ölçer). Palete ayrıca konmaz:
   * kapısız hedefin palet girişi kendi bölümünde yaşar.
   */
  public?: boolean;
  /**
   * Karo/palet görünürlüğü için gereken izin — route guard'ıyla AYNI kod olmalı.
   * Ayrışırsa kullanıcı kartı görür, tıklar, /forbidden'a düşer ("Kurşun Sırası"
   * dersi). Verilmezse karo `admin:settings` sayılır (Sistem hub'ının varsayılanı).
   */
  permission?: string;
  /**
   * `permission`ın çoklu hâli: bunlardan HERHANGİ biri yeterli. Route
   * `requireAnyPermission` ile eşleşir (`tile-route-permission.test` çok izinli
   * route'u "ANY" sayıp tek-izin karşılaştırmasını atlar; hizayı o dosyadaki
   * adı geçen ayrı kural ölçer).
   *
   * ⚠️ `permission` ile BİRLİKTE VERİLMEZ — iki kapıdan hangisinin geçerli
   * olduğu okuyucuya kalırdı.
   */
  permissionAny?: string[];
  /**
   * Karo YALNIZ satıcı (süperadmin) hesabına çizilir — ÜÇÜNCÜ kapı.
   *
   * ⚠️ İZNİN YERİNE GEÇMEZ, ÜSTÜNE EKLENİR: karo `permission`ını taşımaya devam
   * eder ve route ile birebir kalır (`tile-route-permission.test`). İzni bırakıp
   * yalnız kimliğe dayanmak o bekçinin kapsamını daraltırdı.
   *
   * ⚠️ 2026-09-04'ten beri ROUTE DA aynı kapıyı taşır (`requireSystemAccount`)
   * ve yüklem SUPAPLIDIR: modül anahtarlarının Genel Ayarlar'daki ikinci yazma
   * yolu kaldırıldı, yani supapsız bir kapı süperadminsiz kurulumu modülsüz
   * bırakırdı. Yüklem tek kaynaktan gelir (`lib/superadmin-gate.ts`) — supap
   * (`!systemAccountExists`) tüketicilerin birinde unutulursa o kurulum
   * modüllerini bir daha yapılandıramaz.
   */
  superadminOnly?: boolean;
  /** Görünmeyen palet arama anahtarları (ör. eski ad "genel ayarlar") — `CommandEntry.keywords`e taşınır. */
  keywords?: string;
  /**
   * Karo bu bayrak KAPALIYKEN de görünür, açıklaması "kapalı — Genel Ayarlar'dan açılır" olur
   * (bulunabilirlik şartı: kapalı özellik sessizce kaybolmaz).
   */
  kapaliBayrak?: "bildirimGelenKutusuEnabled";
  /**
   * Lisans GÖZLEM kapısı: kip `gozlem` iken karo yalnız satıcı kapısı açık
   * oturuma çizilir (lisans fabrikaya sıfır farktır); `zorla`da izin yeter.
   * İznin ÜSTÜNE eklenir, yerine geçmez — yüklem `lib/license/visibility.ts`.
   */
  licenseObservationGate?: boolean;
}

export interface SystemTileSection {
  group: SystemTileGroup;
  title: string;
  description: string;
}

export const systemTileSections: SystemTileSection[] = [
  {
    group: "activity",
    title: "Aktivite & Denetim",
    description: "Sistemde ne olduğunu izlemek için canlı log görünümleri",
  },
  {
    group: "monitoring",
    title: "İzleme & Sağlık",
    description: "Sunucu kaynakları ve uç-nokta performansı — sistem sağlığı",
  },
  {
    group: "archive",
    title: "Arşiv",
    description: "Eski log'ları arşive taşı veya geçmiş kayıtları ara",
  },
  {
    // UX-2: eski tek "Yapılandırma" grubu (18 karo) ikiye bölündü — fabrika ayarları ↔ bakım işleri.
    group: "settings",
    title: "Ayarlar",
    description: "Fabrika geneli ayarlar — modüller, baskı, numaralandırma, bildirim profilleri",
  },
  {
    group: "maintenance",
    title: "Bakım",
    description: "Güncelleme, yedek, lisans, destek ve veri bakımı",
  },
];
// Karolar bölüm dosyalarında (`tiles/*.ts`, UX-2 bölünmesi); bekçiler `scripts/lib/panel-karo-dosyalari.ts` ile hepsini okur.
export const systemTiles: SystemTile[] = [
  ...activityTiles,
  ...monitoringTiles,
  ...archiveTiles,
  ...settingsTiles,
  ...maintenanceTiles,
];

