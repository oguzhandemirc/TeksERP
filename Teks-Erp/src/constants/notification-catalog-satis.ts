// =============================================================================
// BİLDİRİM KATALOĞU — Satış · Sipariş · Teklif · Planlama parça dosyası (S1, geniş katalog 2026-11-14)
// =============================================================================
// `NOTIFICATION_CATALOG`a yayılır (tek katalog; ayrı dosya yalnız boyut içindir). Kaynaklar (tek yayma noktaları)
// `services/notification-sources/satis.ts`; özet türleri `jobs/notification-digest.job.ts`. OLAY türlerinde
// birleştirme anahtarı = tür + kayıt (`tekilKalibi`), pencere 10 dk (K3). `{kullanici}` emit helper'ı aktörden doldurur (K4).
// Yük tutar taşımaz (fiyat değişimi metinde yalnız "fiyat" sözcüğüyle geçer).
// =============================================================================
import { TERIM } from "./terim";
import {
  NOTIFICATION_DEFAULT_CHANNELS as KANAL_VARSAYILAN,
  NOTIFICATION_DEFAULT_RETENTION as SAKLAMA,
  NOTIFICATION_DESKTOP_CHANNELS as KANAL_MASAUSTU,
  type NotificationCatalogEntry,
} from "./notification-catalog.types";

const ORTAK = {
  sinif: "BILDIRIM", altTur: "OLAY", varsayilan: "HERKES", kilit: "YOK",
  kanallar: KANAL_MASAUSTU, varsayilanKanallar: KANAL_VARSAYILAN, saklama: SAKLAMA,
} as const;

const SIPARIS = {
  ...ORTAK, grup: "Sipariş", izinler: [["order:read"]], modul: "cekirdek:siparis-musteri",
  tekilKalibi: "{siparisId}", pencereSn: 600,
  panelEkran: "operations/orders", panelYol: "/operations/orders?focus={siparisId}",
} as const;

const TEKLIF = {
  ...ORTAK, grup: "Satış", izinler: [["quote:read"]], modul: "maliyetEnabled",
  tekilKalibi: "{teklifId}", pencereSn: 600,
  panelEkran: "cost/quotes", panelYol: "/cost/quotes/{teklifId}",
} as const;

const IS_EMRI = {
  ...ORTAK, grup: "Planlama", izinler: [["workorder:read"]], modul: "productionEnabled",
  tekilKalibi: "{isEmriId}", pencereSn: 600,
  panelEkran: "operations/work-orders", panelYol: "/operations/work-orders/{isEmriId}",
} as const;

const ie = (): string => TERIM.terbiyeIsEmri.tekil;
const iek = (): string => TERIM.terbiyeIsEmri.tekilKucuk;

