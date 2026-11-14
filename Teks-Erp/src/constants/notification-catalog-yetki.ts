// =============================================================================
// BİLDİRİM KATALOĞU — Yetki / Kullanıcı · Cihaz parça dosyası (S4, 2026-11-14)
// =============================================================================
// `NOTIFICATION_CATALOG`a yayılır. Tek yayma noktaları `services/notification-sources/yetki.ts`. Yük SIR taşımaz:
// parola, PIN, TOTP, kurtarma kodu, cihaz belirteci ne outbox'a ne gelen kutusuna girer (superadmin.md sır hijyeni);
// satıcı hesabı (sistem hesabı) için bildirim üretilmez (takma ad maskesini çürütürdü).
// =============================================================================
import {
  NOTIFICATION_DEFAULT_CHANNELS as KANAL_VARSAYILAN,
  NOTIFICATION_DEFAULT_RETENTION as SAKLAMA,
  NOTIFICATION_DESKTOP_CHANNELS as KANAL_MASAUSTU,
  type NotificationCatalogEntry,
} from "./notification-catalog.types";

const ACCESS = {
  sinif: "BILDIRIM", altTur: "OLAY", varsayilan: "HERKES", kilit: "YOK", pencereSn: 600,
  kanallar: KANAL_MASAUSTU, varsayilanKanallar: KANAL_VARSAYILAN, saklama: SAKLAMA,
  grup: "Yetki", izinler: [["admin:users"]], modul: "cekirdek:sistem-kimlik-belge",
  tekilKalibi: "{hedefId}", panelEkran: "access/users", panelYol: "/access/users",
} as const;

export const YETKI_NOTIFICATION_ENTRIES = {
  "yetki.kullanici-olusturuldu": {
    ...ACCESS, kod: "yetki.kullanici-olusturuldu", ad: "Yeni kullanıcı açıldı", onemli: true,
    baslik: "Yeni kullanıcı: {hedefAd}",
    govde: "{kullanici} {hedefAd} ({hedefKullaniciAdi}) hesabını açtı",
    payloadAlanlari: ["hedefId", "hedefAd", "hedefKullaniciAdi", "kullanici"],
    tahminiHaftalik: 1,
  },
  "yetki.kullanici-pasif": {
    ...ACCESS, kod: "yetki.kullanici-pasif", ad: "Kullanıcı pasife alındı",
    baslik: "Kullanıcı pasife alındı: {hedefAd}",
    govde: "{kullanici} {hedefAd} hesabını pasife aldı; açık oturumları kapandı",
    payloadAlanlari: ["hedefId", "hedefAd", "kullanici"],
    tahminiHaftalik: 0.5,
  },
  "yetki.yetki-degisti": {
    ...ACCESS, kod: "yetki.yetki-degisti", ad: "Kullanıcının yetkileri değişti",
    baslik: "Yetkiler değişti: {hedefAd}",
    govde: "{kullanici} {hedefAd} hesabında {eklenen} yetki ekledi, {cikarilan} yetki kaldırdı",
    payloadAlanlari: ["hedefId", "hedefAd", "eklenen", "cikarilan", "kullanici"],
    tahminiHaftalik: 2,
  },
  "yetki.izin-verildi": {
    ...ACCESS, kod: "yetki.izin-verildi", ad: "Kritik yetki verildi", onemli: true,
    baslik: "Kritik yetki verildi: {hedefAd}",
    govde: "{kullanici} {hedefAd} hesabına kritik yetki verdi: {kodlar}",
    payloadAlanlari: ["hedefId", "hedefAd", "kodlar", "kullanici"],
    tahminiHaftalik: 0.3,
  },
  "yetki.parola-sifirlandi": {
    ...ACCESS, kod: "yetki.parola-sifirlandi", ad: "Kullanıcı parolası sıfırlandı", onemli: true,
    baslik: "Parola sıfırlandı: {hedefAd}",
    govde: "{kullanici} {hedefAd} hesabının parolasını sıfırladı; hatırlanan cihazlar iptal edildi",
    payloadAlanlari: ["hedefId", "hedefAd", "kullanici"],
    tahminiHaftalik: 0.5,
  },
  "yetki.iki-adim-sifirlandi": {
    ...ACCESS, kod: "yetki.iki-adim-sifirlandi", ad: "İki adımlı doğrulama sıfırlandı", onemli: true,
    baslik: "İki adımlı doğrulama sıfırlandı: {hedefAd}",
    govde: "{kullanici} {hedefAd} hesabının iki adımlı doğrulamasını kaldırdı; yeniden kurulması gerekir",
    payloadAlanlari: ["hedefId", "hedefAd", "kullanici"],
    tahminiHaftalik: 0.2,
  },
  "cihaz.onay-bekliyor": {
    ...ACCESS, grup: "Sistem", izinler: [["admin:settings"]],
    // Sabit kalıp: public announce ucundan art arda gelen yeni cihazlar 10 dk'da tek satırda birleşir (K3).
    tekilKalibi: "onay-bekleyen-cihaz", panelEkran: "access/devices", panelYol: "/access/devices",
    kod: "cihaz.onay-bekliyor", ad: "Yeni cihaz onay bekliyor", onemli: true,
    baslik: "Yeni cihaz onay bekliyor",
    govde: "{cihazAd} ({cihazTuru}) eşleşme için yönetici onayı bekliyor",
    payloadAlanlari: ["cihazAd", "cihazTuru"],
    tahminiHaftalik: 1,
  },
} as const satisfies Record<string, NotificationCatalogEntry>;
