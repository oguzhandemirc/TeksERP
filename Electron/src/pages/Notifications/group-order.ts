// Süzgeçteki alan sırası — backend `NOTIFICATION_GRUPLARI` ile aynı (plan B5 alan grupları).
import type { NotificationGroup } from "@/lib/bildirim/types";

export const NOTIFICATION_GROUP_ORDER: readonly NotificationGroup[] = [
  "Sipariş", "Üretim", "Kalite", "Sevkiyat", "Fason", "Stok", "Finans", "Dokuma", "Sistem",
];
