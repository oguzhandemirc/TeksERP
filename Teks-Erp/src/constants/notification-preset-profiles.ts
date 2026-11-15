// =============================================================================
// HAZIR BİLDİRİM PROFİLLERİ — katalogdan TÜREYEN tür kümeleri (2026-11-15)
// =============================================================================
// Tür listesi elle yazılmaz: her profil katalog satırının grup / `onemli` / `ozet` / sınıf alanından bir YÜKLEMDİR;
// yeni tür eklenince kendiliğinden doğru profile girer. Her profil ALARM sınıfını içerir (onay isteyen sınıf susmaz).
// Departman haritası her katalog grubunu TAM BİR departman profiline bağlar (`test_bildirim_profil` §1 ölçer).
// =============================================================================
import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_KINDS,
  type NotificationCatalogEntry,
  type NotificationGrup,
  type NotificationKind,
} from "./notification-catalog";

export const PRESET_PROFILE_CODES = ["HEPSI", "ONEMLI", "OZETLER", "URETIM", "SATIS_SEVKIYAT", "FINANS", "GUVENLIK", "SESSIZ"] as const;
export type PresetProfileCode = (typeof PRESET_PROFILE_CODES)[number];

type DepartmentCode = Extract<PresetProfileCode, "URETIM" | "SATIS_SEVKIYAT" | "FINANS" | "GUVENLIK">;

/** Grup → departman profili. `Record` tam olmalı: yeni grup eklenince derleme düşer. */
export const PRESET_DEPARTMENT_GROUPS: Readonly<Record<NotificationGrup, DepartmentCode>> = {
  "Üretim": "URETIM", "Dokuma": "URETIM", "Kalite": "URETIM", "Bakım": "URETIM", "Planlama": "URETIM", "Personel": "URETIM",
  "Sipariş": "SATIS_SEVKIYAT", "Satış": "SATIS_SEVKIYAT", "Sevkiyat": "SATIS_SEVKIYAT", "Fason": "SATIS_SEVKIYAT",
  "Stok": "SATIS_SEVKIYAT", "Depo": "SATIS_SEVKIYAT", "Mal Kabul": "SATIS_SEVKIYAT", "Satınalma": "SATIS_SEVKIYAT",
  "Ana Veri": "SATIS_SEVKIYAT",
  "Finans": "FINANS",
  "Yetki": "GUVENLIK", "Sistem": "GUVENLIK",
};

const isAlarm = (e: NotificationCatalogEntry) => e.sinif === "ALARM";
const isImportant = (e: NotificationCatalogEntry) => e.onemli === true || isAlarm(e);
const inDepartment = (d: DepartmentCode) => (e: NotificationCatalogEntry) => PRESET_DEPARTMENT_GROUPS[e.grup] === d;

export interface PresetProfile {
  kod: PresetProfileCode;
  ad: string;
  aciklama: string;
  includes: (e: NotificationCatalogEntry) => boolean;
}

export const PRESET_PROFILES: readonly PresetProfile[] = [
  { kod: "HEPSI", ad: "Her şey", aciklama: "Görebildiğiniz bütün bildirimler.", includes: () => true },
  { kod: "ONEMLI", ad: "Yalnız önemliler", aciklama: "Alarmlar ve önemli işaretli bildirimler.", includes: isImportant },
  {
    kod: "OZETLER", ad: "Özetler", aciklama: "Günlük, vardiya ve haftalık özetler; önemliler anında gelir.",
    includes: (e) => e.ozet !== undefined || isImportant(e),
  },
  {
    kod: "URETIM", ad: "Üretim", aciklama: "Üretim, dokuma, kalite, bakım ve planlama; önemliler de gelir.",
    includes: (e) => inDepartment("URETIM")(e) || isImportant(e),
  },
  {
    kod: "SATIS_SEVKIYAT", ad: "Satış ve sevkiyat", aciklama: "Sipariş, satış, sevkiyat, fason, depo ve mal kabul; önemliler de gelir.",
    includes: (e) => inDepartment("SATIS_SEVKIYAT")(e) || isImportant(e),
  },
  {
    kod: "FINANS", ad: "Finans", aciklama: "Tahsilat, ödeme, fatura, vade, cari ve maliyet; önemliler de gelir.",
    includes: (e) => inDepartment("FINANS")(e) || isImportant(e),
  },
  {
    kod: "GUVENLIK", ad: "Güvenlik", aciklama: "Yetki, giriş, cihaz ve sistem bildirimleri.",
    includes: (e) => inDepartment("GUVENLIK")(e) || isAlarm(e),
  },
  { kod: "SESSIZ", ad: "Sessiz", aciklama: "Yalnız alarmlar; kilitli bildirimler zaten kapanmaz.", includes: isAlarm },
];

export function getPresetProfile(kod: string): PresetProfile | undefined {
  return PRESET_PROFILES.find((p) => p.kod === kod);
}

/** Profilin tam (görme süzgeçsiz) tür kümesi, katalog sırasıyla. */
export function presetKinds(p: PresetProfile): NotificationKind[] {
  return NOTIFICATION_KINDS.filter((k) => p.includes(NOTIFICATION_CATALOG[k] as NotificationCatalogEntry));
}