export const SATIS_NOTIFICATION_ENTRIES = {
  // ── Sipariş ───────────────────────────────────────────────────────────────
  "siparis.olusturuldu": {
    ...SIPARIS, kod: "siparis.olusturuldu", ad: "Yeni sipariş girildi",
    baslik: "Yeni sipariş: {siparisNo}",
    govde: "{kullanici} yeni sipariş girdi: {musteriAd} · {kalemSayisi} kalem",
    payloadAlanlari: ["siparisId", "siparisNo", "musteriAd", "kalemSayisi", "kullanici"],
    tahminiHaftalik: 25,
  },
  "siparis.degisti": {
    ...SIPARIS, kod: "siparis.degisti", ad: "Sipariş değiştirildi",
    baslik: "Sipariş değişti: {siparisNo}",
    govde: "{kullanici} siparişi değiştirdi: {siparisNo} ({degisiklik})",
    payloadAlanlari: ["siparisId", "siparisNo", "degisiklik", "kullanici"],
    tahminiHaftalik: 15,
  },
  "siparis.termin-degisti": {
    ...SIPARIS, kod: "siparis.termin-degisti", ad: "Sipariş termini değişti",
    baslik: "Termin değişti: {siparisNo}",
    govde: "{kullanici}: {siparisNo} termini {eskiTermin} → {yeniTermin}",
    payloadAlanlari: ["siparisId", "siparisNo", "eskiTermin", "yeniTermin", "kullanici"],
    tahminiHaftalik: 5,
  },
  "siparis.kalem-iptal": {
    ...SIPARIS, kod: "siparis.kalem-iptal", ad: "Sipariş kalemi iptal edildi",
    baslik: "Kalem iptal: {siparisNo}",
    govde: "{kullanici} {siparisNo} siparişinde bir kalemi iptal etti: {kalem}",
    payloadAlanlari: ["siparisId", "siparisNo", "kalem", "kullanici"],
    tahminiHaftalik: 3,
  },
  "siparis.iptal": {
    ...SIPARIS, kod: "siparis.iptal", ad: "Sipariş iptal edildi", onemli: true,
    baslik: "Sipariş iptal edildi: {siparisNo}",
    govde: "{kullanici} siparişi iptal etti: {siparisNo} ({musteriAd})",
    payloadAlanlari: ["siparisId", "siparisNo", "musteriAd", "kullanici"],
    tahminiHaftalik: 2,
  },
  "siparis.tamamlandi": {
    ...SIPARIS, kod: "siparis.tamamlandi", ad: "Sipariş tamamlandı",
    baslik: "Sipariş tamamlandı: {siparisNo}",
    govde: "{siparisNo} ({musteriAd}) tamamlandı · {kullanici}",
    payloadAlanlari: ["siparisId", "siparisNo", "musteriAd", "kullanici"],
    tahminiHaftalik: 20,
  },
  "siparis.gunluk-ozet": {
    ...SIPARIS, kod: "siparis.gunluk-ozet", ad: "Günlük sipariş özeti", ozet: "GUN_SONU",
    tekilKalibi: "{gun}", pencereSn: 0, panelYol: "/operations/orders",
    baslik: "Günlük sipariş özeti · {gun}",
    govde: "{yeni} yeni sipariş ({kalem} kalem) · {tamamlanan} tamamlandı · {iptal} iptal",
    payloadAlanlari: ["gun", "yeni", "kalem", "tamamlanan", "iptal"],
    tahminiHaftalik: 7,
  },

  // ── Teklif ────────────────────────────────────────────────────────────────
  "teklif.olusturuldu": {
    ...TEKLIF, kod: "teklif.olusturuldu", ad: "Teklif hazırlandı",
    baslik: "Yeni teklif: {teklifNo}",
    govde: "{kullanici} teklif hazırladı: {teklifNo} · {musteriAd}",
    payloadAlanlari: ["teklifId", "teklifNo", "musteriAd", "kullanici"],
    tahminiHaftalik: 10,
  },
  "teklif.gonderildi": {
    ...TEKLIF, kod: "teklif.gonderildi", ad: "Teklif gönderildi",
    baslik: "Teklif gönderildi: {teklifNo}",
    govde: "{kullanici} teklifi gönderdi: {teklifNo} · {musteriAd}",
    payloadAlanlari: ["teklifId", "teklifNo", "musteriAd", "kullanici"],
    tahminiHaftalik: 8,
  },
  "teklif.kabul": {
    ...TEKLIF, kod: "teklif.kabul", ad: "Teklif kabul edildi", onemli: true,
    baslik: "Teklif kabul edildi: {teklifNo}",
    govde: "{musteriAd} teklifi kabul etti: {teklifNo} · {kullanici}",
    payloadAlanlari: ["teklifId", "teklifNo", "musteriAd", "kullanici"],
    tahminiHaftalik: 4,
  },
  "teklif.red": {
    ...TEKLIF, kod: "teklif.red", ad: "Teklif reddedildi",
    baslik: "Teklif reddedildi: {teklifNo}",
    govde: "{musteriAd} teklifi reddetti: {teklifNo} ({sebep}) · {kullanici}",
    payloadAlanlari: ["teklifId", "teklifNo", "musteriAd", "sebep", "kullanici"],
    tahminiHaftalik: 3,
  },

  // ── Planlama / İş emri ────────────────────────────────────────────────────
  "isemri.acildi": {
    ...IS_EMRI, kod: "isemri.acildi", get ad() { return `${ie()} açıldı`; },
    get baslik() { return `Yeni ${iek()}: {isEmriNo}`; },
    get govde() { return `{kullanici} ${iek()} açtı: {isEmriNo} · {urunAd}`; },
    payloadAlanlari: ["isEmriId", "isEmriNo", "urunAd", "kullanici"],
    tahminiHaftalik: 30,
  },
  "isemri.baslatildi": {
    ...IS_EMRI, kod: "isemri.baslatildi", get ad() { return `${ie()} başladı`; },
    get baslik() { return `${ie()} başladı: {isEmriNo}`; },
    govde: "{isEmriNo} üretime alındı · {kullanici}",
    payloadAlanlari: ["isEmriId", "isEmriNo", "kullanici"],
    tahminiHaftalik: 30,
  },
  "isemri.tamamlandi": {
    ...IS_EMRI, kod: "isemri.tamamlandi", get ad() { return `${ie()} tamamlandı`; },
    get baslik() { return `${ie()} tamamlandı: {isEmriNo}`; },
    govde: "{isEmriNo} tamamlandı · {kullanici}",
    payloadAlanlari: ["isEmriId", "isEmriNo", "kullanici"],
    tahminiHaftalik: 30,
  },
  "isemri.iptal": {
    ...IS_EMRI, kod: "isemri.iptal", get ad() { return `${ie()} iptal edildi`; }, onemli: true,
    get baslik() { return `${ie()} iptal edildi: {isEmriNo}`; },
    govde: "{kullanici} {isEmriNo} kaydını iptal etti",
    payloadAlanlari: ["isEmriId", "isEmriNo", "kullanici"],
    tahminiHaftalik: 3,
  },
  "isemri.rota-degisti": {
    ...IS_EMRI, kod: "isemri.rota-degisti", get ad() { return `${ie()} rotası değişti`; },
    get baslik() { return `Rota değişti: {isEmriNo}`; },
    govde: "{kullanici}: {isEmriNo} rotası {eskiRota} → {yeniRota}",
    payloadAlanlari: ["isEmriId", "isEmriNo", "eskiRota", "yeniRota", "kullanici"],
    tahminiHaftalik: 4,
  },
  "planlama.vardiya-ozet": {
    ...IS_EMRI, kod: "planlama.vardiya-ozet", ad: "Vardiya sonu planlama özeti", ozet: "VARDIYA",
    tekilKalibi: "{vardiyaId}", pencereSn: 0, panelYol: "/operations/work-orders",
    baslik: "Vardiya sonu · {vardiyaAd}",
    get govde() { return `{acilan} ${iek()} açıldı · {baslayan} başladı · {biten} tamamlandı`; },
    payloadAlanlari: ["vardiyaId", "vardiyaAd", "acilan", "baslayan", "biten"],
    tahminiHaftalik: 14,
  },
} as const satisfies Record<string, NotificationCatalogEntry>;
