import { MODULE_FIELD_BY_SETTING_KEY, MODULE_LABELS } from "@/lib/module-flags";
import type { FingerprintFactor, LicenseClass, LicenseMode, StateTier, Validity } from "@/types/license";

// Lisans ekranının Türkçe etiketleri. Kodlar backend'den (`lib/license/state-rules.ts`
// REASON_CODES, yoklama/zil hata kodları); tanınmayan kod ham hâliyle gösterilir —
// yeni kod eklenince ekran bozulmaz, yalnız çevirisi eksik kalır.

export const TIER_LABEL: Record<StateTier, string> = {
  NORMAL: "Normal",
  UYARI: "Uyarı",
  EK_SURE: "Ek süre",
  KISITLI: "Kısıtlı kip",
  DURDURULMUS: "Durduruldu",
};

export const VALIDITY_LABEL: Record<Validity, string> = {
  GECERLI: "Geçerli",
  GECERSIZ: "Geçersiz",
  OLCULEMEDI: "Ölçülemedi",
};

export const MODE_LABEL: Record<LicenseMode, string> = {
  gozlem: "Gözlem (hiçbir istek engellenmez)",
  zorla: "Zorlama",
};

export const CLASS_LABEL: Record<LicenseClass, string> = {
  URETIM: "Üretim",
  TEST: "Test",
  DR: "Felaket kurtarma (DR)",
  DEMO: "Demo",
  BAYI: "Bayi",
  BARINDIRILAN: "Barındırılan",
};

export const FACTOR_LABEL: Record<FingerprintFactor, string> = {
  f1: "İşletim sistemi kimliği",
  f2: "Donanım (SMBIOS) kimliği",
  f3: "Sistem diski",
  f4: "Sistem / anakart seri no",
  f5: "Veritabanı kimliği",
};

const REASON_LABEL: Record<string, string> = {
  HAK_YOK: "Lisans hakkı yok",
  HAK_GECERSIZ: "Lisans hakkı doğrulanamadı",
  HAK_KURULUM_UYUSMAZ: "Lisans hakkı başka bir kuruluma ait",
  KIRA_YOK: "Kira yok (kurulum etkinleşmemiş)",
  KIRA_GECERSIZ: "Kira doğrulanamadı",
  KIRA_BAG_UYUSMAZ: "Kira bu kuruluma/hakka bağlı değil",
  PARMAK_IZI_UYUSMAZ: "Makine parmak izi uyuşmuyor",
  PARMAK_IZI_OLCULEMEDI: "Makine parmak izi ölçülemedi",
  BUTUNLUK_GECERSIZ: "Program bütünlüğü bozuk",
  BUTUNLUK_OLCULEMEDI: "Program bütünlüğü ölçülemedi",
  SAAT_ILERI: "Sistem saati ileri",
  SAAT_GERI: "Sistem saati geri",
  DURUM_DOSYASI: "Durum kaydı okunamadı",
  ILK_ACILIS_BILINMIYOR: "İlk açılış tarihi bilinmiyor",
  KIRA_SURESI_DOLDU: "Kira süresi doldu",
  VADE_DOLDU: "Vade doldu",
  KIRASIZ_EK_SURE: "Kirasız ek süre",
  ETKINLESTIRME_EK_SURESI: "Etkinleştirme ek süresi",
  EK_SURE_BITTI: "Ek süre bitti",
  YAPTIRIM: "Satıcı yaptırımı",
  MODUL_DONDURULDU: "Modül donduruldu",
  GUNCELLEME_DONDURULDU: "Güncellemeler donduruldu",
  DEVREDILDI: "Üretim DR sunucusuna devredildi",
  BAKIM_BITIYOR: "Bakım süresi bitiyor",
  BAKIM_BITTI: "Bakım süresi bitti",
  BAKIM_IHLALI: "Bakım sonrası derlenmiş sürüm",
  DERLEME_TARIHI_YOK: "Derleme tarihi yok (bakım değerlendirilmedi)",
};

export const reasonLabel = (kod: string): string => REASON_LABEL[kod] ?? kod;

const FAILURE_LABEL: Record<string, string> = {
  YAPILANDIRILMAMIS: "Lisans sunucusu adresi tanımlı değil",
  GOVDE_KURULAMADI: "Yoklama isteği kurulamadı",
  KIRA_YENILENMEDI: "Sunucu kirayı yenilemedi",
  TASIMA_ONAYI_BEKLIYOR: "Taşıma onayı bekleniyor",
  TASIMA_REDDEDILDI: "Taşıma reddedildi",
  EGRESS_NETWORK: "Ağ hatası (internet/proxy)",
  EGRESS_TIMEOUT: "Zaman aşımı",
  EGRESS_PROXY_UNSUPPORTED: "Bu Node sürümü proxy desteklemiyor",
  EGRESS_URL: "Sunucu adresi geçersiz",
  EGRESS_TOO_LARGE: "Yanıt çok büyük",
  EGRESS_ABORTED: "İstek kesildi",
};

export const failureLabel = (kod: string | null): string | null => (kod ? (FAILURE_LABEL[kod] ?? kod) : null);

/** HAK modül anahtarı (`finance.enabled` · `patron-bulut`) → ekran adı; bilinmeyen anahtar ham. */
export function moduleSettingLabel(key: string): string {
  const field = MODULE_FIELD_BY_SETTING_KEY[key];
  if (field) return MODULE_LABELS[field];
  return key === "patron-bulut" ? "Patron bulutu" : key;
}
