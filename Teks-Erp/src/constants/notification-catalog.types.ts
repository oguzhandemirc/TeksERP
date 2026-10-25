// Bildirim kataloğunun TÜR TANIMLARI — katalog satırları `notification-catalog.ts`te; ithal edenler
// türleri oradan almaya devam eder (yeniden dışa aktarım). Ayrı dosya: katalog satır tavanında kalsın.

import type { z } from "zod";
import type { PERMISSION_CATALOG } from "./permission-catalog";
import type { EkranModul } from "./screen-catalog";

/** Katalogdaki izin kodları — yazım hatası DERLEMEDE düşer. */
export type IzinKodu = (typeof PERMISSION_CATALOG)[number]["code"];

export type NotificationSinif = "ALARM" | "BILDIRIM";
/** OLAY bir kez olur; KOSUL durum sürdükçe TEK kayıttır ve düzelince "çözüldü" olur. ALARM'da `null`. */
export type NotificationAltTur = "OLAY" | "KOSUL";
export type NotificationGrup =
  | "Sipariş" | "Üretim" | "Kalite" | "Sevkiyat" | "Fason" | "Stok" | "Finans" | "Dokuma" | "Sistem";
/** HER_ZAMAN: uygulama kanalı kapatılamaz (ertelenir) · NOBETTE: yalnız nöbetteki alıcıya kilitli. */
export type NotificationKilit = "YOK" | "HER_ZAMAN" | "NOBETTE";
export type NotificationKanal = "UYGULAMA" | "OZET" | "MASAUSTU" | "TABLET_SES" | "PATRON_PUSH";
/** Outbox aşaması (N1-SEMA CHECK'iyle aynı küme). KAPANDI → `cozuldu` şablonu. */
export const NOTIFICATION_PHASES = ["OLAY", "ACILDI", "KAPANDI", "GUNCELLENDI"] as const;
export type NotificationPhase = (typeof NOTIFICATION_PHASES)[number];

export const NOTIFICATION_GRUPLARI: readonly NotificationGrup[] = [
  "Sipariş", "Üretim", "Kalite", "Sevkiyat", "Fason", "Stok", "Finans", "Dokuma", "Sistem",
];

/** Gelen kutusu TELEMETRİDİR (defter değil): budama süreleri (B2). */
export interface NotificationSaklama {
  okunmusGun: number;
  okunmamisGun: number;
}

export interface NotificationCatalogEntry {
  /** Anahtarın kendisi (`<alan>.<tür>`); bekçi eşitliği ölçer. */
  kod: string;
  /** Ayarlar ekranındaki sabit ad (yer tutucusuz). */
  ad: string;
  sinif: NotificationSinif;
  altTur: NotificationAltTur | null;
  grup: NotificationGrup;
  /** DNF: iç dizinin TAMAMI, dış dizinin HERHANGİ BİRİ. */
  izinler: readonly (readonly IzinKodu[])[];
  /** SCREEN_CATALOG `panelEkran` satırının modülü (bekçi §2). */
  modul: EkranModul;
  /** Ek görme kapısı (ör. tezgah alarmı çözücüsü); görme süzgeci ad üstünden çözer. */
  kapi?: "tezgahAlarm";
  /** subjectKey kalıbı, `{alan}` yer tutuculu; birleştirme anahtarı bundan türer (plan §3.6). */
  tekilKalibi: string;
  /** OLAY birleştirme penceresi (sn); 0 = pencere yok. */
  pencereSn: number;
  /** HERKES = görebilen herkes; izin listesi = bunlardan birini taşıyan; KAPALI = kimse (tercihle açılır). */
  varsayilan: "HERKES" | "KAPALI" | readonly IzinKodu[];
  kilit: NotificationKilit;
  /** Kilitli türde "Neden kilitli" açıklaması (UI). */
  kilitGerekcesi?: string;
  kanallar: readonly NotificationKanal[];
  varsayilanKanallar: readonly NotificationKanal[];
  baslik: string;
  govde: string;
  /** KOSUL ve ALARM'da kapanış metni. */
  cozuldu?: string;
  /** SCREEN_CATALOG masaüstü anahtarı. */
  panelEkran: string;
  /** Derin bağlantı; `/`+panelEkran altında, `{alan}` yer tutuculu. */
  panelYol: string;
  /** SCREEN_CATALOG mobil anahtarı (tablet gelen kutusu/şerit uygunluğu). */
  tabletEkran?: string;
  /** Tablet navigasyon rotası (ekranın içindeki detay). */
  tabletRota?: string;
  /** Eşik/param şeması; `.strict()` + her alan varsayılanlı (bekçi §7). */
  paramSemasi?: z.ZodType;
  /** Şablon yer tutucularının BEYANI (bekçi §5). */
  payloadAlanlari: readonly string[];
  /** Önizleme verisi yokken "haftada ~N" tahmini (Karar Y3). */
  tahminiHaftalik: number;
  saklama: NotificationSaklama;
}
