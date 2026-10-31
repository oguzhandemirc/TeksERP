// =============================================================================
// BİLDİRİM KATALOĞU — Sevkiyat parça dosyası (D4-J2; tasarım DALGA4 §12.2)
// =============================================================================
// `NOTIFICATION_CATALOG`a yayılır (tek katalog; ayrı dosya yalnız boyut içindir). `sevkiyat.sevke-hazir` KOSUL:
// kaynak `notification-sources/is.ts` `readyWorkSubjects`, yüklem `ship-readiness.helper` (kopyalanmaz), birimler
// `shipping.ready.notifyUnits` (boş = kapalı). Yük tutar taşımaz.
// =============================================================================
import { NOTIFICATION_DEFAULT_RETENTION as SAKLAMA, NOTIFICATION_DESKTOP_CHANNELS as KANAL_MASAUSTU, type NotificationCatalogEntry } from "./notification-catalog.types";

/** Tür kodu tek kaynak: kaynak (is.ts) + ayar yazımı (birim eklenince taban damgası düşer) buradan okur. */
export const READY_WORK_KIND = "sevkiyat.sevke-hazir";

export const READY_WORK_NOTIFICATION_ENTRIES = {
  [READY_WORK_KIND]: {
    kod: READY_WORK_KIND, ad: "İş sevke hazır",
    sinif: "BILDIRIM", altTur: "KOSUL", grup: "Sevkiyat",
    izinler: [["shipping:read"]],
    modul: "cekirdek:sevkiyat-depo",
    tekilKalibi: "{sekme}:{id}",
    pencereSn: 0, varsayilan: ["shipping:write"], kilit: "YOK",
    kanallar: KANAL_MASAUSTU,
    varsayilanKanallar: ["UYGULAMA"],
    baslik: "Sevke hazır: {birim} {no}",
    govde: "{musteriAd} · {hazirTop} top, {hazirMetre} m depoda, sevke hazır",
    cozuldu: "{birim} {no} artık sevke hazır değil (top geri açıldı ya da sevk edildi)",
    panelEkran: "operations/sevke-hazir-isler", panelYol: "/operations/sevke-hazir-isler?tab={sekme}",
    payloadAlanlari: ["birim", "sekme", "id", "no", "musteriAd", "hazirTop", "hazirMetre"],
    tahminiHaftalik: 10, saklama: SAKLAMA,
  },
} as const satisfies Record<string, NotificationCatalogEntry>;
