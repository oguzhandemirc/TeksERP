// Sistem › Aktivite & Denetim karoları (sıra = hub sırası).
import { Activity, FileCode2, MapPin, Printer, Bell } from "lucide-react";
import { SYSTEM_ACTIVITY_ACCESS, SYSTEM_PRINT_HISTORY_ACCESS, SYSTEM_WORK_SESSIONS_ACCESS } from "@/lib/permissions";
import type { SystemTile } from "../tile-config";

export const activityTiles: SystemTile[] = [
  {
    key: "activity",
    title: "Etkinlik",
    description: "İşlemler — kim ne yaptı, günlük dille; teknik iz ve kayıt numarasıyla arama",
    icon: Activity,
    to: "/system/activity",
    group: "activity",
    permissionAny: SYSTEM_ACTIVITY_ACCESS,
  },
  {
    // bildirim: kişisel gelen kutusu — kapısız (herkes kendi kutusunu görür); bayrak kapalıyken karo kalır.
    key: "notifications",
    title: "Bildirimler",
    description: "Size gelen bildirimlerin geçmiş günlüğü — okundu, ertele, aç",
    icon: Bell,
    to: "/notifications",
    group: "activity",
    public: true,
    kapaliBayrak: "bildirimGelenKutusuEnabled",
  },
  {
    key: "logs",
    title: "Sistem Kayıtları",
    description: "Kimlik doğrulama ve sistem olayları (login, başlatma, hata)",
    icon: FileCode2,
    to: "/system/logs",
    group: "activity",
    permissionAny: SYSTEM_ACTIVITY_ACCESS,
  },
  {
    key: "print-history",
    title: "Yazdırma Geçmişi",
    description: "Kim, neyi, hangi yazıcıdan bastı — hatalar ve nedenleri",
    icon: Printer,
    to: "/system/print-history",
    group: "activity",
    permissionAny: SYSTEM_PRINT_HISTORY_ACCESS,
  },
  {
    key: "work-sessions",
    title: "Çalışma Oturumları",
    description: "Kim hangi makinede — canlı görünüm + geçmiş (saha ayak izi)",
    icon: MapPin,
    to: "/system/work-sessions",
    group: "activity",
    permissionAny: SYSTEM_WORK_SESSIONS_ACCESS,
  },
];
