import type { CloudAccount, CloudIneligibleReason, CloudUrlSource } from "./service";

/** Ön koşulun (fail-closed) neden düştüğü — kullanıcıya ne eksik olduğunu söyler. */
export const INELIGIBLE_LABELS: Record<CloudIneligibleReason, string> = {
  HAZIR_DEGIL: "Lisans motoru henüz hazır değil.",
  HAK_YOK: "Bu kurulumun lisans hakkı yok.",
  KIRA_YOK: "Geçerli lisans kirası yok.",
  SINIF_GONDEREMEZ: "Lisans sınıfı buluta gönderemez (yalnız üretim kurulumu gönderir).",
  MODUL_YOK: "Lisansta patron bulutu hakkı yok.",
  ABONELIK_BITTI: "Patron bulutu aboneliği tanımlı değil ya da bitti.",
  DEVREDILDI: "Bu kurulum devredildi; bulut bağlantısı yeni kurulumdadır.",
  ARALIK_YOK: "Eşitleme kapalı (lisans kirasında aralık tanımsız).",
};

export const URL_SOURCE_LABELS: Record<CloudUrlSource, string> = {
  kapali: "Bulut adresi tanımlı değil (sunucu ayarı PATRON_BULUT_URL).",
  gecersiz: "Bulut adresi geçersiz (yalnız https kökü kabul edilir).",
  ortam: "Bulut adresi tanımlı.",
};

export const ACCOUNT_STATE_LABELS: Record<CloudAccount["durum"], string> = {
  AKTIF: "Aktif",
  KILITLI: "Kilitli",
  PASIF: "Pasif",
};

const RUN_OUTCOME_LABELS: Record<string, string> = {
  BASARILI: "Başarılı",
  BASARISIZ: "Başarısız",
  KAPALI: "Ön koşul yok",
  ADRES_YOK: "Bulut adresi yok",
  TEKNIK_KULLANICI_YOK: "Etkinleştirilmemiş",
  LISANS_KISITLI: "Lisans kısıtlı kipte — kayıtlar bulutta bekliyor",
  MESGUL: "Meşgul",
};

/** `KAPALI:MODUL_YOK` biçimindeki tur sonucunu Türkçe cümleye çevirir. */
export function runOutcomeLabel(outcome: string): string {
  const [head, reason] = outcome.split(":");
  const base = RUN_OUTCOME_LABELS[head ?? ""] ?? outcome;
  const why = reason ? INELIGIBLE_LABELS[reason as CloudIneligibleReason] : undefined;
  return why ? `${base} — ${why}` : base;
}

export const stamp = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString("tr-TR") : "—");
