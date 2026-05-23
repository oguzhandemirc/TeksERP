import { UserSquare2, BookKey } from "lucide-react";
import type { HubTile } from "../_components/ReportHubGrid";

export const customerReportTiles: HubTile[] = [
  {
    key: "order-profile",
    title: "Müşteri Sipariş Profili",
    description: "Favori renk, desen, en ve sıklık analizi",
    icon: UserSquare2,
    to: "/reports/customer/order-profile",
  },
  {
    key: "alias-stats",
    title: "Alias Eşleştirme",
    description: "Müşteri renk/ürün alias kullanım istatistiği",
    icon: BookKey,
    to: "/reports/customer/alias-stats",
  },
];
