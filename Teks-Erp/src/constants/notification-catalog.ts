// =============================================================================
// BİLDİRİM KATALOĞU — v1 (15 tür) · TEK KAYNAK
// =============================================================================
// Plan: docs/design/BILDIRIM-SISTEMI-PLAN.md §4 · kural dosyası docs/kurallar/bildirim.md.
//
// NEDEN VAR: "hangi tür var, kim görür, nereye götürür, nasıl yazılır" sorusunun TEK
// cevabı burasıdır. `emitNotification` türünü `NotificationKind`ten alır → katalog
// dışı tür DERLENMEZ; görme süzgeci (izin ∧ modül), tercih ekranı, dağıtıcı ve
// render aynı satırı okur. Liste ELLE yazılır, `scripts/test_bildirim_katalogu.ts`
// onu SCREEN_CATALOG + izin kataloğuna karşı ölçer (bayatlayamaz).
//
// ⚠️ Yeni tür reçetelidir: docs/RECETELER.md § Yeni bildirim türü.
// ⚠️ Payload'a TUTAR ve SIR girmez — yalnız kimlik ve görüntü dizeleri (belgeNo, kod, ad).
// =============================================================================

import { z } from "zod";
import { TERIM } from "./terim";
import { NOTIFICATION_DEFAULT_RETENTION, NOTIFICATION_DESKTOP_CHANNELS, type NotificationCatalogEntry } from "./notification-catalog.types";
import { CARI_NOTIFICATION_ENTRIES } from "./notification-catalog-cari";
import { READY_WORK_NOTIFICATION_ENTRIES } from "./notification-catalog-sevkiyat";
import { KIMLIK_NOTIFICATION_ENTRIES } from "./notification-catalog-kimlik";

export { NOTIFICATION_PHASES, NOTIFICATION_GRUPLARI } from "./notification-catalog.types";
export type {
  NotificationSinif, NotificationAltTur, NotificationGrup, NotificationKilit, NotificationKanal,
  NotificationPhase, NotificationSaklama, NotificationCatalogEntry, NotificationScopeDeclaration,
} from "./notification-catalog.types";

const SAKLAMA = NOTIFICATION_DEFAULT_RETENTION;
const KANAL_MASAUSTU = NOTIFICATION_DESKTOP_CHANNELS;

