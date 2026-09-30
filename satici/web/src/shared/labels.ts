// Kod değerlerinin ekran adları (tel değerleri Türkçe kod; ekranda okunur ad).
export const CLASS_LABEL: Record<string, string> = {
  URETIM: "Üretim",
  TEST: "Test / hazırlık",
  DR: "DR / soğuk yedek",
  DEMO: "Demo / deneme",
  BAYI: "Bayi / iş ortağı",
  BARINDIRILAN: "Barındırılan",
};

export const INSTALLATION_STATUS_LABEL: Record<string, string> = {
  ETKINLESMEDI: "Etkinleşmedi",
  ETKIN: "Etkin",
  DEVREDILDI: "Devredildi (DR)",
  IPTAL: "İptal",
};

export const SANCTION_LABEL: Record<string, string> = {
  K0: "K0 · Mesaj bandı",
  K1: "K1 · Güncelleme dondurma",
  K2: "K2 · Modül dondurma",
  K3: "K3 · Süreli kısıtlı kip",
  K4: "K4 · Anında kısıtlı kip",
  K5: "K5 · Anında tam durdurma",
  ZORLAMA: "Kip değişimi (gözlem/zorla)",
  GECERLILIK: "Geçerlilik bitişi",
  GERI_AL: "Geri alma",
};

export const MODULE_LABEL: Record<string, string> = {
  "production.enabled": "Üretim",
  "finance.enabled": "Finans",
  "ticaret.enabled": "Ticaret",
  "iplik.enabled": "İplik",
  "depo.multiEnabled": "Çoklu depo",
  "kumasTeknik.enabled": "Kumaş teknik",
  "tezgah.enabled": "Tezgah",
  "devere.enabled": "Devere",
  "dokuma.enabled": "Dokuma",
  "emanet.enabled": "Emanet",
  "patron-bulut": "Patron bulutu",
};

export const PRODUCTION_MODULE_KEY = "production.enabled";

export const ROLE_LABEL: Record<string, string> = {
  SATICI_YONETICI: "Satıcı yöneticisi",
  SATICI_OPERATOR: "Satıcı operatörü",
  BAYI: "Bayi",
};

export const PLANNED_STATUS_LABEL: Record<string, string> = { BEKLIYOR: "Bekliyor", UYGULANDI: "Uygulandı", IPTAL: "İptal" };
export const TRANSFER_STATUS_LABEL: Record<string, string> = { BEKLIYOR: "Onay bekliyor", ONAYLANDI: "Onaylandı", REDDEDILDI: "Reddedildi" };
export const INSTALLMENT_STATUS_LABEL: Record<string, string> = { BEKLIYOR: "Bekliyor", ODENDI: "Ödendi", GECIKTI: "Gecikti", IPTAL: "İptal" };
export const CODE_STATUS_LABEL: Record<string, string> = { AKTIF: "Aktif", KULLANILDI: "Kullanıldı", IPTAL: "İptal" };
export const COPY_ALERT_LABEL: Record<string, string> = {
  ZINCIR_CATALI: "Kira zinciri çatalı (iki makine)",
  PARMAK_IZI_UYUSMAZ: "Parmak izi uyuşmuyor",
  AYNI_PARMAK_IZI_TEKRAR: "Aynı parmak izi tekrarı (tam kopya şüphesi)",
  YABANCI_KIRA: "Yabancı kira (defterde olmayan kira sunuldu)",
  KIP_UYUSMAZ: "Kip uyuşmuyor (kira/durum silinmiş olabilir)",
};
export const LEASE_DECISION_LABEL: Record<string, string> = {
  ETKINLESTIRME: "Etkinleştirme",
  NORMAL: "Normal",
  YAKALA: "Yakala (geride kalmış uç)",
  CATAL: "Çatal (kopya şüphesi)",
  TASIMA: "Taşıma",
};

/** Bildirim olayları — sunucunun `NOTIFICATION_EVENTS` listesinin HER değeri (ayna: src/test/mirrors.test.ts). */
export const NOTIFICATION_EVENT_LABEL: Record<string, string> = {
  DESTEK_TALEBI: "Yeni destek talebi",
  KOPYA_SUPHESI: "Kopya şüphesi uyarısı",
  KOPYA_KIRA_REDDI: "Kopya şüphesi — kira verilmedi",
  TASIMA_TALEBI: "Taşıma talebi",
  DR_DEVRI: "DR devri",
  KURULUM_SESSIZ: "Kurulum ses vermiyor",
  KIRA_BITISI_YAKLASIYOR: "Kira bitişi yaklaşıyor",
  GECERLILIK_BITISI_YAKLASIYOR: "Geçerlilik bitişi yaklaşıyor",
  TAKSIT_VADESI_YAKLASIYOR: "Taksit vadesi yaklaşıyor",
  PLANLI_EYLEM_UYGULANDI: "Planlı eylem uygulandı",
  TAKSIT_GECIKTI: "Taksit gecikti",
  DENEME: "Deneme bildirimi",
};
export const NOTIFICATION_CHANNEL_LABEL: Record<string, string> = { EPOSTA: "E-posta", TELEGRAM: "Telegram" };
export const NOTIFICATION_STATUS_LABEL: Record<string, string> = {
  BEKLIYOR: "Bekliyor",
  GONDERILIYOR: "Gönderiliyor",
  GONDERILDI: "Gönderildi",
  HATA: "Hata",
  KAPALI: "Kanal kapalı",
};
/** Kanal durumu (sunucu satırların sonucundan türetir). */
export const CHANNEL_HEALTH_LABEL: Record<string, string> = {
  CALISIYOR: "Çalışıyor",
  HATA: "Son gönderim hatalı",
  YAPILANDIRILMAMIS: "Kanal yapılandırılmamış",
  GONDERICI_YANITSIZ: "Gönderici yanıt vermiyor",
  BILINMIYOR: "Henüz bildirim yok",
};

export function label(map: Record<string, string>, v: string | null | undefined): string {
  if (!v) return "—";
  return map[v] ?? v;
}
