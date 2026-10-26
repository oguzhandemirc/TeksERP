// Sistem › İzleme & Sağlık karoları (sıra = hub sırası).
import { Cpu, Gauge, MonitorSmartphone } from "lucide-react";
import { SYSTEM_CLIENTS_ACCESS, SYSTEM_SERVER_STATUS_ACCESS } from "@/lib/permissions";
import type { SystemTile } from "../tile-config";

export const monitoringTiles: SystemTile[] = [
  {
    key: "perf",
    title: "Endpoint Performansı",
    description: "Hangi uç yavaş — route bazında p50/p95, yavaş istek defteri, günlük trend",
    icon: Gauge,
    to: "/system/perf",
    group: "monitoring",
    permission: "admin:settings",
    superadminOnly: true,
  },
  {
    key: "server-status",
    title: "Sunucu Durumu",
    description: "Backend CPU/RAM kullanımı, çalışma süresi ve makine kaynakları",
    icon: Cpu,
    to: "/system/server-status",
    group: "monitoring",
    permissionAny: SYSTEM_SERVER_STATUS_ACCESS,
  },
  {
    // Bağlı İstemciler — "hangi panel/tablet hangi sürümde, en son ne zaman
    // görüldü, kim oturumdaydı". İzin: `admin:settings` (hub'ın varsayılanı;
    // yeni izin kodu AÇILMADI — sahada atanması unutulacak bir adım daha
    // olurdu, 2026-08-01 kurşun bypass dersi).
    key: "clients",
    title: "Bağlı İstemciler",
    description: "Panel/tablet sürümleri, son görülme zamanı ve son kullanıcı",
    icon: MonitorSmartphone,
    to: "/system/clients",
    group: "monitoring",
    permissionAny: SYSTEM_CLIENTS_ACCESS,
  },
];
