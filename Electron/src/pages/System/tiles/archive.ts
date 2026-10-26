// Sistem › Arşiv karoları (sıra = hub sırası).
import { Archive, Search } from "lucide-react";
import { TERIM_AD } from "@/lib/terim";
import { SYSTEM_ACTIVITY_ACCESS, SYSTEM_ROLL_ARCHIVE_ACCESS } from "@/lib/permissions";
import type { SystemTile } from "../tile-config";

export const archiveTiles: SystemTile[] = [
  {
    // 2026-08-05: Envanter sekme şeridinden buraya taşındı. Başlık "TOP
    // Arşivi" — komşusu "Aktivite Arşivi" (SystemLog) ve ikisi tamamen farklı
    // şeyler; tek kelimelik "Arşiv" ikisini de karşılar ve yanlış tıklatır.
    key: "roll-archive",
    title: "Top Arşivi",
    description: "Emekli toplar — kesilmiş, fasonda/kartelada tüketilmiş kayıtlar",
    icon: Archive,
    to: "/system/roll-archive",
    group: "archive",
    permissionAny: SYSTEM_ROLL_ARCHIVE_ACCESS,
  },
  {
    key: "archive",
    title: TERIM_AD.etkinlikArsivi,
    description: "Eski log'ları arşive taşı; tablo boyutu istatistikleri",
    icon: Archive,
    to: "/system/archive",
    group: "archive",
    permission: "admin:settings",
    superadminOnly: true,
  },
  {
    key: "archive-search",
    title: "Arşiv Tarama",
    description: "Etkinlik akışının arşivlenmiş eski kayıtlarını ara",
    icon: Search,
    to: "/system/archive/search",
    group: "archive",
    permissionAny: SYSTEM_ACTIVITY_ACCESS,
  },
];