export const NOTIFICATION_CATALOG = {
  // ── Sistem ────────────────────────────────────────────────────────────────
  "sistem.yedek-basarisiz": {
    kod: "sistem.yedek-basarisiz", ad: "Yedek alınamadı",
    sinif: "BILDIRIM", altTur: "KOSUL", grup: "Sistem",
    izinler: [["system:backups"]],
    modul: "cekirdek:sistem-kimlik-belge",
    tekilKalibi: "{kaynak}",
    pencereSn: 0, varsayilan: "HERKES", kilit: "HER_ZAMAN",
    kilitGerekcesi: "Yedeksiz fabrika veri kaybına açıktır; bu uyarı kapatılamaz, yalnız ertelenebilir.",
    kanallar: KANAL_MASAUSTU,
    varsayilanKanallar: ["UYGULAMA"],
    baslik: "Yedek alınamadı",
    govde: "{kaynakAd} yedeği alınamadı: {neden}",
    cozuldu: "{kaynakAd} yedeği yeniden alınıyor",
    panelEkran: "system/backups", panelYol: "/system/backups",
    payloadAlanlari: ["kaynak", "kaynakAd", "neden"],
    tahminiHaftalik: 0.2, saklama: SAKLAMA,
  },
  "sistem.esitleme-gecikti": {
    kod: "sistem.esitleme-gecikti", ad: "Yönetim bulutu eşitlemesi gecikti",
    sinif: "BILDIRIM", altTur: "KOSUL", grup: "Sistem",
    izinler: [["admin:users"]],
    modul: "cekirdek:sistem-kimlik-belge",
    tekilKalibi: "bulut",
    pencereSn: 0, varsayilan: "HERKES", kilit: "YOK",
    kanallar: KANAL_MASAUSTU,
    varsayilanKanallar: ["UYGULAMA"],
    baslik: "Yönetim bulutu eşitlemesi gecikti",
    govde: "Son başarılı eşitleme {sonBasarili}; durum: {durum}",
    cozuldu: "Yönetim bulutu eşitlemesi yeniden başarılı",
    panelEkran: "access/patron-bulut", panelYol: "/access/patron-bulut",
    paramSemasi: z.object({ dakika: z.number().int().min(5).max(1440).default(30) }).strict(),
    payloadAlanlari: ["sonBasarili", "durum"],
    tahminiHaftalik: 0.5, saklama: SAKLAMA,
  },
  "sistem.lisans-uyarisi": {
    kod: "sistem.lisans-uyarisi", ad: "Lisans uyarısı",
    sinif: "BILDIRIM", altTur: "KOSUL", grup: "Sistem",
    izinler: [["license:view"]],
    modul: "cekirdek:sistem-kimlik-belge",
    tekilKalibi: "{nedenKodu}",
    pencereSn: 0, varsayilan: "HERKES", kilit: "HER_ZAMAN",
    kilitGerekcesi: "Lisans sorunu zamanında çözülmezse kurulum kısıtlı kipe geçebilir; bu uyarı kapatılamaz, yalnız ertelenebilir.",
    kanallar: KANAL_MASAUSTU,
    varsayilanKanallar: ["UYGULAMA"],
    baslik: "Lisans uyarısı",
    govde: "{neden}",
    cozuldu: "Lisans uyarısı giderildi",
    panelEkran: "system/license", panelYol: "/system/license",
    paramSemasi: z.object({ gun: z.number().int().min(1).max(90).default(14) }).strict(),
    payloadAlanlari: ["nedenKodu", "neden"],
    tahminiHaftalik: 0.1, saklama: SAKLAMA,
  },
  "sistem.guncelleme-onay-bekliyor": {
    kod: "sistem.guncelleme-onay-bekliyor", ad: "Güncelleme onay bekliyor",
    sinif: "BILDIRIM", altTur: "KOSUL", grup: "Sistem",
    izinler: [["license:manage"]],
    modul: "cekirdek:sistem-kimlik-belge",
    tekilKalibi: "{surum}",
    pencereSn: 0, varsayilan: "HERKES", kilit: "YOK",
    kanallar: KANAL_MASAUSTU,
    varsayilanKanallar: ["UYGULAMA"],
    baslik: "Güncelleme onay bekliyor",
    govde: "{surum} sürümü kuruluma hazır, onayınızı bekliyor",
    cozuldu: "{surum} sürümü için onay beklenmiyor",
    // `/system/updates` kapısız sayfadır (SCREEN_CATALOG'da satırı yok) → ekran Sistem merkezi.
    panelEkran: "system", panelYol: "/system/updates",
    payloadAlanlari: ["surum"],
    tahminiHaftalik: 0.5, saklama: SAKLAMA,
  },
  "yazici.hata": {
    kod: "yazici.hata", ad: "Yazıcıda baskı hatası",
    sinif: "BILDIRIM", altTur: "OLAY", grup: "Sistem",
    izinler: [["system:print-history"]],
    modul: "cekirdek:sistem-kimlik-belge",
    // Konu yazıcıdır (kayıtlı cihaz id'si, yoksa adı): aynı yazıcının 10 dk içindeki hataları
    // TEK satırda birleşir ("N kayıt") — arızalı yazıcı gelen kutusunu doldurmaz.
    tekilKalibi: "{yazici}",
    pencereSn: 600, varsayilan: "HERKES", kilit: "YOK",
    kanallar: KANAL_MASAUSTU,
    varsayilanKanallar: ["UYGULAMA"],
    baslik: "{yaziciAd} yazıcısında baskı hatası",
    govde: "{kisi} · {tur} · {neden}",
    panelEkran: "system/print-history", panelYol: "/system/print-history?printer={yazici}&status=HATA",
    payloadAlanlari: ["yazici", "yaziciAd", "kisi", "tur", "neden"],
    tahminiHaftalik: 3, saklama: SAKLAMA,
  },

  ...KIMLIK_NOTIFICATION_ENTRIES, // cihaz halkası + güvenilir cihaz — ayrı dosyada (dosya boyu)

  // ── Sipariş ───────────────────────────────────────────────────────────────
  "siparis.patron-siparisi": {
    kod: "siparis.patron-siparisi", ad: "Yönetim bulutundan sipariş geldi",
    sinif: "BILDIRIM", altTur: "OLAY", grup: "Sipariş",
    izinler: [["order:read"]],
    modul: "cekirdek:siparis-musteri",
    // Sabit kalıp: 10 dk penceresindeki siparişler TEK satırda birleşir ("N sipariş geldi").
    tekilKalibi: "patron-siparisi",
    pencereSn: 600, varsayilan: ["order:write"], kilit: "YOK",
    kanallar: KANAL_MASAUSTU,
    varsayilanKanallar: ["UYGULAMA"],
    baslik: "Yönetim bulutundan sipariş geldi",
    govde: "{musteriAd} için {siparisNo} numaralı sipariş açıldı",
    panelEkran: "operations/orders", panelYol: "/operations/orders?focus={siparisId}",
    payloadAlanlari: ["siparisId", "siparisNo", "musteriAd"],
    tahminiHaftalik: 5, saklama: SAKLAMA,
  },
  "siparis.termin-yaklasti": {
    kod: "siparis.termin-yaklasti", ad: "Sipariş termini yaklaştı",
    sinif: "BILDIRIM", altTur: "KOSUL", grup: "Sipariş",
    izinler: [["order:read"]],
    modul: "cekirdek:siparis-musteri",
    tekilKalibi: "{siparisId}",
    pencereSn: 0, varsayilan: ["order:write"], kilit: "YOK",
    kanallar: KANAL_MASAUSTU,
    varsayilanKanallar: ["UYGULAMA"],
    baslik: "Sipariş termini yaklaştı",
    govde: "{siparisNo} ({musteriAd}) termini {termin}",
    cozuldu: "{siparisNo} için termin yaklaşma uyarısı kapandı",
    panelEkran: "operations/orders", panelYol: "/operations/orders?focus={siparisId}",
    paramSemasi: z.object({ gun: z.number().int().min(1).max(30).default(3) }).strict(),
    kapsam: { yalnizTakip: true },
    payloadAlanlari: ["siparisId", "siparisNo", "musteriAd", "termin"],
    tahminiHaftalik: 10, saklama: SAKLAMA,
  },
  "siparis.termin-gecti": {
    kod: "siparis.termin-gecti", ad: "Sipariş termini geçti",
    sinif: "BILDIRIM", altTur: "KOSUL", grup: "Sipariş",
    izinler: [["order:read"]],
    modul: "cekirdek:siparis-musteri",
    tekilKalibi: "{siparisId}",
    pencereSn: 0, varsayilan: ["order:write"], kilit: "YOK",
    kanallar: KANAL_MASAUSTU,
    varsayilanKanallar: ["UYGULAMA"],
    baslik: "Sipariş termini geçti",
    govde: "{siparisNo} ({musteriAd}) termini {termin} tarihinde geçti",
    cozuldu: "{siparisNo} kapandı ya da termini güncellendi",
    panelEkran: "operations/orders", panelYol: "/operations/orders?focus={siparisId}",
    kapsam: { yalnizTakip: true },
    payloadAlanlari: ["siparisId", "siparisNo", "musteriAd", "termin"],
    tahminiHaftalik: 5, saklama: SAKLAMA,
  },

  // ── Üretim ────────────────────────────────────────────────────────────────
  "isemri.gecikti": {
    kod: "isemri.gecikti", ad: `${TERIM.terbiyeIsEmri.tekil} gecikti`,
    sinif: "BILDIRIM", altTur: "KOSUL", grup: "Üretim",
    izinler: [["workorder:read"]],
    modul: "productionEnabled",
    tekilKalibi: "{isEmriId}",
    pencereSn: 0, varsayilan: ["workorder:write"], kilit: "YOK",
    kanallar: KANAL_MASAUSTU,
    varsayilanKanallar: ["UYGULAMA"],
    baslik: `${TERIM.terbiyeIsEmri.tekil} gecikti`,
    govde: "{isEmriNo} planlanan bitişi {planlananBitis} geçti",
    cozuldu: "{isEmriNo} tamamlandı ya da planı güncellendi",
    panelEkran: "operations/work-orders", panelYol: "/operations/work-orders/{isEmriId}",
    kapsam: { yalnizTakip: true },
    payloadAlanlari: ["isEmriId", "isEmriNo", "planlananBitis"],
    tahminiHaftalik: 8, saklama: SAKLAMA,
  },

  // ── Kalite ────────────────────────────────────────────────────────────────
  "kalite.kk1-oran-dusuk": {
    kod: "kalite.kk1-oran-dusuk", ad: "1. kalite oranı düşük",
    sinif: "BILDIRIM", altTur: "KOSUL", grup: "Kalite",
    // Plan `quality:read` diyordu; derin bağlantı ekranı `report:quality` ister → ekran esas (plan §7 risk).
    izinler: [["report:quality"]],
    modul: "productionEnabled",
    tekilKalibi: "{kumasId}:{gun}",
    pencereSn: 0, varsayilan: ["quality:write"], kilit: "YOK",
    kanallar: KANAL_MASAUSTU,
    varsayilanKanallar: ["UYGULAMA"],
    baslik: "1. kalite oranı düşük",
    govde: "{kumasAd}: bugün 1. kalite oranı {oran} (eşik {esik})",
    cozuldu: "{kumasAd}: 1. kalite oranı eşiğin üstüne çıktı",
    panelEkran: "reports/quality", panelYol: "/reports/quality/scorecard",
    paramSemasi: z.object({
      oranYuzde: z.number().min(1).max(100).default(85),
      minMetre: z.number().int().min(0).max(100_000).default(200),
    }).strict(),
    payloadAlanlari: ["kumasId", "kumasAd", "gun", "oran", "esik"],
    tahminiHaftalik: 3, saklama: SAKLAMA,
  },

  "kalite.sertifika-suresi-doluyor": {
    kod: "kalite.sertifika-suresi-doluyor", ad: "Sertifika süresi doluyor",
    sinif: "BILDIRIM", altTur: "KOSUL", grup: "Kalite",
    izinler: [["certificate:read"]],
    modul: "kaliteGuvenceEnabled",
    tekilKalibi: "{sertifikaId}",
    pencereSn: 0, varsayilan: ["certificate:write"], kilit: "YOK",
    kanallar: KANAL_MASAUSTU,
    varsayilanKanallar: ["UYGULAMA"],
    baslik: "Sertifika süresi doluyor",
    govde: "{standart} · {sertifikaNo} ({sahip}): {durum}",
    cozuldu: "{standart} · {sertifikaNo} yenilendi ya da iptal edildi",
    panelEkran: "quality/certificates", panelYol: "/quality/certificates?focus={sertifikaId}",
    paramSemasi: z.object({ gun: z.number().int().min(1).max(365).default(30) }).strict(),
    payloadAlanlari: ["sertifikaId", "sertifikaNo", "standart", "sahip", "durum"],
    tahminiHaftalik: 1, saklama: SAKLAMA,
  },

  // ── Fason ─────────────────────────────────────────────────────────────────
  "fason.donus-gecikti": {
    kod: "fason.donus-gecikti", ad: "Fason dönüşü gecikti",
    sinif: "BILDIRIM", altTur: "KOSUL", grup: "Fason",
    // Plan `subcontractor:read` diyordu; derin bağlantı ekranı `report:subcontract` ister → ekran esas.
    izinler: [["report:subcontract"]],
    modul: "planlanan:fason",
    tekilKalibi: "{firmaId}",
    pencereSn: 0, varsayilan: "HERKES", kilit: "YOK",
    kanallar: KANAL_MASAUSTU,
    varsayilanKanallar: ["UYGULAMA"],
    baslik: "Fason dönüşü gecikti",
    govde: "{firmaAd}: {acikKalem} kalem {enEskiGun} gündür dönmedi",
    cozuldu: "{firmaAd}: geciken fason dönüşü kalmadı",
    panelEkran: "reports/subcontract", panelYol: "/reports/subcontract/scorecard",
    paramSemasi: z.object({ gun: z.number().int().min(1).max(120).default(10) }).strict(),
    kapsam: { esik: { gun: { alan: "enEskiGun", yon: "ALT" } } },
    payloadAlanlari: ["firmaId", "firmaAd", "acikKalem", "enEskiGun"],
    tahminiHaftalik: 3, saklama: SAKLAMA,
  },

  // ── Sevkiyat ──────────────────────────────────────────────────────────────
  "sevkiyat.onay-bekliyor": {
    kod: "sevkiyat.onay-bekliyor", ad: "Sevkiyat onay bekliyor",
    sinif: "BILDIRIM", altTur: "KOSUL", grup: "Sevkiyat",
    izinler: [["shipping:read"]],
    modul: "cekirdek:sevkiyat-depo",
    tekilKalibi: "{sevkiyatId}",
    pencereSn: 0, varsayilan: ["shipping:write"], kilit: "YOK",
    kanallar: KANAL_MASAUSTU,
    varsayilanKanallar: ["UYGULAMA"],
    baslik: "Sevkiyat onay bekliyor",
    govde: "{sevkiyatNo} ({musteriAd}) planlandı, onay bekliyor",
    cozuldu: "{sevkiyatNo} onaylandı ya da iptal edildi",
    panelEkran: "operations/shipments", panelYol: "/operations/shipments/{sevkiyatId}",
    payloadAlanlari: ["sevkiyatId", "sevkiyatNo", "musteriAd"],
    tahminiHaftalik: 15, saklama: SAKLAMA,
  },
  ...READY_WORK_NOTIFICATION_ENTRIES, // D4-J2 — ayrı dosyada (dosya boyu)

  // ── Finans (D4-I5) — ayrı dosyada (dosya boyu); yük TUTAR taşımaz ──
  ...CARI_NOTIFICATION_ENTRIES,

  // ── Dokuma ────────────────────────────────────────────────────────────────
  "dokuma.levent-bitiyor": {
    kod: "dokuma.levent-bitiyor", ad: "Levent bitiyor",
    sinif: "BILDIRIM", altTur: "KOSUL", grup: "Dokuma",
    izinler: [["warpbeam:read"], ["mobile:dokuma"]],
    // Plan `dokumaEnabled` diyordu; Leventler ekranı ve bitiş tahmini ucu `devereEnabled` kapısında → ekran esas.
    modul: "devereEnabled",
    tekilKalibi: "{leventId}",
    pencereSn: 0, varsayilan: ["warpbeam:write"], kilit: "YOK",
    kanallar: ["UYGULAMA", "OZET", "MASAUSTU", "TABLET_SES"],
    varsayilanKanallar: ["UYGULAMA"],
    baslik: "Levent bitiyor",
    govde: "{tezgahNo} tezgahındaki {leventNo} leventi ~{kalanGun} gün içinde bitiyor",
    cozuldu: "{leventNo} leventi indirildi ya da tahmin düzeldi",
    panelEkran: "operations/warp-beams", panelYol: "/operations/warp-beams?search={leventNo}",
    tabletEkran: "Dokuma",
    paramSemasi: z.object({ kalanGun: z.number().min(0.5).max(14).default(1) }).strict(),
    kapsam: { istasyonlar: true, esik: { kalanGun: { alan: "kalanGun", yon: "UST" } } },
    payloadAlanlari: ["leventId", "leventNo", "tezgahNo", "kalanGun"],
    tahminiHaftalik: 10, saklama: SAKLAMA,
  },
  "dokuma.tezgah-alarmi": {
    kod: "dokuma.tezgah-alarmi", ad: "Tezgah alarmı",
    sinif: "ALARM", altTur: null, grup: "Dokuma",
    izinler: [["loom:alarm-view"], ["mobile:tezgah-uyari"]],
    modul: "tezgahEnabled",
    kapi: "tezgahAlarm",
    tekilKalibi: "{alarmId}",
    pencereSn: 0,
    // Alıcı alarmın DONMUŞ listesidir (LoomAlarmRecipient); varsayılan görebilen herkes.
    varsayilan: "HERKES",
    kilit: "NOBETTE",
    kilitGerekcesi: "Nöbetteki sorumlu tezgah alarmını kapatamaz; alarm onaylanana dek çalar, yalnız süreli susturulur.",
    kanallar: ["UYGULAMA", "MASAUSTU", "TABLET_SES"],
    varsayilanKanallar: ["UYGULAMA", "MASAUSTU", "TABLET_SES"],
    baslik: "Tezgah alarmı: {tezgahNo}",
    govde: "{alarmAd} · {salonAd}",
    cozuldu: "{tezgahNo} tezgah alarmı kapandı",
    panelEkran: "operations/loom-alarms", panelYol: "/operations/loom-alarms/{alarmId}",
    tabletEkran: "Uyarilar",
    tabletRota: "UyariDetay",
    kapsam: { istasyonlar: true },
    payloadAlanlari: ["alarmId", "tezgahNo", "alarmAd", "salonAd"],
    tahminiHaftalik: 20, saklama: SAKLAMA,
  },
} as const satisfies Record<string, NotificationCatalogEntry>;

export type NotificationKind = keyof typeof NOTIFICATION_CATALOG;

export const NOTIFICATION_KINDS = Object.keys(NOTIFICATION_CATALOG) as NotificationKind[];

export function getNotificationEntry(kind: NotificationKind): NotificationCatalogEntry {
  return NOTIFICATION_CATALOG[kind];
}
