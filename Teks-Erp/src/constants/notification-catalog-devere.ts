// =============================================================================
// BİLDİRİM KATALOĞU — Devere parça dosyası (devere-levent S1)
// =============================================================================
// `NOTIFICATION_CATALOG`a yayılır (tek katalog; ayrı dosya yalnız boyut içindir). `devere.siparis-gecikti` KOSUL:
// kaynak `notification-sources/is.ts` `lateWarpingOrderSubjects`, küme fason kokpiti gecikme bandının OVERDUE'su
// (`warping-order/delays`, kopyalanmaz). Varsayılan KAPALI: bugünkü davranış bildirimsizdir, tercihle/profille açılır.
// =============================================================================
import { NOTIFICATION_DEFAULT_RETENTION as SAKLAMA, NOTIFICATION_DESKTOP_CHANNELS as KANAL_MASAUSTU, NOTIFICATION_DEFAULT_CHANNELS as KANAL_VARSAYILAN, type NotificationCatalogEntry } from "./notification-catalog.types";

export const DEVERE_NOTIFICATION_ENTRIES = {
  "devere.siparis-gecikti": {
    kod: "devere.siparis-gecikti", ad: "Devere siparişi gecikti",
    sinif: "BILDIRIM", altTur: "KOSUL", grup: "Fason",
    izinler: [["warping-order:read"]],
    modul: "devereEnabled",
    tekilKalibi: "{siparisId}",
    pencereSn: 0, varsayilan: "KAPALI", kilit: "YOK",
    kanallar: KANAL_MASAUSTU,
    varsayilanKanallar: KANAL_VARSAYILAN,
    baslik: "Devere siparişi gecikti",
    govde: "{siparisNo} ({firmaAd} · {kartKod}) termini {gecikmeGun} gün geçti",
    cozuldu: "{siparisNo} teslim alındı, kapandı ya da termini ileri alındı",
    panelEkran: "operations/fason-devere", panelYol: "/operations/fason-devere/{siparisId}",
    payloadAlanlari: ["siparisId", "siparisNo", "firmaAd", "kartKod", "gecikmeGun"],
    tahminiHaftalik: 2, saklama: SAKLAMA,
  },
} as const satisfies Record<string, NotificationCatalogEntry>;
