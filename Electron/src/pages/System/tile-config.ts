import { Activity, Archive, Cpu, DatabaseBackup, FileCode2, Search, Settings as SettingsIcon, type LucideIcon } from "lucide-react";

export type SystemTileGroup = "activity" | "archive" | "config";

export interface SystemTile {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  to: string;
  group: SystemTileGroup;
  adminOnly?: boolean;
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
    group: "archive",
    title: "Arşiv",
    description: "Eski log'ları arşive taşı veya geçmiş kayıtları ara",
  },
  {
    group: "config",
    title: "Yapılandırma",
    description: "Sistem geneli ayarlar",
  },
];

export const systemTiles: SystemTile[] = [
  {
    key: "activity",
    title: "Aktivite Günlüğü",
    description: "Son aylarda kim hangi kaydı değiştirdi (aktif tablo)",
    icon: Activity,
    to: "/system/activity",
    group: "activity",
  },
  {
    key: "logs",
    title: "Sistem Kayıtları",
    description: "Kimlik doğrulama ve sistem olayları (login, başlatma, hata)",
    icon: FileCode2,
    to: "/system/logs",
    group: "activity",
    adminOnly: true,
  },
  {
    key: "archive",
    title: "Aktivite Arşivi",
    description: "Eski log'ları arşive taşı; tablo boyutu istatistikleri",
    icon: Archive,
    to: "/system/archive",
    group: "archive",
    adminOnly: true,
  },
  {
    key: "archive-search",
    title: "Arşiv Tarama",
    description: "Aktivite Günlüğü'nün arşivlenmiş eski kayıtlarını ara",
    icon: Search,
    to: "/system/archive/search",
    group: "archive",
    adminOnly: true,
  },
  {
    key: "server-status",
    title: "Sunucu Durumu",
    description: "Backend CPU/RAM kullanımı, çalışma süresi ve makine kaynakları",
    icon: Cpu,
    to: "/system/server-status",
    group: "config",
  },
  {
    key: "backups",
    title: "Yedekler",
    description: "Veritabanı yedeklerini listele, indir, geri yükleme komutunu kopyala",
    icon: DatabaseBackup,
    to: "/system/backups",
    group: "config",
  },
  {
    key: "settings",
    title: "Genel Ayarlar",
    description: "Özellik anahtarları, cihaz eşleştirme ve API adresi",
    icon: SettingsIcon,
    to: "/system/settings",
    group: "config",
  },
];
