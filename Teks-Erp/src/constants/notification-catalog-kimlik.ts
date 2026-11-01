// Kimlik/cihaz bildirimleri — ana katalogdan dosya boyu için ayrıldı (2026-11-01); sıra katalogdakiyle aynı.
import { NOTIFICATION_DEFAULT_RETENTION as SAKLAMA, NOTIFICATION_DESKTOP_CHANNELS as KANAL_MASAUSTU, type NotificationCatalogEntry } from "./notification-catalog.types";

export const KIMLIK_NOTIFICATION_ENTRIES = {
  "cihaz.halka-kaybi": {
    kod: "cihaz.halka-kaybi", ad: "Cihaz anahtar halkası kayıp",
    sinif: "BILDIRIM", altTur: "KOSUL", grup: "Sistem",
    izinler: [["admin:settings"]],
    modul: "cekirdek:sistem-kimlik-belge",
    // Konu kurulumun TEK halkasıdır: kayıp sürdükçe tek kayıt; emanet geri konunca kapanır.
    tekilKalibi: "halka",
    pencereSn: 0, varsayilan: "HERKES", kilit: "YOK",
    kanallar: KANAL_MASAUSTU,
    varsayilanKanallar: ["UYGULAMA"],
    baslik: "Cihaz anahtarı kayıp: {cihazSayisi} cihaz doğrulanamıyor",
    govde: "Anahtar halkası yeniden üretildi. Yedekten anahtarı geri yükleyin ya da cihazları yeniden bağlayın.",
    cozuldu: "Cihaz anahtar halkası sorunu giderildi",
    panelEkran: "access/devices", panelYol: "/access/devices?kanit=1",
    payloadAlanlari: ["cihazSayisi"],
    tahminiHaftalik: 0.01, saklama: SAKLAMA,
  },
  "kimlik.yeni-cihaz-girisi": {
    kod: "kimlik.yeni-cihaz-girisi", ad: "İnternetten yeni cihazla giriş",
    sinif: "BILDIRIM", altTur: "OLAY", grup: "Sistem",
    // Alıcı: girişi yapan kişi + kullanıcı yöneticileri (`notification-sources/kimlik.ts` çözücüsü);
    // web:access sahiplerinin geri kalanı ALMAZ — görme süzgeci kişinin kendi satırını görmesi içindir.
    izinler: [["admin:users"], ["web:access"]],
    screenlessViewers: {
      permissions: ["web:access"],
      reason: "Girişi yapan kişi kendi hesabına yapılan internet girişini görür; cihazlarını Kullanıcı Tercihleri'nden yönetir.",
    },
    modul: "cekirdek:sistem-kimlik-belge",
    // Aynı kişinin 10 dk içindeki tanınmayan girişleri tek satırda birleşir.
    tekilKalibi: "{kullaniciId}",
    pencereSn: 600, varsayilan: "HERKES", kilit: "YOK",
    kanallar: KANAL_MASAUSTU,
    varsayilanKanallar: ["UYGULAMA"],
    baslik: "{kullanici} yeni bir cihazdan internetten giriş yaptı",
    govde: "{tarayici} · IP {ip} · {saat}",
    panelEkran: "access/users", panelYol: "/access/users",
    payloadAlanlari: ["kullaniciId", "kullanici", "tarayici", "ip", "saat"],
    tahminiHaftalik: 2, saklama: SAKLAMA,
  },
  "kimlik.supheli-giris-denemesi": {
    kod: "kimlik.supheli-giris-denemesi", ad: "Hesaba yoğun hatalı giriş denemesi",
    sinif: "BILDIRIM", altTur: "OLAY", grup: "Sistem",
    // Alıcı: hesabın sahibi + kullanıcı yöneticileri (`notification-sources/kimlik.ts` çözücüsü).
    izinler: [["admin:users"], ["web:access"]],
    screenlessViewers: {
      permissions: ["web:access"],
      reason: "Hesabın sahibi kendi hesabına yapılan yoğun deneme uyarısını görür; parolasını Kullanıcı Tercihleri'nden değiştirir.",
    },
    modul: "cekirdek:sistem-kimlik-belge",
    // Hesap başına saatte en çok bir uyarı (kaynak eşiği zaten saatte bir yayar); pencere ikinci bir sed.
    tekilKalibi: "{kullaniciId}",
    pencereSn: 3600, varsayilan: "HERKES", kilit: "YOK",
    kanallar: KANAL_MASAUSTU,
    varsayilanKanallar: ["UYGULAMA"],
    baslik: "{kullanici} hesabına son 1 saatte {hataSayisi} hatalı giriş denemesi",
    govde: "{kaynakSayisi} farklı adresten · {saat}. Tanımadığınız bir deneme ise parolayı değiştirin ve iki adımlı doğrulamayı açın.",
    panelEkran: "access/users", panelYol: "/access/users",
    payloadAlanlari: ["kullaniciId", "kullanici", "hataSayisi", "kaynakSayisi", "saat"],
    tahminiHaftalik: 0.1, saklama: SAKLAMA,
  },
} as const satisfies Record<string, NotificationCatalogEntry>;
