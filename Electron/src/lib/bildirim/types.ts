// Bildirim gelen kutusu tel tipleri — backend `services/notification-inbox.service.ts` (`toItem`, `inboxSummary`,
// `visibleCatalog`) ile birebir. Alan adları Türkçe çünkü uç sözleşmesi öyle (plan §5.6 F1).

export type NotificationClass = "ALARM" | "BILDIRIM";
export type NotificationSubtype = "OLAY" | "KOSUL" | null;
export type NotificationGroup = "Sipariş" | "Üretim" | "Kalite" | "Sevkiyat" | "Fason" | "Stok" | "Finans" | "Dokuma" | "Sistem";
export type NotificationReason = "IZIN" | "TAKIPCI" | "OLUSTURAN" | "NOBET" | "LISTE" | "ALARM_ALICISI";
/** Sunucunun kabul ettiği sekmeler; `alarmlar` F2 (N2-ALARM) ile açılır. */
export type NotificationTab = "tumu" | "okunmamis" | "alarmlar" | "ertelenen";
export type SnoozeDuration = "1s" | "yarin-sabah" | "shift-sonu";

export interface NotificationItem {
  id: string;
  tur: string;
  sinif: NotificationClass;
  altTur: NotificationSubtype;
  grup: NotificationGroup;
  baslik: string;
  govde: string;
  /** Derin bağlantı (katalog `panelYol`u, yer tutucular doldurulmuş). */
  yol: string;
  konu: { tip: string; id: string };
  sayac: number;
  ilkAn: string;
  sonAn: string;
  neden: NotificationReason | string;
  okunduAn: string | null;
  erteleBitis: string | null;
  cozulduAn: string | null;
}

export interface NotificationListResult {
  items: NotificationItem[];
  nextCursor: string | null;
  /** Liste ile AYNI where'den sayı (özet şeridi). */
  sayi: number;
  epoch: number;
  rev: number;
  alarmRev: number;
}

export type NotificationSummary =
  | { enabled: false }
  | {
      enabled: true; okunmamis: number; alarmAcik: number; epoch: number; rev: number; alarmRev: number;
      /** Süren vardiyanın bitişi (ISO) ya da null; eski backend göndermez → undefined. */
      vardiyaBitis?: string | null;
    };

export interface NotificationWaitResult {
  epoch: number;
  rev: number;
  alarmRev: number;
  degisti: boolean;
}

export interface NotificationCatalogKind {
  kod: string;
  ad: string;
  sinif: NotificationClass;
  altTur: NotificationSubtype;
  grup: NotificationGroup;
  kilit: "YOK" | "HER_ZAMAN" | "NOBETTE";
  kilitGerekcesi: string | null;
  /** Türün gönderildiği kanallar (F1+ sunucu); yoksa yalnız UYGULAMA varsayılır. */
  kanallar?: NotificationChannel[];
  /** Katalogda beyanlı kapsam süzgeçleri (N4-PANEL sunucusu); yoksa/null → süzgeç yok. */
  kapsam?: NotificationScopeDecl | null;
}

/** Katalog kapsam beyanı (`notification-catalog.ts` `kapsam`). */
export interface NotificationScopeDecl {
  yalnizTakip?: boolean;
  istasyonlar?: boolean;
  esik?: Record<string, { alan: string; yon: "ALT" | "UST" }>;
}

/** Kişisel kapsam değeri (sunucu `notificationScopeSchema`; yalnız daraltır). */
export interface NotificationScopeValue {
  yalnizTakip?: boolean;
  istasyonlar?: "BENIM" | string[];
  esik?: Record<string, number>;
}

/** `GET/PUT /ayarlar` — sessiz saat fabrika diliminde "SS:DD". */
export interface NotificationUserSettings {
  sessizBaslangic: string | null;
  sessizBitis: string | null;
  sessizKanallar: Array<"MASAUSTU" | "TABLET_SES" | "PATRON_PUSH">;
  ozetSaati: number | null;
  ses: boolean;
}

/** `POST /tercihler/onizleme` — haftalık tahmin (sunucu hesaplar). */
export interface NotificationPreferencePreview {
  haftalik: number;
  enCok: Array<{ kind: string; sayi: number }>;
  kaynak: "olcum" | "tahmin";
}

/** `POST /tercihler/varsayilana-don/onizleme` satırı. */
export interface NotificationResetRow extends NotificationPreferenceRow {
  ad: string;
}

/** Takip uçlarının kayıt türü (`/takip/:tur/:id`). */
export type FollowRecordType = "siparis" | "is-emri" | "dokuma-isi";

/** F4 tercih katmanı (N4-MOTOR) — sunucunun çözdüğü hücre (`resolvePreference`). */
export type NotificationChannel = "UYGULAMA" | "OZET" | "MASAUSTU" | "TABLET_SES" | "PATRON_PUSH";

export interface NotificationPreferenceCell {
  kind: string;
  kanallar: Array<{ kanal: NotificationChannel; durum: "ACIK" | "KAPALI" | "GIZLI"; kilit: boolean; kaynak: string; kapsam: unknown }>;
}

/** Kişinin kaydedilmiş sapma satırı (`GET /tercihler`.satirlar). */
export interface NotificationPreferenceRow {
  id: string;
  tur: string;
  kanal: NotificationChannel;
  acik: boolean;
  kapsam: unknown;
}

/** `PUT /tercihler` gövde öğesi (tam gövde; sunucu seyrek yazar). */
export interface NotificationPreferenceInput {
  tur: string;
  kanal: NotificationChannel;
  acik: boolean;
  kapsam?: unknown;
}
