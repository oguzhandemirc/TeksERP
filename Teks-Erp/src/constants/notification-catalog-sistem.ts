// Sistem bildirimleri (S6a, 2026-11-15) — ana katalogdan dosya boyu için ayrıldı; `NOTIFICATION_CATALOG`a sistem
// türlerinin arasında yayılır. `sistem.disk-dolu`: `/health` ile aynı okuyucu (`readAppDiskMetrics`), ölçülemezse açık
// koşul korunur (`notification-sources/sistem.ts`).
import { z } from "zod";
import {
  NOTIFICATION_DEFAULT_CHANNELS as KANAL_VARSAYILAN,
  NOTIFICATION_DEFAULT_RETENTION as SAKLAMA,
  NOTIFICATION_DESKTOP_CHANNELS as KANAL_MASAUSTU,
  type NotificationCatalogEntry,
} from "./notification-catalog.types";

export const SISTEM_DISK_NOTIFICATION_ENTRIES = {
  "sistem.disk-dolu": {
    kod: "sistem.disk-dolu", ad: "Sunucu diski doluyor",
    sinif: "BILDIRIM", altTur: "KOSUL", grup: "Sistem",
    izinler: [["system:backups"]],
    modul: "cekirdek:sistem-kimlik-belge",
    tekilKalibi: "{disk}",
    pencereSn: 0, varsayilan: "HERKES", kilit: "YOK",
    kanallar: KANAL_MASAUSTU,
    varsayilanKanallar: KANAL_VARSAYILAN, onemli: true,
    baslik: "Sunucu diski doluyor",
    govde: "Sunucu diski %{doluluk} dolu (eşik %{esik}), {bosGb} GB boş kaldı",
    cozuldu: "Sunucu diski eşiğin altına indi",
    panelEkran: "system/backups", panelYol: "/system/backups",
    payloadAlanlari: ["disk", "doluluk", "esik", "bosGb"],
    paramSemasi: z.object({ oran: z.number().min(50).max(99).default(90) }).strict(),
    tahminiHaftalik: 0.1, saklama: SAKLAMA,
  },
} as const satisfies Record<string, NotificationCatalogEntry>;
