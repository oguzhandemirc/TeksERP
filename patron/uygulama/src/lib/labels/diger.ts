// "Diğer" bölümünün sözlükleri: gelen kutusu türleri, hesap şablonları, cihaz platformları, bildirim türleri ve atlama
// nedenleri. Tip `Record<…>` olduğundan teldeki (`api/wire.ts`) birleşime yeni değer eklenince derleme kırılır;
// bekçi `__tests__/labels.test.ts` §2. Ekrana ham enum yazılmaz — bilinmeyen değer `lookup` ile ham döner.
import type { InboxItemKind, NotificationKind } from "../../api/wire";
import type { IconName } from "../../ui/icons";
import type { Domain } from "../../ui/tokens";

export interface KindLabel {
  readonly ad: string;
  readonly domain: Domain;
  readonly icon: IconName;
}

export const INBOX_KIND: Readonly<Record<InboxItemKind, KindLabel>> = {
  SIPARIS: { ad: "Sipariş talebi", domain: "siparisler", icon: "receipt-outline" },
  CARI: { ad: "Yeni cari talebi", domain: "cariler", icon: "person-add-outline" },
};

export function inboxKind(tur: unknown): KindLabel {
  return (typeof tur === "string" ? (INBOX_KIND as Readonly<Record<string, KindLabel | undefined>>)[tur] : undefined) ?? {
    ad: typeof tur === "string" ? tur : "—",
    domain: "gelenKutusu",
    icon: "mail-outline",
  };
}

/** Hesap şablonları (sunucu `ROLE_TEMPLATES`; kolaylıktır, kaynak değil). */
export type AccountTemplate = "PATRON" | "MUHASEBE" | "SATIS";
export const ACCOUNT_TEMPLATES: readonly AccountTemplate[] = ["PATRON", "MUHASEBE", "SATIS"];
export const ACCOUNT_TEMPLATE: Readonly<Record<AccountTemplate, { readonly ad: string; readonly aciklama: string; readonly icon: IconName }>> = {
  PATRON: { ad: "Tam yetki", aciklama: "Bütün bölümler ve hesap yönetimi", icon: "shield-checkmark-outline" },
  MUHASEBE: { ad: "Muhasebe", aciklama: "Finans, cari bakiyeleri ve raporlar; cari talebi", icon: "calculator-outline" },
  SATIS: { ad: "Satış", aciklama: "Sipariş, sevkiyat, üretim ve stok; fiyatsız; sipariş ve cari talebi", icon: "briefcase-outline" },
};

export const DEVICE_PLATFORM: Readonly<Record<string, { readonly ad: string; readonly icon: IconName }>> = {
  web: { ad: "Tarayıcı", icon: "globe-outline" },
  android: { ad: "Android", icon: "logo-android" },
  ios: { ad: "iPhone / iPad", icon: "logo-apple" },
};

export function devicePlatform(p: unknown): { readonly ad: string; readonly icon: IconName } {
  return (typeof p === "string" ? DEVICE_PLATFORM[p] : undefined) ?? { ad: typeof p === "string" ? p : "—", icon: "phone-portrait-outline" };
}

/** Bildirim türleri: ad sunucudan da gelir (`NotificationKindInfo.ad`); sözlük ikon/alan rengini ve yedek adı verir. */
export const NOTIFICATION_KIND: Readonly<Record<NotificationKind, KindLabel>> = {
  "gelen-kutusu-sonucu": { ad: "Gelen kutusu sonucu", domain: "gelenKutusu", icon: "file-tray-full-outline" },
  "stok-esigi": { ad: "Stok eşiği", domain: "stok", icon: "cube-outline" },
  "geciken-siparis": { ad: "Geciken sipariş", domain: "siparisler", icon: "time-outline" },
  "gunluk-uretim": { ad: "Günlük üretim", domain: "uretim", icon: "construct-outline" },
  "esitleme-gecikti": { ad: "Eşitleme gecikti", domain: "genel", icon: "sync-outline" },
  "yedek-basarisiz": { ad: "Yedek alınamadı", domain: "genel", icon: "server-outline" },
  "cek-vadesi": { ad: "Çek/senet vadesi", domain: "finans", icon: "calendar-outline" },
};

export function notificationKind(tur: unknown): KindLabel {
  return (typeof tur === "string" ? (NOTIFICATION_KIND as Readonly<Record<string, KindLabel | undefined>>)[tur] : undefined) ?? {
    ad: typeof tur === "string" ? tur : "—",
    domain: "genel",
    icon: "notifications-outline",
  };
}

/** Gönderilmeyen bildirimin nedeni (sunucu `atlamaNedeni`). */
export const NOTIFICATION_SKIP: Readonly<Record<string, string>> = {
  BILDIRIM_KAPALI: "bildirimler kapalıydı",
  TUR_KAPALI: "tür kapalıydı",
  IZIN_YOK: "yetki yetmedi",
  HESAP_KAPALI: "hesap kapalı",
  CIHAZ_YOK: "kayıtlı cihaz yoktu",
};
