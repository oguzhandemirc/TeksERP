import { FileBarChart, UserCheck } from "lucide-react";
import type { HubTile } from "../_components/ReportHubGrid";

export const auditReportTiles: HubTile[] = [
  {
    key: "system-log-summary",
    title: "Denetim Kaydı Özeti",
    description: "Tablo / işlem türüne göre değişim hacmi",
    icon: FileBarChart,
    to: "/reports/audit/system-log-summary",
  },
  {
    key: "user-activity",
    title: "Kullanıcı Aktivitesi",
    description: "Kullanıcı başına işlem sayısı ve son işlem zamanı",
    icon: UserCheck,
    to: "/reports/audit/user-activity",
  },
];
