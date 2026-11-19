// =============================================================================
// BİLDİRİM KATALOĞU — Satış · Sipariş · Teklif · Planlama parça dosyası (S1, geniş katalog 2026-11-14)
// =============================================================================
// `NOTIFICATION_CATALOG`a yayılır (tek katalog; ayrı dosya yalnız boyut içindir). Kaynaklar (tek yayma noktaları)
// `services/notification-sources/satis.ts`; özet türleri `jobs/notification-digest.job.ts`. OLAY türlerinde
// birleştirme anahtarı = tür + kayıt (`tekilKalibi`), pencere 10 dk (K3). `{kullanici}` emit helper'ı aktörden doldurur (K4).
// Yük tutar taşımaz (fiyat değişimi metinde yalnız "fiyat" sözcüğüyle geçer).
// =============================================================================
import { z } from "zod";
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
    govde: "{kullanici} yeni sipariş girdi: {musteriAd} · {kalemSayisi} kalem · {miktar}",
    payloadAlanlari: ["siparisId", "siparisNo", "musteriAd", "kalemSayisi", "miktar", "kullanici"],
    tahminiHaftalik: 25,
  },
  // S6a: doğuşta canlı MT kalemlerin toplamı eşiği (`metre`) aşınca; ölçü METRE (kullanıcı kararı: tutar yok).
  "siparis.buyuk-siparis": {
    ...SIPARIS, kod: "siparis.buyuk-siparis", ad: "Büyük sipariş girildi", onemli: true,
    baslik: "Büyük sipariş: {siparisNo}",
    govde: "{musteriAd} için {metre} m sipariş girildi (eşik {esik} m) · {kalemSayisi} kalem · {kullanici}",
    payloadAlanlari: ["siparisId", "siparisNo", "musteriAd", "metre", "esik", "kalemSayisi", "kullanici"],
    paramSemasi: z.object({ metre: z.number().min(1).max(10_000_000).default(5000) }).strict(),
    tahminiHaftalik: 2,
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
    govde: "{kullanici} siparişi iptal etti: {siparisNo} ({musteriAd}) · {miktar}",
    payloadAlanlari: ["siparisId", "siparisNo", "musteriAd", "miktar", "kullanici"],
    tahminiHaftalik: 2,
  },
  "siparis.tamamlandi": {
    ...SIPARIS, kod: "siparis.tamamlandi", ad: "Sipariş tamamlandı",
    baslik: "Sipariş tamamlandı: {siparisNo}",
    govde: "{siparisNo} ({musteriAd}) tamamlandı · {miktar} · {kullanici}",
    payloadAlanlari: ["siparisId", "siparisNo", "musteriAd", "miktar", "kullanici"],
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
  // Birleşik gün sonu (2026-11-19): sayılar alan özetlerinin AYNI sayım fonksiyonlarından (`notification-sources/gun-sonu-ozeti.ts`);
  // pencere saati `bildirim.gunSonuOzeti.saat` (00:00 = biten fabrika günü). Varsayılan KAPALI: alan özetleri zaten gelir, tercihle açılır.
  "genel.gun-sonu-ozeti": {
    ...ORTAK, grup: "Sipariş", izinler: [["report:sales"]], modul: "cekirdek:siparis-musteri",
    kod: "genel.gun-sonu-ozeti", ad: "Gün sonu özeti (sipariş · üretim · sevk · depo · fason)", ozet: "GUN_SONU",
    varsayilan: "KAPALI", tekilKalibi: "{gun}", pencereSn: 0,
    panelEkran: "reports/sales", panelYol: "/reports/sales",
    baslik: "Gün sonu özeti · {gun} ({aralik})",
    govde: "{siparis} yeni sipariş · üretim {uretimTop} top, {uretimMetre} m · sevk {sevkTop} top, {sevkMetre} m · depoya {girisTop} top girdi · fason {fasonCikis} çıkış, {fasonDonus} dönüş",
    payloadAlanlari: ["gun", "aralik", "siparis", "uretimTop", "uretimMetre", "sevkTop", "sevkMetre", "girisTop", "fasonCikis", "fasonDonus"],
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

  "teklif.suresi-doldu": {
    ...TEKLIF, kod: "teklif.suresi-doldu", ad: "Teklifin geçerlilik süresi doldu", altTur: "KOSUL", pencereSn: 0,
    baslik: "Teklif süresi doldu: {teklifNo}",
    govde: "{teklifNo} ({musteriAd}) {gecerlilik} tarihinde geçerliliğini yitirdi, müşteri cevap vermedi",
    cozuldu: "{teklifNo} cevaplandı, revize edildi ya da kapandı",
    payloadAlanlari: ["teklifId", "teklifNo", "musteriAd", "gecerlilik"],
    tahminiHaftalik: 2,
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
  // S6a: kurşun kuyruğunda adımın acil rozeti KAPALI→AÇIK geçişi (`setQueueUrgent`); yeniden işaretleme bildirmez.
  "isemri.acil-isaretlendi": {
    ...IS_EMRI, kod: "isemri.acil-isaretlendi", get ad() { return `${ie()} acil işaretlendi`; }, onemli: true,
    baslik: "Acil: {isEmriNo}",
    govde: "{kullanici} {isEmriNo} kaydını {istasyonAd} kuyruğunda acil işaretledi",
    payloadAlanlari: ["isEmriId", "isEmriNo", "istasyonAd", "kullanici"],
    tahminiHaftalik: 5,
  },
  // S6a (genel fason F9): yeniden işlem sebepli iş emri doğunca; sınıf İE'de DONMUŞ `reworkBillable`dan.
  "fason.yeniden-islem": {
    ...IS_EMRI, grup: "Fason", kod: "fason.yeniden-islem", ad: "Yeniden işlem açıldı", onemli: true,
    baslik: "Yeniden işlem: {isEmriNo}",
    govde: "{kullanici} yeniden işlem açtı: {isEmriNo} · sebep: {sebep} ({sinif})",
    payloadAlanlari: ["isEmriId", "isEmriNo", "sebep", "sinif", "kullanici"],
    tahminiHaftalik: 2,
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
