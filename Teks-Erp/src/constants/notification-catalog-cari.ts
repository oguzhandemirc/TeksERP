// =============================================================================
// BİLDİRİM KATALOĞU — Finans/cari türleri (D4-I5; tasarım DALGA4 §12.2)
// =============================================================================
// `NOTIFICATION_CATALOG`a yayılır (tek katalog; ayrı dosya yalnız boyut içindir). Yük TUTAR taşımaz: ne bakiye
// ne limit — gelen kutusu finans ekranı değil (`test_bildirim_katalogu` §8). Kilit türleri OLAY (kilit başına tek,
// yayma `cari-hold.service`), risk türü KOSUL (`notification-sources/cari.ts`, yüklem `riskExposureTx`).
// =============================================================================
import { NOTIFICATION_DEFAULT_RETENTION as SAKLAMA, NOTIFICATION_DESKTOP_CHANNELS as KANAL_MASAUSTU, type NotificationCatalogEntry } from "./notification-catalog.types";

export const CARI_NOTIFICATION_ENTRIES = {
  "cari.kilitlendi": {
    kod: "cari.kilitlendi", ad: "Cari kilitlendi",
    sinif: "BILDIRIM", altTur: "OLAY", grup: "Finans",
    izinler: [["finance:read"]],
    modul: "financeEnabled",
    // Konu kilit satırıdır: kilit başına TEK bildirim (replay ikinci satır doğurmaz — emit yeni satırın tx'inde).
    tekilKalibi: "{kilitId}",
    pencereSn: 0, varsayilan: ["finance:invoice", "shipping:write"], kilit: "YOK",
    kanallar: KANAL_MASAUSTU,
    varsayilanKanallar: ["UYGULAMA"],
    baslik: "Cari kilitlendi: {cariAd}",
    govde: "{cariKodu} · {kapsam} durduruldu · sebep: {sebep} · {kisi}",
    panelEkran: "finance/cari", panelYol: "/finance/cari",
    payloadAlanlari: ["kilitId", "cariAd", "cariKodu", "kapsam", "sebep", "kisi"],
    tahminiHaftalik: 0.5, saklama: SAKLAMA,
  },
  "cari.kilit-acildi": {
    kod: "cari.kilit-acildi", ad: "Cari kilidi açıldı",
    sinif: "BILDIRIM", altTur: "OLAY", grup: "Finans",
    izinler: [["finance:read"]],
    modul: "financeEnabled",
    tekilKalibi: "{kilitId}",
    pencereSn: 0, varsayilan: ["finance:invoice", "shipping:write"], kilit: "YOK",
    kanallar: KANAL_MASAUSTU,
    varsayilanKanallar: ["UYGULAMA"],
    baslik: "Cari kilidi açıldı: {cariAd}",
    govde: "{cariKodu} · {kapsam} yeniden açık · kilit sebebi: {sebep} · {kisi}",
    panelEkran: "finance/cari", panelYol: "/finance/cari",
    payloadAlanlari: ["kilitId", "cariAd", "cariKodu", "kapsam", "sebep", "kisi"],
    tahminiHaftalik: 0.5, saklama: SAKLAMA,
  },
  "cari.risk-limiti-asildi": {
    kod: "cari.risk-limiti-asildi", ad: "Cari risk limitini aştı",
    sinif: "BILDIRIM", altTur: "KOSUL", grup: "Finans",
    izinler: [["finance:read"]],
    modul: "financeEnabled",
    // Konu hesap × para birimi (limit her para biriminde AYRI ölçülür — `riskExposureTx`).
    tekilKalibi: "{cariId}:{paraBirimi}",
    pencereSn: 0, varsayilan: ["finance:read"], kilit: "YOK",
    kanallar: KANAL_MASAUSTU,
    varsayilanKanallar: ["UYGULAMA"],
    baslik: "Cari risk limitini aştı: {cariAd}",
    govde: "{cariKodu}: {paraBirimi} bakiyesi risk limitinin üstünde",
    cozuldu: "{cariAd}: {paraBirimi} bakiyesi yeniden risk limitinin içinde",
    panelEkran: "finance/cari", panelYol: "/finance/cari",
    payloadAlanlari: ["cariId", "cariAd", "cariKodu", "paraBirimi"],
    tahminiHaftalik: 1, saklama: SAKLAMA,
  },
} as const satisfies Record<string, NotificationCatalogEntry>;
