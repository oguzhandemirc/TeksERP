// Süzgeçteki alan sırası — backend `NOTIFICATION_GRUPLARI` ile aynı (plan B5 alan grupları).
import type { NotificationGroup } from "@/lib/bildirim/types";

export const NOTIFICATION_GROUP_ORDER: readonly NotificationGroup[] = [
  "Sipariş", "Satış", "Planlama", "Üretim", "Kalite", "Sevkiyat", "Fason", "Stok", "Depo", "Mal Kabul", "Satınalma",
  "Finans", "Dokuma", "Bakım", "Personel", "Ana Veri", "Yetki", "Sistem",
];
